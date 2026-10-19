import { z } from 'zod';
import { db,transaction } from './db';
import { EfmError,type EfmRead } from './efm';
import { object } from './normalize';
import { paginated } from './sync';

// Mirrors EFM's read-only /api/integrations/export: every table EFM shares with integration keys.
// Each dataset is replaced atomically; a failed dataset keeps its previous rows. Work is time-boxed
// and stalest-first, so a large EFM catches up over several scheduled runs instead of timing out.
const catalog=z.object({version:z.literal(1),datasets:z.array(z.object({name:z.string().regex(/^[A-Z][A-Za-z0-9]{0,63}$/),count:z.number().int().min(0),fields:z.array(z.string().max(100)).max(500)})).max(500)});
export const EXPORT_PATH='/api/integrations/export';
const REFRESH_MS=30*60000;const MAX_ROWS=200000;
// Defence in depth: EFM already withholds credentials.
const secret=/password|secret|accesstoken|refreshtoken|idtoken|keyhash/i;
export function exportRow(raw:unknown):{sourceId:string;data:Record<string,unknown>} {
  const row=object(raw);if(typeof row.id!=='string'&&typeof row.id!=='number') throw new Error('EFM export row has no ID');
  const data:Record<string,unknown>={};
  for(const [key,value] of Object.entries(row)) if(!secret.test(key)) data[key]=typeof value==='string'&&value.length>20000?`${value.slice(0,20000)}…`:value;
  return {sourceId:String(row.id),data};
}
export async function syncExport(clubId:string,version:number,read:EfmRead,base:string,token:string,options:{budgetMs?:number;force?:boolean}={}) {
  const started=Date.now();const budget=options.budgetMs??150000;
  const listed=catalog.parse((await read(base,token,EXPORT_PATH)).body).datasets;
  const known=new Map((await db().query('SELECT dataset,synced_at FROM hrd_efm_datasets WHERE club_id=$1',[clubId])).rows.map(r=>[r.dataset as string,r.synced_at as Date|null]));
  // Tables EFM no longer shares are removed from HRD.
  await db().query('DELETE FROM hrd_efm_rows WHERE club_id=$1 AND NOT (dataset = ANY($2))',[clubId,listed.map(d=>d.name)]);
  await db().query('DELETE FROM hrd_efm_datasets WHERE club_id=$1 AND NOT (dataset = ANY($2))',[clubId,listed.map(d=>d.name)]);
  const due=listed.filter(d=>options.force||!known.get(d.name)||Date.now()-known.get(d.name)!.getTime()>REFRESH_MS)
    .sort((a,b)=>(known.get(a.name)?.getTime()??0)-(known.get(b.name)?.getTime()??0));
  let ok=0,failed=0,deferred=0;
  for(const dataset of due) {
    if(Date.now()-started>budget) {deferred++;continue;}
    try {
      const rows=dataset.count?await paginated(read,base,token,EXPORT_PATH,500,{dataset:dataset.name},MAX_ROWS):[];
      const records=rows.map(exportRow);const seen=new Set<string>();
      for(const r of records) {if(seen.has(r.sourceId)) throw new Error('Duplicate EFM export row');seen.add(r.sourceId);}
      await transaction(async tx=>{
        const club=(await tx.query('SELECT credential_version,status FROM hrd_clubs WHERE id=$1 FOR UPDATE',[clubId])).rows[0];
        if(!club||club.status==='disconnected'||club.credential_version!==version) throw new Error('Club credential or connection changed');
        await tx.query('DELETE FROM hrd_efm_rows WHERE club_id=$1 AND dataset=$2',[clubId,dataset.name]);
        for(let i=0;i<records.length;i+=5000) await tx.query(`INSERT INTO hrd_efm_rows(club_id,dataset,source_id,data)
          SELECT $1,$2,row->>'sourceId',row->'data' FROM jsonb_array_elements($3::jsonb) row`,[clubId,dataset.name,JSON.stringify(records.slice(i,i+5000))]);
        await tx.query(`INSERT INTO hrd_efm_datasets(club_id,dataset,total,fields,state,synced_at,checked_at) VALUES($1,$2,$3,$4,'ok',now(),now())
          ON CONFLICT(club_id,dataset) DO UPDATE SET total=EXCLUDED.total,fields=EXCLUDED.fields,state='ok',synced_at=now(),checked_at=now()`,[clubId,dataset.name,records.length,JSON.stringify(dataset.fields)]);
      });ok++;
    }catch(error) {
      failed++;const state=error instanceof EfmError?error.category:'error';
      await db().query(`INSERT INTO hrd_efm_datasets(club_id,dataset,total,fields,state,checked_at) VALUES($1,$2,$3,$4,$5,now())
        ON CONFLICT(club_id,dataset) DO UPDATE SET state=EXCLUDED.state,checked_at=now()`,[clubId,dataset.name,dataset.count,JSON.stringify(dataset.fields),state]);
      if(error instanceof EfmError&&error.category==='credential_required') throw error;
    }
  }
  return {datasets:listed.length,refreshed:ok,failed,deferred};
}
