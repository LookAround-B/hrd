import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db } from './db';
import { decryptToken,tokenExpiry } from './crypto';
import { EfmError,readEfm,isIntegrationKey,type EfmRead } from './efm';
import { integrationManifest } from './manifest';
import { arrayResponse,normalize,normalizeConsumption,object } from './normalize';
import { replaceDataset,routeCheck } from './store';
import type { EntityType } from '../../../shared/types';
import { audit } from './auth';

export async function paginated(read:EfmRead,base:string,token:string,path:string,take:number,extra:Record<string,string>={}):Promise<unknown[]> {
  const result:unknown[]=[];let expected:number|undefined;
  for(let skip=0;skip<=50000;skip+=take) {
    if(path==='/api/employees'&&skip>10000) throw new Error('EFM employee pagination limit exceeded');
    const page=await read(base,token,path,{...extra,skip:String(skip),take:String(take)});
    const root=object(page.body);const total=object(root.pagination).total;
    if(typeof total!=='number'||!Number.isInteger(total)||total<0||total>50000) throw new Error('Invalid EFM pagination');
    if(expected!==undefined&&total!==expected) throw new Error('EFM dataset changed during pagination');expected=total;
    const records=arrayResponse(page.body);if(records.length>take) throw new Error('Invalid EFM page size');result.push(...records);
    if(result.length===total) return result;
    if(!records.length||result.length>total||records.length<take) throw new Error('EFM pagination is incomplete');
  }throw new Error('EFM dataset exceeds pilot limit');
}
export async function markCredentialRequired(clubId:string,version:number) {
  await db().query("UPDATE hrd_clubs SET status='credential_required',validated_at=NULL WHERE id=$1 AND credential_version=$2 AND status!='disconnected'",[clubId,version]);
}
export async function testConnection(clubId:string,read:EfmRead=readEfm) {
  const {rows}=await db().query('SELECT * FROM hrd_clubs WHERE id=$1',[clubId]); const club=rows[0];
  if(!club||!club.encrypted_token||club.status==='disconnected') throw new Error('Club is not connected');
  const token=decryptToken(club.encrypted_token,clubId); const version=club.credential_version;
  let checkedPath='/api/auth/me';
  try {
    const expiry=tokenExpiry(token);if(expiry&&expiry.getTime()<=Date.now()) throw new EfmError(401,0,'credential_required','Replace the expired EFM access token.');
    const result=await read(club.base_url,token,'/api/auth/me');const me=object(result.body);
    if(typeof me.id!=='string'||me.isApproved!==true) throw new EfmError(403,result.latencyMs,'denied','An existing approved EFM account is required.');
    await routeCheck(clubId,'/api/auth/me','ok',result.status,result.latencyMs,version);
    if(isIntegrationKey(token)) {
      checkedPath='/api/integrations/manifest';
      const manifest=await read(club.base_url,token,'/api/integrations/manifest');
      const parsed=integrationManifest.safeParse(manifest.body);
      if(!parsed.success) throw new EfmError(manifest.status,manifest.latencyMs,'error','EFM route manifest is not compatible with HRD.');
      await db().query("UPDATE hrd_clubs SET route_catalog=$3 WHERE id=$1 AND credential_version=$2 AND status!='disconnected'",[clubId,version,JSON.stringify(parsed.data.routes)]);
      await routeCheck(clubId,'/api/integrations/manifest','ok',manifest.status,manifest.latencyMs,version);
    }
    // Validation never enables scheduling; the admin explicitly activates after reconciliation.
    await db().query('UPDATE hrd_clubs SET validated_at=now() WHERE id=$1 AND credential_version=$2 AND status!=\'disconnected\'',[clubId,version]);
    return {verified:true,account:{name:typeof me.fullName==='string'?me.fullName:null},message:'Connection verified. Run a reconciliation sync before activation.'};
  }catch(error) {
    await db().query("UPDATE hrd_clubs SET validated_at=NULL WHERE id=$1 AND credential_version=$2",[clubId,version]);
    if(error instanceof EfmError) {
      const invalid=error.category==='credential_required'||error.category==='denied';
      await routeCheck(clubId,checkedPath,invalid?'credential_required':error.category,error.status,error.latencyMs,version);
      if(invalid) await markCredentialRequired(clubId,version);
    }else await routeCheck(clubId,checkedPath,'error',null,0,version);
    throw error;
  }
}

export async function syncClub(clubId:string,options:{read?:EfmRead;pilot?:boolean}={}) {
  const lock=await db().connect();const read=options.read||readEfm;
  try {
    const acquired=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[clubId])).rows[0].acquired;
    if(!acquired) return {state:'busy',datasets:{}};
    return await runLocked(clubId,lock,read,options.pilot===true);
  }finally { try{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[clubId]);}finally{lock.release();} }
}
async function runLocked(clubId:string,lock:PoolClient,read:EfmRead,pilot:boolean) {
  const club=(await lock.query('SELECT * FROM hrd_clubs WHERE id=$1',[clubId])).rows[0];
  if(!club||!club.encrypted_token||club.status==='disconnected'||(!pilot&&club.status!=='active')) return {state:'skipped',datasets:{}};
  const version=club.credential_version;const id=randomUUID();
  await lock.query("INSERT INTO hrd_sync_runs(id,club_id,state) VALUES($1,$2,'running')",[id,clubId]);
  let token:string;
  try {
    await testConnection(clubId,read);
    token=decryptToken(club.encrypted_token,clubId);
  }catch(error) {
    const connection=error instanceof EfmError?error.category:'error';
    await lock.query("UPDATE hrd_sync_runs SET state='error',datasets=$2,finished_at=now() WHERE id=$1",[id,JSON.stringify({connection})]);
    throw error;
  }
  const datasets:Record<string,string>={};let stop=false;
  const checked:EfmRead=async(base,tok,path,query)=>{
    try { const result=await read(base,tok,path,query);await routeCheck(clubId,path,'ok',result.status,result.latencyMs,version);return result; }
    catch(error) {if(error instanceof EfmError) {await routeCheck(clubId,path,error.category,error.status,error.latencyMs,version);
      if(error.category==='credential_required') {stop=true;await markCredentialRequired(clubId,version);} }throw error;}
  };
  const jobs: {type:EntityType;fetch:()=>Promise<unknown>}[] = [
    {type:'employee',fetch:async()=>{
      const rows=await paginated(checked,club.base_url,token,'/api/employees',500,{includePending:'true'});
      const details=[];for(const raw of rows) {const row=object(raw);if(typeof row.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(row.id)) throw new Error('Invalid employee ID');
        const detail=await checked(club.base_url,token,`/api/employees/${row.id}`);const data=object(detail.body); if(data.id!==row.id) throw new Error('Mismatched employee detail');details.push(data); }
      return details;
    }},
    {type:'horse',fetch:()=>paginated(checked,club.base_url,token,'/api/horses',1000)},
    {type:'careTeam',fetch:async()=>arrayResponse((await checked(club.base_url,token,'/api/horse-care-team')).body)},
    {type:'health',fetch:()=>paginated(checked,club.base_url,token,'/api/health-records',100)},
    {type:'medicine',fetch:async()=>arrayResponse((await checked(club.base_url,token,'/api/medicine-logs')).body)},
    {type:'feedInventory',fetch:async()=>arrayResponse((await checked(club.base_url,token,'/api/feed-inventory')).body)},
    {type:'consumption',fetch:async()=>(await checked(club.base_url,token,'/api/feed-inventory/consumption-report',{startDate:'2000-01-01',endDate:new Date().toISOString().slice(0,10)})).body},
    {type:'grocery',fetch:async()=>arrayResponse((await checked(club.base_url,token,'/api/groceries-inventory')).body)},
    {type:'feedPlan',fetch:()=>paginated(checked,club.base_url,token,'/api/integrations/horse-feed-plans',500)},
    {type:'groceryUsage',fetch:()=>paginated(checked,club.base_url,token,'/api/integrations/grocery-usage',500)}
  ];
  try {
    for(const job of jobs) {
      if(stop) {datasets[job.type]='paused';continue;}
      try {const data=await job.fetch();const records=job.type==='consumption'?normalizeConsumption(data):normalize(job.type,data as unknown[]);
        await replaceDataset(clubId,job.type,records,version,undefined,pilot);datasets[job.type]=`ok:${records.length}`;
      }catch(error) {datasets[job.type]=error instanceof EfmError?error.category:'error';}
    }
    const state=Object.values(datasets).every(v=>v.startsWith('ok:'))?'success':Object.values(datasets).some(v=>v.startsWith('ok:'))&&Object.values(datasets).every(v=>v.startsWith('ok:')||v==='denied')?'limited':'partial';
    await lock.query('UPDATE hrd_sync_runs SET state=$2,datasets=$3,finished_at=now() WHERE id=$1',[id,state,JSON.stringify(datasets)]);
    if(state==='success'||state==='limited') await lock.query("UPDATE hrd_clubs SET last_success_at=now() WHERE id=$1 AND credential_version=$2 AND status IN ('active','pending')",[clubId,version]);
    return {state,datasets};
  }catch(error) {await lock.query("UPDATE hrd_sync_runs SET state='error',finished_at=now() WHERE id=$1",[id]);throw error;}
}
export async function maintenance() {
  // Only HRD tables. Remove credentials immediately on disconnect; purge personal data within 30 days.
  await db().query(`DELETE FROM hrd_records WHERE club_id IN (SELECT id FROM hrd_clubs WHERE disconnected_at<=now()-interval '30 days')`);
  await db().query("DELETE FROM hrd_route_checks WHERE checked_at<now()-interval '30 days' OR club_id IN (SELECT id FROM hrd_clubs WHERE disconnected_at<=now()-interval '30 days')");
  await db().query("UPDATE hrd_clubs SET issuer='Purged',authorisation='Approval details purged after disconnect',brief='' WHERE disconnected_at<=now()-interval '30 days'");
  await db().query("DELETE FROM hrd_sync_runs WHERE started_at<now()-interval '30 days'");
  await db().query("DELETE FROM hrd_audit_events WHERE created_at<now()-interval '90 days'");
  await db().query('DELETE FROM hrd_admin_sessions WHERE expires_at<now()');
  await db().query('DELETE FROM hrd_rate_limits WHERE expires_at<now()');
}
export async function syncAll() {
  await maintenance();
  const {rows}=await db().query("SELECT id FROM hrd_clubs WHERE status='active' ORDER BY created_at");
  let failures=0;for(const club of rows) {try {const result=await syncClub(club.id);if(result.state==='partial') failures++;}
    catch {failures++;await audit('scheduler','sync_failed',club.id);} }
  return {clubs:rows.length,failures};
}
