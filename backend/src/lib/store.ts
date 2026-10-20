import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db,transaction } from './db';
import type { Club, ConsumptionTotal, Dashboard, EntityType, RouteCheck, SourceRecord,RouteDefinition } from '../../../shared/types';
import type { Normalized } from './normalize';
import catalog from '../../../shared/route-catalog.json';
export const clubSelect=`SELECT c.*, (SELECT count(*)::int FROM hrd_records r WHERE r.club_id=c.id AND r.entity_type='employee') employee_count,
  (SELECT count(*)::int FROM hrd_records r WHERE r.club_id=c.id AND r.entity_type='horse') horse_count, (SELECT state FROM hrd_sync_runs s WHERE s.club_id=c.id ORDER BY s.started_at DESC LIMIT 1) last_sync_state,
  (SELECT max(r.data->>'date') FROM hrd_records r WHERE r.club_id=c.id AND r.entity_type='consumption' AND r.data->>'kind'='day') latest_consumption_date FROM hrd_clubs c`;
// Too large for the dashboard payload (Vercel caps responses at 4.5 MB); served by feedPlans/consumptionTotals.
const onDemand=`entity_type='feedPlan' OR (entity_type='consumption' AND data->>'kind'='day')`;
const iso=(v:Date|null)=>v?.toISOString()||null;
export function publicClub(r: Record<string,any>): Club {
  return {id:r.id,name:r.name,brief:r.brief,baseUrl:r.base_url,authorisation:r.authorisation,issuer:r.issuer,scopeNotes:r.scope_notes||'',rateLimitNotes:r.rate_limit_notes||'',routeCatalog:r.route_catalog||null,collectedAt:iso(r.collected_at)!,credentialMask:r.credential_mask,credentialExpiresAt:iso(r.credential_expires_at),status:r.status,validatedAt:iso(r.validated_at),lastSuccessAt:iso(r.last_success_at),disconnectedAt:iso(r.disconnected_at),createdAt:iso(r.created_at)!,employeeCount:r.employee_count,horseCount:r.horse_count,latestConsumptionDate:r.latest_consumption_date||null,stale:!r.validated_at||r.status==='credential_required'||['partial','error'].includes(r.last_sync_state)||!r.last_success_at||r.last_success_at<r.collected_at||Date.now()-r.last_success_at.getTime()>900000};
}
export async function dashboard(): Promise<Dashboard> {
  // One read snapshot prevents mixing a new club count with the preceding dataset.
  return transaction(async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const clubs=(await client.query(clubSelect+' ORDER BY c.created_at')).rows.map(publicClub);
    const records=(await client.query(`SELECT * FROM hrd_records WHERE NOT (${onDemand}) ORDER BY entity_type,source_id`)).rows.map(sourceRecord);
    const checks:RouteCheck[]=(await client.query('SELECT * FROM hrd_route_checks')).rows.map(r=>({clubId:r.club_id,route:r.route,state:r.state,status:r.status,latencyMs:r.latency_ms,checkedAt:r.checked_at.toISOString(),lastSuccessAt:iso(r.last_success_at)}));
    return {clubs,records,checks,catalog:catalog as RouteDefinition[]};
  });
}
const sourceRecord=(r:Record<string,any>):SourceRecord=>({id:r.id,clubId:r.club_id,type:r.entity_type,sourceId:r.source_id,data:r.data,syncedAt:r.synced_at.toISOString()});
export async function feedPlans(clubId:string,horseId:string):Promise<SourceRecord[]> {
  return (await db().query("SELECT * FROM hrd_records WHERE club_id=$1 AND entity_type='feedPlan' AND data->>'horseId'=$2 ORDER BY data->>'date' DESC,source_id",[clubId,horseId])).rows.map(sourceRecord);
}
// Daily consumption summed per club and feed for an inclusive range of EFM source (UTC) dates.
export async function consumptionTotals(from:string,to:string):Promise<ConsumptionTotal[]> {
  return (await db().query(`SELECT club_id,data->>'feedType' feed_type,sum((data->>'quantity')::numeric)::float8 quantity FROM hrd_records
    WHERE entity_type='consumption' AND data->>'kind'='day' AND data->>'date' BETWEEN $1 AND $2 GROUP BY 1,2 ORDER BY 1,2`,[from,to])).rows
    .map(r=>({clubId:r.club_id,feedType:r.feed_type,quantity:r.quantity}));
}
export async function replaceDataset(clubId:string,type:EntityType,records:Normalized[],version:number,client?:PoolClient,pilot=false) {
  const replace=async(tx:PoolClient)=>{
    const {rows}=await tx.query('SELECT status,credential_version,validated_at FROM hrd_clubs WHERE id=$1 FOR UPDATE',[clubId]);
    if(!rows[0]||!(rows[0].status==='active'||(pilot&&rows[0].status==='pending'&&rows[0].validated_at))||rows[0].credential_version!==version) throw new Error('Club credential or connection changed');
    const seen=new Set<string>();for(const record of records) { if(seen.has(record.sourceId)) throw new Error('Duplicate EFM record');seen.add(record.sourceId); }
    // Complete replacement is atomic: no partially fetched records reach the dashboard.
    await tx.query('DELETE FROM hrd_records WHERE club_id=$1 AND entity_type=$2',[clubId,type]);
    if(records.length) await tx.query(`INSERT INTO hrd_records(id,club_id,entity_type,source_id,data)
      SELECT (row->>'id')::uuid,$1,$2,row->>'sourceId',row->'data' FROM jsonb_array_elements($3::jsonb) row`,[clubId,type,JSON.stringify(records.map(r=>({...r,id:randomUUID()})))]);
  };
  return client?replace(client):transaction(replace);
}
export async function routeCheck(clubId:string,route:string,state:string,status:number|null,latencyMs:number,version:number) {
  await db().query(`INSERT INTO hrd_route_checks(club_id,route,state,status,latency_ms,last_success_at)
    SELECT $1,$2,$3,$4,$5,CASE WHEN $3='ok' THEN now() ELSE NULL END FROM hrd_clubs WHERE id=$1 AND credential_version=$6 AND status!='disconnected'
    ON CONFLICT(club_id,route) DO UPDATE SET state=EXCLUDED.state,status=EXCLUDED.status,latency_ms=EXCLUDED.latency_ms,checked_at=now(),
    last_success_at=CASE WHEN EXCLUDED.state='ok' THEN now() ELSE hrd_route_checks.last_success_at END`,[clubId,route,state,status,latencyMs,version]);
}
