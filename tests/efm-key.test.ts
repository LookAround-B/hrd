import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEfmReader, EfmError, approvedBaseUrl, approvedPath, isPublicIp, type EfmTransport } from '../backend/src/lib/efm';
import { encryptToken, decryptToken, tokenExpiry } from '../backend/src/lib/crypto';
import { connectionString, sslOptions } from '../backend/src/lib/db';

const base='https://efm.example.com';
const key=`efm_live_${'a'.repeat(43)}`;
const jwt=(seconds=900)=>`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+seconds})).toString('base64url')}.signature`;
const ok=(body:unknown)=>({body,status:200,latencyMs:1});
beforeEach(()=>{vi.useRealTimers();process.env.EFM_ALLOWED_HOSTS='efm.example.com';});

describe('persistent EFM credentials',()=>{
  it('exchanges a key once, keeps it out of data requests, and reuses the access token',async()=>{
    const access=jwt();
    const transport=vi.fn<EfmTransport>().mockResolvedValueOnce(ok({token:access,expiresIn:900})).mockResolvedValue(ok([]));
    const read=createEfmReader(transport);
    await read(base,key,'/api/employees',{take:'500'});await read(base,key,'/api/horses');
    expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls[0][0].href).toBe(`${base}/api/integrations/token`);
    expect(transport.mock.calls[0][1]).toEqual({method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({key})});
    expect(transport.mock.calls[1][1].headers.authorization).toBe(`Bearer ${access}`);
    expect(JSON.stringify(transport.mock.calls.slice(1))).not.toContain(key);
  });
  it('shares concurrent exchanges and renews before access-token expiry',async()=>{
    vi.useFakeTimers();
    const transport=vi.fn<EfmTransport>().mockImplementation(async(url)=>ok(url.pathname==='/api/integrations/token'?{token:jwt(),expiresIn:900}:[]));
    const read=createEfmReader(transport);
    await Promise.all([read(base,key,'/api/horses'),read(base,key,'/api/employees')]);
    expect(transport.mock.calls.filter(([u])=>u.pathname==='/api/integrations/token')).toHaveLength(1);
    vi.advanceTimersByTime(841000);await read(base,key,'/api/horses');
    expect(transport.mock.calls.filter(([u])=>u.pathname==='/api/integrations/token')).toHaveLength(2);
    vi.useRealTimers();
  });
  it('isolates credentials and hostnames in the cache',async()=>{
    process.env.EFM_ALLOWED_HOSTS='efm.example.com,other.example.com';
    const transport=vi.fn<EfmTransport>().mockImplementation(async(url)=>ok(url.pathname==='/api/integrations/token'?{token:jwt(),expiresIn:900}:[]));
    const read=createEfmReader(transport);
    await read(base,key,'/api/horses');await read(base,`efm_live_${'b'.repeat(43)}`,'/api/horses');await read('https://other.example.com',key,'/api/horses');
    expect(transport.mock.calls.filter(([u])=>u.pathname==='/api/integrations/token')).toHaveLength(3);
  });
  it('preserves existing employee JWT requests without an exchange',async()=>{
    const token=jwt();const transport=vi.fn<EfmTransport>().mockResolvedValue(ok([]));
    await createEfmReader(transport)(base,token,'/api/horses');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1].headers.authorization).toBe(`Bearer ${token}`);
  });
  it('re-exchanges once after a rejected cached token, and propagates key revocation',async()=>{
    const transport=vi.fn<EfmTransport>().mockResolvedValueOnce(ok({token:jwt(),expiresIn:900})).mockResolvedValueOnce(ok([]))
      .mockRejectedValueOnce(new EfmError(401,1,'credential_required','old token'))
      .mockRejectedValueOnce(new EfmError(401,1,'credential_required','revoked key'));
    const read=createEfmReader(transport);await read(base,key,'/api/horses');
    await expect(read(base,key,'/api/horses')).rejects.toMatchObject({status:401,category:'credential_required'});
    expect(transport).toHaveBeenCalledTimes(4);
  });
  it('recovers from an old role token without requiring a replacement key',async()=>{
    const transport=vi.fn<EfmTransport>().mockResolvedValueOnce(ok({token:jwt(),expiresIn:900}))
      .mockRejectedValueOnce(new EfmError(401,1,'credential_required','role changed'))
      .mockResolvedValueOnce(ok({token:jwt(),expiresIn:900})).mockResolvedValueOnce(ok([]));
    await expect(createEfmReader(transport)(base,key,'/api/horses')).resolves.toEqual(ok([]));
    expect(transport).toHaveBeenCalledTimes(4);
  });
  it('keeps route permission denials visible without retrying or exchanging',async()=>{
    const transport=vi.fn<EfmTransport>().mockResolvedValueOnce(ok({token:jwt(),expiresIn:900})).mockRejectedValueOnce(new EfmError(403,1,'denied','denied'));
    await expect(createEfmReader(transport)(base,key,'/api/horses')).rejects.toMatchObject({category:'denied'});
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each([{token:'bad',expiresIn:900},{token:jwt(-1),expiresIn:900},{token:jwt(),expiresIn:0},{token:jwt(3600),expiresIn:3600},null])('rejects invalid exchange response %j',async(body)=>{
    const transport=vi.fn<EfmTransport>().mockResolvedValue(ok(body));
    await expect(createEfmReader(transport)(base,key,'/api/horses')).rejects.toMatchObject({category:'error'});
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('discards failed exchanges so a later request can recover',async()=>{
    const transport=vi.fn<EfmTransport>().mockRejectedValueOnce(new EfmError(503,1,'error','unavailable')).mockResolvedValueOnce(ok({token:jwt(),expiresIn:900})).mockResolvedValueOnce(ok([]));
    const read=createEfmReader(transport);await expect(read(base,key,'/api/horses')).rejects.toThrow();
    await expect(read(base,key,'/api/horses')).resolves.toEqual(ok([]));
  });
  it('rejects unapproved hosts, paths and query keys before transmitting a credential',async()=>{
    const transport=vi.fn<EfmTransport>();const read=createEfmReader(transport);
    await expect(read('https://attacker.example.com',key,'/api/horses')).rejects.toThrow();
    await expect(read(base,key,'/api/integrations/token')).rejects.toThrow();
    await expect(read(base,key,'/api/horse-feeds')).rejects.toThrow();
    await expect(read(base,key,'/api/horses',{redirect:'https://attacker.example.com'})).rejects.toThrow();
    await expect(read(base,'efm_live_invalid','/api/horses')).rejects.toMatchObject({category:'credential_required'});
    expect(transport).not.toHaveBeenCalled();
  });
  it('preserves HTTPS and public-address restrictions',()=>{
    expect(()=>approvedBaseUrl('http://efm.example.com')).toThrow();
    expect(()=>approvedBaseUrl('https://efm.example.com:8500')).toThrow();
    expect(isPublicIp('127.0.0.1')).toBe(false);expect(isPublicIp('10.0.0.1')).toBe(false);
    expect(isPublicIp('::1')).toBe(false);expect(isPublicIp('::ffff:127.0.0.1')).toBe(false);
    expect(approvedPath('/api/stock-tracker')).toBe(false);
  });
  it('stores a persistent key encrypted without an expiry',()=>{
    process.env.TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
    const encrypted=encryptToken(key,'club-a');expect(encrypted).not.toContain(key);
    expect(decryptToken(encrypted,'club-a')).toBe(key);expect(()=>decryptToken(encrypted,'club-b')).toThrow();
    expect(tokenExpiry(key)).toBeNull();
  });
});

describe('database connection',()=>{
  it('drops SSL parameters from the URL so they cannot override certificate checks',()=>{
    expect(connectionString('postgresql://u:p@db.example.com:5432/hrd?sslmode=no-verify&ssl=true&sslrootcert=/tmp/ca.pem&application_name=hrd'))
      .toBe('postgresql://u:p@db.example.com:5432/hrd?application_name=hrd');
  });
  it('trusts the pinned VPS certificate when only DB_SSL_SERVERNAME is set, and lets DB_CA_CERT override it',()=>{
    const pinned=sslOptions({DB_SSL_SERVERNAME:'srv1428008.hstgr.cloud'});
    expect(pinned&&pinned.ca).toContain('BEGIN CERTIFICATE');
    expect(sslOptions({DB_SSL_SERVERNAME:'srv1428008.hstgr.cloud',DB_CA_CERT:'custom'})).toMatchObject({ca:'custom'});
    expect(sslOptions({})).toMatchObject({ca:undefined});
  });
  it('checks the certificate against DB_SSL_SERVERNAME when the URL uses an IP',()=>{
    expect(sslOptions({DB_SSL:'false'})).toBe(false);
    const options=sslOptions({DB_SSL_SERVERNAME:'db.example.com'});
    expect(options&&options.servername).toBe('db.example.com');
    const cert={subject:{CN:'db.example.com'},subjectaltname:'DNS:db.example.com'} as never;
    expect(options&&options.checkServerIdentity!('187.77.185.220',cert)).toBeUndefined();
    expect(options&&options.checkServerIdentity!('187.77.185.220',{subject:{CN:'evil.example.com'},subjectaltname:'DNS:evil.example.com'} as never)).toBeInstanceOf(Error);
  });
});
