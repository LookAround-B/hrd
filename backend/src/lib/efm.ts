import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, request } from 'undici';
import { performance } from 'node:perf_hooks';
import { HttpError } from './auth';
import { hash, tokenExpiry } from './crypto';

const blocked = new BlockList();
for (const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(ip,prefix,'ipv4');
for (const [ip,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) blocked.addSubnet(ip,prefix,'ipv6');
export function isPublicIp(ip: string): boolean {
  if (isIP(ip)===4) return !blocked.check(ip,'ipv4');
  if (isIP(ip)===6) return /^[23][0-9a-f]{3}:/i.test(ip) && !blocked.check(ip,'ipv6');
  return false;
}
export function approvedBaseUrl(input: string): URL {
  let url: URL; try { url=new URL(input); } catch { throw new HttpError(400,'Enter a valid HTTPS EFM website URL.'); }
  const hosts=(process.env.EFM_ALLOWED_HOSTS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(url.protocol!=='https:' || url.username || url.password || url.port || url.pathname!=='/' || url.search || url.hash || isIP(url.hostname) || !hosts.includes(url.hostname.toLowerCase()))
    throw new HttpError(400,'Use an approved HTTPS EFM hostname, without a port, path, query, or credentials.');
  return url;
}
export const queryAllowList: Record<string, string[]> = {
  '/api/auth/me':[], '/api/employees':['skip','take','includePending'], '/api/horses':['skip','take'],
  '/api/horse-care-team':[], '/api/health-records':['skip','take'], '/api/medicine-logs':[],
  '/api/feed-inventory':[], '/api/feed-inventory/consumption-report':['startDate','endDate'], '/api/groceries-inventory':[],
  '/api/integrations/horse-feed-plans':['skip','take'], '/api/integrations/grocery-usage':['skip','take'], '/api/integrations/manifest':[]
};
export function approvedPath(path: string): boolean { return path in queryAllowList || /^\/api\/employees\/[a-zA-Z0-9_-]{1,100}$/.test(path); }
export function efmUrl(base: string,path: string,query: Record<string,string>={}): URL {
  const url=approvedBaseUrl(base);
  if(!approvedPath(path)) throw new HttpError(400,'EFM route is not approved for HRD.');
  const keys=queryAllowList[path]||[];
  if(Object.keys(query).some(k=>!keys.includes(k))) throw new HttpError(400,'EFM query parameter is not approved.');
  url.pathname=path;
  for(const [k,v] of Object.entries(query)) { if(v.length>100) throw new HttpError(400,'EFM query is too long.'); url.searchParams.set(k,v); }
  return url;
}
export class EfmError extends Error {
  constructor(public status: number | null, public latencyMs: number, public category: 'credential_required'|'denied'|'error', message: string) { super(message); }
}
export type EfmResult = { body: unknown; status: number; latencyMs: number };
export type EfmRead = (base: string,token: string,path: string,query?: Record<string,string>) => Promise<EfmResult>;
export function retryDelay(header: string | string[] | undefined, now=Date.now()): number {
  const value=Array.isArray(header)?header[0]:header;
  if(!value) return 1000;
  const ms=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-now;
  return Number.isFinite(ms)?Math.max(0,ms):1000;
}
type EfmRequest = { method: 'GET' | 'POST'; headers: Record<string,string>; body?: string };
export type EfmTransport = (url: URL, options: EfmRequest) => Promise<EfmResult>;
const requestEfm: EfmTransport = async (url,options) => {
  const start=performance.now();
  // Resolve once and pin the socket to the checked address, preventing DNS rebinding.
  let addresses;
  try { addresses=await lookup(url.hostname,{all:true}); }
  catch { throw new EfmError(null,Math.round(performance.now()-start),'error','EFM hostname could not be resolved.'); }
  if(!addresses.length||addresses.some(v=>!isPublicIp(v.address))) throw new EfmError(null,0,'error','EFM hostname does not resolve exclusively to public addresses.');
  const selected=addresses[0];
  const dispatcher=new Agent({ connect: { timeout:10000, lookup: (_hostname,options,callback) => {
    if(typeof options==='object' && options.all) callback(null,[selected]); else callback(null,selected.address,selected.family);
  } } });
  try {
    for(let attempt=0;attempt<3;attempt++) {
      let result;
      // Undici request does not follow redirects; no redirect interceptor is installed on this Agent.
      try { result=await request(url,{ dispatcher,...options,headersTimeout:10000,bodyTimeout:10000,signal:AbortSignal.timeout(10000) }); }
      catch { if(attempt<2) { await new Promise(r=>setTimeout(r,500*2**attempt)); continue; } throw new EfmError(null,Math.round(performance.now()-start),'error','EFM request timed out or failed.'); }
      const latencyMs=Math.round(performance.now()-start); const status=result.statusCode;
      if(status===401||status===403) { await result.body.dump(); throw new EfmError(status,latencyMs,status===401?'credential_required':'denied',status===401?'EFM credential expired or was revoked.':'EFM denied access to this route.'); }
      if(status===429||status>=500) {
        await result.body.dump(); const delay=status===429?retryDelay(result.headers['retry-after']):500*2**attempt;
        if(attempt===2||delay>30000) throw new EfmError(status,latencyMs,'error','EFM is rate-limited or unavailable; retained the previous data.');
        await new Promise(r=>setTimeout(r,Math.max(250,delay)));continue;
      }
      if(status!==200) { await result.body.dump(); throw new EfmError(status,latencyMs,'error',status>=300&&status<400?'EFM redirects are not followed.':'EFM did not return a successful response.'); }
      try {
        const chunks:Buffer[]=[];let size=0;
        for await(const chunk of result.body) { size+=chunk.length; if(size>5*1024*1024) { result.body.destroy();throw new Error('Response too large'); } chunks.push(Buffer.from(chunk)); }
        return {body:JSON.parse(Buffer.concat(chunks).toString('utf8')),status,latencyMs};
      } catch { throw new EfmError(status,latencyMs,'error','EFM response was not valid bounded JSON.'); }
    }
    throw new EfmError(null,0,'error','EFM request failed.');
  } finally { await dispatcher.close(); }
};

export function isIntegrationKey(value: string): boolean { return /^efm_live_[A-Za-z0-9_-]{40,80}$/.test(value); }

// Cache only short-lived access tokens in memory, indexed by a key hash.
// The persistent key remains encrypted in HRD's existing credential store.
export function createEfmReader(transport: EfmTransport=requestEfm): EfmRead {
  const cache=new Map<string,{until:number;pending:Promise<string>}>();
  async function accessToken(base:string,key:string,cacheId:string):Promise<string> {
    const existing=cache.get(cacheId);
    if(existing && existing.until>Date.now()) return existing.pending;
    const entry={until:Date.now()+10000,pending:Promise.resolve('')};
    entry.pending=(async()=>{
      const url=approvedBaseUrl(base);url.pathname='/api/integrations/token';
      const result=await transport(url,{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({key})});
      const body=result.body as {token?:unknown;expiresIn?:unknown}|null;
      const token=body?.token;
      const expiry=typeof token==='string'?tokenExpiry(token):null;
      if(typeof token!=='string'||token.length>10000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token)||!expiry||
        typeof body?.expiresIn!=='number'||!Number.isInteger(body.expiresIn)||body.expiresIn<=60||body.expiresIn>900||
        expiry.getTime()<=Date.now()+60000||expiry.getTime()>Date.now()+901000)
        throw new EfmError(result.status,result.latencyMs,'error','EFM returned an invalid integration access token.');
      entry.until=Math.min(expiry.getTime(),Date.now()+body.expiresIn*1000)-60000;
      return token;
    })();
    cache.delete(cacheId);
    if(cache.size>=1000) cache.delete(cache.keys().next().value!);
    cache.set(cacheId,entry);
    try { return await entry.pending; }
    catch(error) {if(cache.get(cacheId)===entry)cache.delete(cacheId);throw error;}
  }
  return async(base,credential,path,query={})=>{
    const url=efmUrl(base,path,query);
    const persistent=isIntegrationKey(credential);
    if(credential.startsWith('efm_live_')&&!persistent) throw new EfmError(401,0,'credential_required','Invalid EFM integration key.');
    const cacheId=persistent?`${url.origin}:${hash(credential)}`:'';
    const token=persistent?await accessToken(base,credential,cacheId):credential;
    const read=(value:string)=>transport(url,{method:'GET',headers:{authorization:`Bearer ${value}`,accept:'application/json'}});
    try {return await read(token);}
    catch(error) {
      if(persistent&&error instanceof EfmError&&error.status===401) {
        cache.delete(cacheId);
        // A cached token can expire or contain an old role. Exchange once more;
        // revoked keys and blocked accounts are rejected by EFM's token service.
        return read(await accessToken(base,credential,cacheId));
      }
      throw error;
    }
  };
}
export const readEfm: EfmRead=createEfmReader();
