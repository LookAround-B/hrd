import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { audit,adminEmails,demoLogin,HttpError,login,loginDemo,logout,requireSession,rateLimit } from '../../lib/auth';
import { db,transaction } from '../../lib/db';
import { encryptToken,tokenExpiry,hash } from '../../lib/crypto';
import { approvedBaseUrl,EfmError } from '../../lib/efm';
import { consumptionTotals,dashboard,feedPlans } from '../../lib/store';
import { syncClub,testConnection } from '../../lib/sync';
import { clubCreate,clubQuery,consumptionQuery,credentialReplace,demoLogin as demoInput,efmRowFilters,efmRowsQuery,feedPlansQuery,googleLogin,issueMessage,validateRequest } from '../../../../shared/schemas';

export const config={api:{bodyParser:{sizeLimit:'32kb'}}};
const uuid=z.uuid();
// Local development only: shows the demo credentials on the sign-in page. Never sent in production,
// where they would give admin access to anyone who opens the site.
function demoCredentials() {
  const demo=demoLogin();
  return process.env.NODE_ENV!=='production'&&demo.enabled?{phone:process.env.DEMO_LOGIN_PHONE,code:demo.code}:null;
}
function method(req:NextApiRequest,expected:string) { if(req.method!==expected) throw new HttpError(405,'Method not allowed.'); }

export default async function handler(req:NextApiRequest,res:NextApiResponse) {
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const path=(Array.isArray(req.query.path)?req.query.path:[]).join('/');
  try {
    // Every route's query and body are checked against shared/schemas.ts (strict) before any work.
    const {path:_route,...query}=req.query;
    const input=validateRequest(path,query,req.body);
    if(!input) throw new HttpError(404,'HRD endpoint not found.');
    // Parsed values typed by the schema that produced them.
    const parsed={query:<S extends z.ZodType>(_:S)=>input.query as z.output<S>,body:<S extends z.ZodType>(_:S)=>input.body as z.output<S>};
    if(path==='health') {method(req,'GET');await db().query('SELECT 1');return res.status(200).json({status:'ok'});}
    if(path==='config') {method(req,'GET');return res.status(200).json({googleClientId:process.env.GOOGLE_CLIENT_ID||null,authReady:!!process.env.GOOGLE_CLIENT_ID&&adminEmails().length>0&&!!process.env.APP_ORIGIN,demoLogin:demoLogin().enabled&&!!process.env.APP_ORIGIN,demoCredentials:demoCredentials()});}
    if(path==='auth/google') {method(req,'POST');return res.status(200).json(await login(req,res,parsed.body(googleLogin)));}
    if(path==='auth/demo') {method(req,'POST');return res.status(200).json(await loginDemo(req,res,parsed.body(demoInput)));}
    const user=await requireSession(req,req.method!=='GET');
    if(path==='auth/session') {method(req,'GET');return res.status(200).json(user);}
    if(path==='auth/logout') {method(req,'POST');await logout(req,res,user.email);return res.status(200).json({ok:true});}
    if(path==='dashboard') {method(req,'GET');return res.status(200).json(await dashboard());}
    if(path==='feed-plans') {method(req,'GET');const q=parsed.query(feedPlansQuery);return res.status(200).json(await feedPlans(q.clubId,q.horseId));}
    if(path==='consumption') {method(req,'GET');const q=parsed.query(consumptionQuery);return res.status(200).json(await consumptionTotals(q.from,q.to));}
    if(path==='audit') {method(req,'GET');return res.status(200).json((await db().query('SELECT actor,action,club_id,details,created_at FROM hrd_audit_events ORDER BY created_at DESC LIMIT 100')).rows);}
    if(path==='efm-data') {
      method(req,'GET');const q=parsed.query(clubQuery);
      return res.status(200).json((await db().query('SELECT dataset,total,fields,state,synced_at,checked_at FROM hrd_efm_datasets WHERE club_id=$1 ORDER BY dataset',[q.clubId])).rows);
    }
    if(path==='efm-data/rows') {
      method(req,'GET');const q=parsed.query(efmRowsQuery);
      const meta=(await db().query('SELECT fields FROM hrd_efm_datasets WHERE club_id=$1 AND dataset=$2',[q.clubId,q.dataset])).rows[0];
      if(!meta) throw new HttpError(404,'This EFM dataset has not been imported yet.');
      const fields:string[]=meta.fields;const params:unknown[]=[q.clubId,q.dataset];let where='club_id=$1 AND dataset=$2';
      if(q.search.trim()) {params.push(`%${q.search.trim().replace(/[\\%_]/g,m=>'\\'+m)}%`);where+=` AND EXISTS (SELECT 1 FROM jsonb_each_text(data) e WHERE e.value ILIKE $${params.length})`;}
      // Exact-match column filters, e.g. {"horseId":"…"}; only known fields are accepted.
      let parsedFilters:unknown;try{parsedFilters=JSON.parse(q.filters);}catch{throw new HttpError(400,'Invalid filters.');}
      const filters=efmRowFilters.parse(parsedFilters);
      for(const [field,value] of Object.entries(filters)) {if(!fields.includes(field)) throw new HttpError(400,'Unknown filter field.');params.push(field,value);where+=` AND data->>$${params.length-1} = $${params.length}`;}
      const sort=q.sort&&fields.includes(q.sort)?q.sort:null;if(sort) params.push(sort);
      const order=sort?`NULLIF(data->($${params.length}::text),'null'::jsonb) ${q.dir==='desc'?'DESC':'ASC'} NULLS LAST, source_id`:'source_id';
      const total=(await db().query(`SELECT count(*)::int n FROM hrd_efm_rows WHERE ${where}`,sort?params.slice(0,-1):params)).rows[0].n;
      params.push(q.take,q.skip);
      const rows=(await db().query(`SELECT source_id,data,synced_at FROM hrd_efm_rows WHERE ${where} ORDER BY ${order} LIMIT $${params.length-1} OFFSET $${params.length}`,params)).rows;
      return res.status(200).json({total,fields,rows:rows.map(r=>({id:r.source_id,data:r.data,syncedAt:r.synced_at}))});
    }
    if(path==='clubs') {
      method(req,'POST');await rateLimit(`onboard:${user.email}`,10,60);const input=parsed.body(clubCreate);const base=approvedBaseUrl(input.baseUrl).origin;const id=randomUUID();
      await transaction(async client=>{
        await client.query(`INSERT INTO hrd_clubs(id,name,brief,base_url,authorisation,issuer,encrypted_token,credential_expires_at,scope_notes,rate_limit_notes,credential_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,input.name,input.brief,base,input.authorisation,input.issuer,encryptToken(input.token,id),tokenExpiry(input.token),input.scopeNotes,input.rateLimitNotes,hash(input.token)]);
        await audit(user.email,'club_added',id,{termsConfirmed:true},client);
      });return res.status(201).json({id});
    }
    const match=/^clubs\/([^/]+)\/(test|credential|sync|activate|disconnect|status)$/.exec(path);
    if(!match) throw new HttpError(404,'HRD endpoint not found.');
    const id=uuid.parse(match[1]);const action=match[2];
    const exists=(await db().query('SELECT status FROM hrd_clubs WHERE id=$1',[id])).rows[0];if(!exists) throw new HttpError(404,'Club not found.');
    if(action==='status') {method(req,'GET');return res.status(200).json((await db().query('SELECT state,datasets,started_at,finished_at FROM hrd_sync_runs WHERE club_id=$1 ORDER BY started_at DESC LIMIT 10',[id])).rows);}
    method(req,'POST');await rateLimit(`club-action:${id}`,20,60);
    if(action==='test') {await audit(user.email,'connection_test',id);return res.status(200).json(await testConnection(id));}
    if(action==='sync') {await audit(user.email,'manual_sync',id);return res.status(200).json(await syncClub(id,{pilot:true}));}
    // Lifecycle mutations share the sync lock, so token replacement, activation and disconnect
    // cannot race an EFM response into a disconnected club's cache.
    const result=await transaction(async client=>{
      const locked=(await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[id])).rows[0].acquired;
      if(!locked) throw new HttpError(409,'A sync is running. Try again after it finishes.');
      if(action==='credential') {
        const input=parsed.body(credentialReplace);
        await client.query("UPDATE hrd_clubs SET encrypted_token=$2,issuer=$3,authorisation=$4,collected_at=now(),credential_expires_at=$5,scope_notes=$6,rate_limit_notes=$7,credential_fingerprint=$8,credential_version=credential_version+1,validated_at=NULL,route_catalog=NULL,status='pending',disconnected_at=NULL WHERE id=$1",[id,encryptToken(input.token,id),input.issuer,input.authorisation,tokenExpiry(input.token),input.scopeNotes,input.rateLimitNotes,hash(input.token)]);
        await client.query('DELETE FROM hrd_route_checks WHERE club_id=$1',[id]);await audit(user.email,'club_credential',id,{},client);return {ok:true,message:'Token replaced. Test and reconcile the connection before activation.'};
      }
      if(action==='disconnect') {
        await client.query("UPDATE hrd_clubs SET status='disconnected',disconnected_at=now(),encrypted_token=NULL,credential_fingerprint=NULL,validated_at=NULL,credential_version=credential_version+1 WHERE id=$1",[id]);await audit(user.email,'club_disconnect',id,{},client);return {ok:true};
      }
      if(action==='activate') {
        const club=(await client.query('SELECT * FROM hrd_clubs WHERE id=$1',[id])).rows[0];
        const last=(await client.query('SELECT * FROM hrd_sync_runs WHERE club_id=$1 ORDER BY started_at DESC LIMIT 1',[id])).rows[0];
        if(club.status!=='pending'||!club.validated_at||!club.last_success_at||club.last_success_at<club.collected_at||Date.now()-club.last_success_at.getTime()>900000||!last||!['success','limited'].includes(last.state)||!String(last.datasets.employee).startsWith('ok:')||!String(last.datasets.horse).startsWith('ok:'))
          throw new HttpError(409,'Run a successful reconciliation sync with employee and horse access before activating.');
        if(club.credential_expires_at&&club.credential_expires_at.getTime()<=Date.now()) throw new HttpError(409,'Replace the expired EFM token first.');
        await client.query("UPDATE hrd_clubs SET status='active' WHERE id=$1",[id]);await audit(user.email,'club_activate',id,{reconciled:true},client);return {ok:true};
      }throw new HttpError(404,'Action not found.');
    });
    return res.status(200).json(result);
  }catch(error) {
    if(error&&typeof error==='object'&&'code' in error&&error.code==='23505'&&'constraint' in error&&error.constraint==='hrd_clubs_credential_fingerprint') return res.status(409).json({error:'Each connected club requires its own EFM credential. This credential is already in use.'});
    if(error instanceof HttpError) {if(error.status===429)res.setHeader('Retry-After','60');return res.status(error.status).json({error:error.message});}
    if(error instanceof z.ZodError) return res.status(400).json({error:issueMessage(error)});
    if(error instanceof EfmError) return res.status(error.category==='credential_required'?409:502).json({error:error.message,category:error.category});
    // Never log request bodies, raw EFM responses, tokens, or database exception details.
    console.error('HRD request failed',{endpoint:path.replace(/[a-f0-9-]{36}/g,':club'),method:req.method});
    return res.status(500).json({error:'HRD could not complete this request. Check service configuration and try again.'});
  }
}
