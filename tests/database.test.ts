import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { EfmRead, EfmTransport } from '../backend/src/lib/efm';

const state=vi.hoisted(()=>({reader:null as EfmRead|null,email:'hrd-admin@example.com',verified:true,invalidLogin:false}));
vi.mock('google-auth-library',()=>({OAuth2Client:class {
  async verifyIdToken() {
    if(state.invalidLogin)throw new Error('Invalid fixture identity');
    return {getPayload:()=>({email:state.email,email_verified:state.verified})};
  }
}}));
vi.mock('../backend/src/lib/efm',async original=>({
  ...await original<typeof import('../backend/src/lib/efm')>(),
  readEfm:((...args)=>state.reader!(...args)) as EfmRead,
}));
import handler from '../backend/src/pages/api/[...path]';
import { createEfmReader, EfmError } from '../backend/src/lib/efm';
import { db } from '../backend/src/lib/db';
import { decryptToken } from '../backend/src/lib/crypto';
import { syncAll,maintenance } from '../backend/src/lib/sync';
import { runMigrations } from '../backend/src/lib/migrate';
import catalog from '../shared/route-catalog.json';

const testUrl=process.env.HRD_TEST_DATABASE_URL;
if(testUrl) {
  const url=new URL(testUrl);
  if(url.pathname!=='/hrd_test'||!['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname))
    throw new Error('Integration tests require a local isolated database named hrd_test.');
}
const suite=testUrl?describe:describe.skip;
const base='https://efm.example.com';
const permanentKey=`efm_live_${'a'.repeat(43)}`;
const replacementKey=`efm_live_${'b'.repeat(43)}`;
const session=randomBytes(32).toString('hex');
const csrf='test-csrf';
let revoked=false,deniedRoute='',failRoute='',duplicateEmployee=false,exchanges=0,reads=0;
const accessTokens=new Set<string>();
const response=(body:unknown)=>({body,status:200,latencyMs:1});
const employee={id:'employee-1',fullName:'Fixture Employee',email:'fixture@example.com',designation:'Super Admin',isApproved:true,password:'must-never-be-mirrored'};
const horse={id:'horse-1',name:'Fixture Horse',status:'Active',trainingLevel:'Novice',workloadLimit:'Light',location:'North stable'};
const transport:EfmTransport=async(url,request)=>{
  if(url.pathname==='/api/integrations/token') {
    expect(request.method).toBe('POST');
    const {key}=JSON.parse(request.body!);
    if((key===permanentKey&&revoked)||![permanentKey,replacementKey].includes(key)) throw new EfmError(401,1,'credential_required','Revoked fixture key');
    exchanges++;
    const token=`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+900,nonce:exchanges})).toString('base64url')}.fixture`;
    accessTokens.add(token);return response({token,expiresIn:900});
  }
  expect(request.method).toBe('GET');
  expect(request.headers.authorization).not.toContain('efm_live_');
  if(!accessTokens.has(request.headers.authorization.slice(7))||revoked) throw new EfmError(401,1,'credential_required','Revoked fixture token');
  reads++;
  if(url.pathname===deniedRoute) throw new EfmError(403,1,'denied','Fixture route denied');
  if(url.pathname===failRoute) throw new EfmError(503,1,'error','Fixture source unavailable');
  const page=(data:unknown[])=>response({data,pagination:{total:data.length}});
  switch(url.pathname) {
    case '/api/auth/me': return response(employee);
    case '/api/integrations/manifest': return response({version:1,readOnly:true,routes:catalog});
    case '/api/employees': return page(duplicateEmployee?[employee,employee]:[employee]);
    case '/api/employees/employee-1': return response(employee);
    case '/api/horses': return page([horse]);
    case '/api/horse-care-team': return response([{id:'care-1',horseId:horse.id,staffId:employee.id,role:'Groom'}]);
    case '/api/health-records': return page([{id:'health-1',horseId:horse.id,recordType:'Checkup',date:'2026-10-01'}]);
    case '/api/medicine-logs': return response([{id:'medicine-1',horseId:horse.id,medicineName:'Fixture medicine',quantity:1,unit:'ml'}]);
    case '/api/feed-inventory': return response([{id:'feed-1',feedType:'oats',month:10,year:2026,openingStock:50,unitsBrought:100,totalUsed:20,unitsLeft:130,unit:'kg'}]);
    case '/api/feed-inventory/consumption-report': return response({data:{feedTypes:['oats'],horseConsumption:{[horse.id]:{horseName:horse.name,feeds:{oats:20}}},dailyBreakdown:{'2026-10-01':{oats:20}}}});
    case '/api/groceries-inventory': return response([{id:'grocery-1',name:'Fixture groceries',quantity:25,unit:'kg'}]);
    case '/api/integrations/horse-feed-plans': return page([{id:'plan-1',horseId:horse.id,date:'2026-10-01',temporaryMenuName:'Fixture menu',oats:2,notes:'Fixture feed plan'}]);
    case '/api/integrations/grocery-usage': return page([{id:'usage-1',itemName:'Fixture rice',category:'FOOD ITEMS - RESTAURANT',unit:'kg',month:10,year:2026,openingStock:10,purchaseStock:5,w1Received:5,w2Received:0,w3Received:0,w4Received:0,w1Used:2,w2Used:1,w3Used:0,w4Used:0,monthlyBalance:12}]);
    case '/api/integrations/horse-profiles': return page([{id:horse.id,name:horse.name,microchipNumber:'985000000000001',feiId:'FEI-1',sire:'Fixture sire'}]);
    case '/api/farrier-shoeing': return response([{id:'farrier-1',horseId:horse.id,shoeingDate:'2026-09-01',nextDueDate:'2026-10-13',numberOfLegs:4,farrier:{id:employee.id,fullName:'Fixture farrier'}}]);
    case '/api/inspections': return response({inspections:[{id:'inspection-1',horseId:horse.id,round:'Morning',description:'Fixture swelling',location:'Yard',severityLevel:'High',status:'Open',images:['https://example.com/a.jpg']}]});
    case '/api/accident-reports': return response({data:[{id:'accident-1',horseId:horse.id,accidentDate:'2026-09-02',accidentLocation:'Arena',accidentDetails:'Fixture fall',horseInjured:false}]});
    case '/api/integrations/export': {
      const tables:Record<string,Record<string,unknown>[]>={Attendance:[{id:'att-2',employeeId:employee.id,date:'2026-10-02',status:'Present'},{id:'att-1',employeeId:employee.id,date:'2026-10-01',status:'Absent'}],
        Employee:[{id:employee.id,fullName:employee.fullName,password:'must-never-be-mirrored'}]};
      const dataset=url.searchParams.get('dataset');
      if(!dataset) return response({version:1,datasets:Object.entries(tables).map(([name,rows])=>({name,count:rows.length,fields:Object.keys(rows[0])}))});
      return page(tables[dataset]);
    }
    default: throw new Error('Unexpected EFM request in integration test');
  }
};

async function api(path:string,body?:unknown,options:{csrf?:string;origin?:string;session?:string;query?:Record<string,string>}={}) {
  const res={code:200,body:undefined as any,headers:{} as Record<string,string>,
    setHeader(k:string,v:string){this.headers[k]=v;},status(n:number){this.code=n;return this;},json(data:unknown){this.body=data;return this;}};
  await handler({method:body===undefined?'GET':'POST',query:{path:path.split('/'),...options.query},body,
    headers:{origin:options.origin??'http://hrd.test','x-hrd-csrf':options.csrf??csrf},
    cookies:{hrd_session:options.session??session}} as unknown as NextApiRequest,res as unknown as NextApiResponse);
  return res;
}
async function onboard(key=permanentKey,name='Fixture club') {
  const result=await api('clubs',{name,baseUrl:base,token:key,issuer:'Fixture EFM administrator',authorisation:'Isolated integration test approval',termsConfirmed:true,scopeNotes:'Reviewed read-only HRD datasets',rateLimitNotes:'Fixture limit: 30 token exchanges per minute'});
  expect(result.code).toBe(201);return result.body.id as string;
}
async function reconcile(id:string) {
  expect((await api(`clubs/${id}/test`,{})).code).toBe(200);
  const result=await api(`clubs/${id}/sync`,{});expect(result.code).toBe(200);return result.body;
}

suite('complete HRD integration with isolated PostgreSQL and fixture EFM',()=>{
  beforeAll(async()=>{
    process.env.DATABASE_URL=testUrl!;process.env.DB_SSL='false';
    process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
    process.env.ADMIN_EMAILS='hrd-admin@example.com';process.env.APP_ORIGIN='http://hrd.test';process.env.EFM_ALLOWED_HOSTS='efm.example.com';
    process.env.GOOGLE_CLIENT_ID='fixture-google-client';
    await runMigrations();await runMigrations();
  });
  beforeEach(async()=>{
    await db().query('TRUNCATE hrd_clubs,hrd_records,hrd_efm_rows,hrd_efm_datasets,hrd_route_checks,hrd_sync_runs,hrd_audit_events,hrd_admin_sessions,hrd_rate_limits CASCADE');
    await db().query('INSERT INTO hrd_admin_sessions(token_hash,email,csrf,expires_at) VALUES($1,$2,$3,now()+interval \'1 hour\')',[createHash('sha256').update(session).digest('hex'),'hrd-admin@example.com',csrf]);
    revoked=false;deniedRoute='';failRoute='';duplicateEmployee=false;exchanges=0;reads=0;accessTokens.clear();state.reader=createEfmReader(transport);
    state.email='hrd-admin@example.com';state.verified=true;state.invalidLogin=false;
  });
  afterAll(async()=>{await db().end();delete (globalThis as {hrdPool?:unknown}).hrdPool;});

  it('creates an audited admin session after Google verification and revokes it on logout',async()=>{
    const login=await api('auth/google',{credential:'fixture-google-credential'});expect(login.code).toBe(200);
    expect(login.headers['Set-Cookie']).toContain('HttpOnly');expect(login.headers['Set-Cookie']).toContain('SameSite=Lax');
    const token=/hrd_session=([a-f0-9]{64});/.exec(login.headers['Set-Cookie'])![1];
    const options={session:token,csrf:login.body.csrf};
    expect((await api('auth/session',undefined,options)).body.email).toBe('hrd-admin@example.com');
    expect((await api('auth/logout',{},options)).headers['Set-Cookie']).toContain('Max-Age=0');
    expect((await api('dashboard',undefined,options)).code).toBe(401);
    const events=(await api('audit')).body.map((r:{action:string})=>r.action);
    expect(events).toContain('login_success');expect(events).toContain('logout');
  });
  it('demo sign-in is off by default, verifies phone and code, locks out guessing and ends when disabled',async()=>{
    expect((await api('auth/demo',{phone:'9000000001',code:'demo-code-123'})).code).toBe(404);
    process.env.DEMO_LOGIN_PHONE='+91 90000 00001';process.env.DEMO_LOGIN_CODE='demo-code-123';process.env.DEMO_LOGIN_UNTIL=new Date(Date.now()+3600000).toISOString();
    try {
      expect((await api('config')).body.demoLogin).toBe(true);
      expect((await api('auth/demo',{phone:'9000000001',code:'demo-code-123'},{origin:'https://evil.test'})).code).toBe(403);
      expect((await api('auth/demo',{phone:'9000000001',code:'wrong-code'})).code).toBe(401);
      const ok=await api('auth/demo',{phone:'90000 00001',code:'demo-code-123'});expect(ok.code).toBe(200);
      const token=/hrd_session=([a-f0-9]{64});/.exec(ok.headers['Set-Cookie'])![1];
      expect(new Date(ok.body.expiresAt).getTime()).toBeLessThanOrEqual(Date.parse(process.env.DEMO_LOGIN_UNTIL));
      expect((await api('dashboard',undefined,{session:token})).code).toBe(200);
      for(let i=0;i<10;i++) await api('auth/demo',{phone:'9000000001',code:`guess-${i}`});
      expect((await api('auth/demo',{phone:'9000000001',code:'demo-code-123'})).code).toBe(429);
      delete process.env.DEMO_LOGIN_CODE;
      expect((await api('dashboard',undefined,{session:token})).code).toBe(401);
      const events=(await api('audit')).body.map((r:{action:string})=>r.action);
      expect(events).toContain('demo_login_success');expect(events).toContain('demo_login_failed');
    } finally { delete process.env.DEMO_LOGIN_PHONE;delete process.env.DEMO_LOGIN_CODE;delete process.env.DEMO_LOGIN_UNTIL; }
  });
  it('denies unapproved identities, unverified emails and repeated login attempts',async()=>{
    state.email='outsider@example.com';expect((await api('auth/google',{credential:'fixture'})).code).toBe(403);
    state.email='hrd-admin@example.com';state.verified=false;expect((await api('auth/google',{credential:'fixture'})).code).toBe(403);
    state.verified=true;state.invalidLogin=true;expect((await api('auth/google',{credential:'fixture'})).code).toBe(401);
    state.invalidLogin=false;
    await db().query("INSERT INTO hrd_rate_limits(bucket,count,expires_at) VALUES('google-login',60,now()+interval '1 minute') ON CONFLICT(bucket) DO UPDATE SET count=60");
    const limited=await api('auth/google',{credential:'fixture'});expect(limited.code).toBe(429);expect(limited.headers['Retry-After']).toBe('60');
  });

  it('encrypts the permanent key, tests access, mirrors every dataset, activates and runs scheduled sync',async()=>{
    const id=await onboard();
    const stored=(await db().query('SELECT encrypted_token,credential_expires_at,status FROM hrd_clubs WHERE id=$1',[id])).rows[0];
    expect(stored.status).toBe('pending');expect(stored.credential_expires_at).toBeNull();
    expect(stored.encrypted_token).not.toContain(permanentKey);expect(decryptToken(stored.encrypted_token,id)).toBe(permanentKey);
    expect((await api(`clubs/${id}/activate`,{reconciled:true})).code).toBe(409);
    expect((await reconcile(id)).state).toBe('success');
    const dashboard=await api('dashboard');expect(dashboard.code).toBe(200);
    expect(dashboard.body.clubs[0]).toMatchObject({status:'pending',employeeCount:1,horseCount:1,credentialExpiresAt:null,scopeNotes:'Reviewed read-only HRD datasets',rateLimitNotes:'Fixture limit: 30 token exchanges per minute'});
    expect([...new Set(dashboard.body.records.map((r:{type:string})=>r.type))].sort()).toEqual(['careTeam','consumption','employee','feedInventory','grocery','health','horse','medicine','feedPlan','groceryUsage','horseProfile','farrier','inspection','accident'].sort());
    expect(dashboard.body.records.find((r:{type:string})=>r.type==='horse').data.trainingLevel).toBe('Novice');
    expect(dashboard.body.clubs[0].routeCatalog).toEqual(catalog);
    expect(dashboard.body.records.filter((r:{type:string})=>r.type==='consumption')).toHaveLength(2);
    expect(JSON.stringify(dashboard.body)).not.toContain(permanentKey);expect(JSON.stringify(dashboard.body)).not.toContain('must-never-be-mirrored');
    expect((await api(`clubs/${id}/activate`,{reconciled:true})).code).toBe(200);
    expect(await syncAll()).toEqual({clubs:1,failures:0});expect(exchanges).toBe(1);
    expect((await api(`clubs/${id}/status`)).body[0].state).toBe('success');
  });
  it('mirrors the full EFM export with search, filters and sort, without credentials',async()=>{
    const id=await onboard();const result=await reconcile(id);expect(result.datasets.efmExport).toBe('ok:2/2');
    const list=await api('efm-data',undefined,{query:{clubId:id}});
    expect(list.body.map((d:{dataset:string;total:number;state:string})=>[d.dataset,d.total,d.state])).toEqual([['Attendance',2,'ok'],['Employee',1,'ok']]);
    const rows=await api('efm-data/rows',undefined,{query:{clubId:id,dataset:'Attendance',sort:'date',dir:'desc'}});
    expect(rows.body.total).toBe(2);expect(rows.body.rows.map((r:{id:string})=>r.id)).toEqual(['att-2','att-1']);
    expect((await api('efm-data/rows',undefined,{query:{clubId:id,dataset:'Attendance',search:'absent'}})).body.rows.map((r:{id:string})=>r.id)).toEqual(['att-1']);
    expect((await api('efm-data/rows',undefined,{query:{clubId:id,dataset:'Attendance',filters:JSON.stringify({status:'Present'})}})).body.total).toBe(1);
    expect((await api('efm-data/rows',undefined,{query:{clubId:id,dataset:'Attendance',filters:JSON.stringify({nope:'x'})}})).code).toBe(400);
    expect((await api('efm-data/rows',undefined,{query:{clubId:id,dataset:'Attendance',filters:'{bad'}})).code).toBe(400);
    expect((await api('efm-data/rows',undefined,{query:{clubId:id,dataset:'Missing'}})).code).toBe(404);
    const stored=JSON.stringify((await db().query('SELECT data FROM hrd_efm_rows WHERE club_id=$1',[id])).rows);
    expect(stored).not.toContain('must-never-be-mirrored');expect(stored).toContain('Fixture Employee');
  });
  it('pauses on key revocation and preserves the last mirrored data',async()=>{
    const id=await onboard();await reconcile(id);await api(`clubs/${id}/activate`,{reconciled:true});
    const before=(await api('dashboard')).body.records;
    revoked=true;expect(await syncAll()).toEqual({clubs:1,failures:1});
    const dashboard=(await api('dashboard')).body;
    expect(dashboard.clubs[0].status).toBe('credential_required');expect(dashboard.records).toEqual(before);
    expect(dashboard.clubs[0].stale).toBe(true);
    expect((await api(`clubs/${id}/status`)).body[0]).toMatchObject({state:'error',datasets:{connection:'credential_required'}});
    const count=reads;expect(await syncAll()).toEqual({clubs:0,failures:0});expect(reads).toBe(count);
    expect((await api(`clubs/${id}/test`,{})).code).toBe(409);
  });
  it('replaces a key, requires fresh reconciliation, then disconnects without scheduling more reads',async()=>{
    const id=await onboard();await reconcile(id);await api(`clubs/${id}/activate`,{reconciled:true});
    const changed=await api(`clubs/${id}/credential`,{token:replacementKey,issuer:'Fixture owner',authorisation:'Fixture rotation approval'});expect(changed.code).toBe(200);
    expect((await api('dashboard')).body.clubs[0].stale).toBe(true);
    expect((await api(`clubs/${id}/activate`,{reconciled:true})).code).toBe(409);
    await reconcile(id);expect((await api(`clubs/${id}/activate`,{reconciled:true})).code).toBe(200);
    expect((await api(`clubs/${id}/disconnect`,{})).code).toBe(200);
    const stored=(await db().query('SELECT encrypted_token,status FROM hrd_clubs WHERE id=$1',[id])).rows[0];expect(stored.encrypted_token).toBeNull();expect(stored.status).toBe('disconnected');
    const count=reads;expect(await syncAll()).toEqual({clubs:0,failures:0});expect(reads).toBe(count);
  });
  it('keeps clubs isolated and preserves previous data on a failed or duplicate dataset',async()=>{
    const first=await onboard();const second=await onboard(replacementKey,'Second fixture club');await reconcile(first);await reconcile(second);
    const previous=(await db().query("SELECT source_id,data FROM hrd_records WHERE club_id=$1 AND entity_type='employee'",[first])).rows;
    failRoute='/api/employees';expect((await api(`clubs/${first}/sync`,{})).body.state).toBe('partial');
    expect((await api('dashboard')).body.clubs.find((c:{id:string})=>c.id===first).stale).toBe(true);
    expect((await db().query("SELECT source_id,data FROM hrd_records WHERE club_id=$1 AND entity_type='employee'",[first])).rows).toEqual(previous);
    failRoute='';duplicateEmployee=true;expect((await api(`clubs/${first}/sync`,{})).body.state).toBe('partial');
    expect((await db().query("SELECT source_id,data FROM hrd_records WHERE club_id=$1 AND entity_type='employee'",[first])).rows).toEqual(previous);
    const other=(await api('dashboard')).body.clubs.find((c:{id:string})=>c.id===second);expect(other.employeeCount).toBe(1);expect(other.horseCount).toBe(1);
  });
  it('keeps optional route denials visible while permitting reconciliation of available data',async()=>{
    const id=await onboard();deniedRoute='/api/medicine-logs';
    const result=await reconcile(id);expect(result.state).toBe('limited');expect(result.datasets.medicine).toBe('denied');
    expect((await api(`clubs/${id}/activate`,{reconciled:true})).code).toBe(200);
    const checks=(await api('dashboard')).body.checks;expect(checks.find((c:{route:string})=>c.route===deniedRoute).state).toBe('denied');
  });
  it('enforces HRD sessions, origin, CSRF and reconciliation freshness',async()=>{
    expect((await api('dashboard',undefined,{session:''})).code).toBe(401);
    const id=await onboard();await reconcile(id);
    expect((await api(`clubs/${id}/activate`,{reconciled:true},{csrf:'wrong'})).code).toBe(403);
    expect((await api(`clubs/${id}/activate`,{reconciled:true},{origin:'http://attacker.test'})).code).toBe(403);
    await db().query("UPDATE hrd_clubs SET last_success_at=now()-interval '16 minutes' WHERE id=$1",[id]);
    expect((await api(`clubs/${id}/activate`,{reconciled:true})).code).toBe(409);
  });
  it('rejects sharing a credential between connected clubs, including during rotation',async()=>{
    const first=await onboard();
    const duplicate=await api('clubs',{name:'Duplicate fixture',baseUrl:base,token:permanentKey,issuer:'Fixture owner',authorisation:'Fixture written approval',termsConfirmed:true});
    expect(duplicate.code).toBe(409);expect(duplicate.body.error).not.toContain(permanentKey);
    const second=await onboard(replacementKey,'Independent fixture');
    expect((await api(`clubs/${second}/credential`,{token:permanentKey,issuer:'Fixture owner',authorisation:'Fixture written approval'})).code).toBe(409);
    expect((await db().query('SELECT credential_version FROM hrd_clubs WHERE id=$1',[second])).rows[0].credential_version).toBe(1);
    await api(`clubs/${first}/disconnect`,{});
    expect((await db().query('SELECT credential_fingerprint FROM hrd_clubs WHERE id=$1',[first])).rows[0].credential_fingerprint).toBeNull();
  });
  it('preserves existing connections when migrations rerun and backfills legacy fingerprints',async()=>{
    const id=await onboard();await reconcile(id);
    const before=(await api('dashboard')).body.records;
    await db().query('UPDATE hrd_clubs SET credential_fingerprint=NULL WHERE id=$1',[id]);
    await runMigrations();await runMigrations();
    const stored=(await db().query('SELECT credential_fingerprint FROM hrd_clubs WHERE id=$1',[id])).rows[0];
    expect(stored.credential_fingerprint).toBe(createHash('sha256').update(permanentKey).digest('hex'));
    expect((await api('dashboard')).body.records).toEqual(before);
    expect((await db().query('SELECT count(*)::int AS count FROM hrd_migrations')).rows[0].count).toBe(3);
  });
  it('records connection failures before import, preserves cached data, and recovers on the next sync',async()=>{
    const id=await onboard();await reconcile(id);await api(`clubs/${id}/activate`,{reconciled:true});
    const before=(await api('dashboard')).body.records;
    failRoute='/api/auth/me';expect(await syncAll()).toEqual({clubs:1,failures:1});
    const latest=(await api(`clubs/${id}/status`)).body[0];
    expect(latest).toMatchObject({state:'error',datasets:{connection:'error'}});expect(latest.finished_at).toBeTruthy();
    const dashboard=(await api('dashboard')).body;
    expect(dashboard.records).toEqual(before);expect(dashboard.clubs[0]).toMatchObject({stale:true,validatedAt:null,status:'active'});
    failRoute='';expect(await syncAll()).toEqual({clubs:1,failures:0});
    expect((await api('dashboard')).body.clubs[0].stale).toBe(false);
  });
  it('prevents lifecycle changes while a sync holds the club lock',async()=>{
    const id=await onboard();await reconcile(id);
    const lock=await db().connect();
    try {
      await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[id]);
      expect((await api(`clubs/${id}/sync`,{})).body.state).toBe('busy');
      for(const [action,body] of [['disconnect',{}],['activate',{reconciled:true}],['credential',{token:replacementKey,issuer:'Fixture owner',authorisation:'Fixture approval'}]] as const)
        expect((await api(`clubs/${id}/${action}`,body)).code).toBe(409);
      expect((await db().query('SELECT status,credential_version FROM hrd_clubs WHERE id=$1',[id])).rows[0]).toMatchObject({status:'pending',credential_version:1});
    }finally{await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[id]);lock.release();}
  });
  it('purges disconnected personal data after retention without deleting another club',async()=>{
    const first=await onboard();const second=await onboard(replacementKey,'Second club');await reconcile(first);await reconcile(second);
    await api(`clubs/${first}/disconnect`,{});await maintenance();
    expect((await db().query('SELECT count(*)::int AS count FROM hrd_records WHERE club_id=$1',[first])).rows[0].count).toBeGreaterThan(0);
    await db().query("UPDATE hrd_clubs SET disconnected_at=now()-interval '31 days' WHERE id=$1",[first]);
    await maintenance();
    expect((await db().query('SELECT count(*)::int AS count FROM hrd_records WHERE club_id=$1',[first])).rows[0].count).toBe(0);
    expect((await db().query('SELECT count(*)::int AS count FROM hrd_records WHERE club_id=$1',[second])).rows[0].count).toBeGreaterThan(0);
    expect((await db().query('SELECT encrypted_token,issuer FROM hrd_clubs WHERE id=$1',[first])).rows[0]).toMatchObject({encrypted_token:null,issuer:'Purged'});
  });
});
