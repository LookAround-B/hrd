import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { NextApiRequest, NextApiResponse } from 'next';
import { db,transaction } from './db';
import type { PoolClient } from 'pg';
import { hash } from './crypto';
import type { SessionUser } from '../../../shared/types';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function adminEmails(): string[] { return (process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean); }
export function assertAdminEmail(email: string, verified: boolean) {
  if (!verified || !adminEmails().includes(email.toLowerCase())) throw new HttpError(403, 'This Google account is not an approved HRD administrator.');
}
export function assertOrigin(req: NextApiRequest) {
  if (!process.env.APP_ORIGIN || req.headers.origin !== process.env.APP_ORIGIN) throw new HttpError(403, 'Request origin rejected.');
}
export async function rateLimit(bucket: string, max: number, seconds: number) {
  const { rows } = await db().query(`INSERT INTO hrd_rate_limits(bucket,count,expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN hrd_rate_limits.expires_at<now() THEN 1 ELSE hrd_rate_limits.count+1 END,
    expires_at=CASE WHEN hrd_rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE hrd_rate_limits.expires_at END RETURNING count`, [bucket,seconds]);
  if (rows[0].count > max) throw new HttpError(429, 'Too many attempts. Try again in a minute.');
}
export async function audit(actor: string, action: string, clubId?: string, details: Record<string, unknown> = {},client?:PoolClient) {
  await (client||db()).query('INSERT INTO hrd_audit_events(id,actor,action,club_id,details) VALUES($1,$2,$3,$4,$5)', [randomUUID(),actor,action,clubId || null,JSON.stringify(details)]);
}
export function sessionCookie(token: string, clear = false): string {
  return `hrd_session=${clear ? '' : token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${clear ? 0 : 43200}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
function sessionToken(req: NextApiRequest): string { return req.cookies.hrd_session || ''; }
// Temporary demo access (phone + access code) until Google sign-in is configured for every admin.
// Credentials live only in server env; access ends at DEMO_LOGIN_UNTIL or as soon as the env is removed.
export const DEMO_IDENTITY = 'demo-admin';
export function demoLogin() {
  const phone = (process.env.DEMO_LOGIN_PHONE || '').replace(/\D/g, '');
  const code = process.env.DEMO_LOGIN_CODE || '';
  const until = Date.parse(process.env.DEMO_LOGIN_UNTIL || '');
  return { enabled: phone.length >= 10 && code.length >= 8 && Number.isFinite(until) && until > Date.now(), phone, code, until };
}
function allowedIdentity(email: string): boolean {
  return adminEmails().includes(email.toLowerCase()) || (email === DEMO_IDENTITY && demoLogin().enabled);
}
const sameSecret = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a), 'hex'), Buffer.from(hash(b), 'hex'));
async function startSession(res: NextApiResponse, email: string, expiresAt: Date, action: string) {
  const token = randomBytes(32).toString('hex'); const csrf = randomBytes(24).toString('hex');
  await transaction(async client=>{
    await client.query('INSERT INTO hrd_admin_sessions(token_hash,email,csrf,expires_at) VALUES($1,$2,$3,$4)', [hash(token),email,csrf,expiresAt]);
    await audit(email,action,undefined,{},client);
  });
  res.setHeader('Set-Cookie',sessionCookie(token));
  return { email, csrf, expiresAt: expiresAt.toISOString() };
}
export async function loginDemo(req: NextApiRequest, res: NextApiResponse, input: { phone: string; code: string }) {
  assertOrigin(req);
  const demo = demoLogin();
  if (!demo.enabled) throw new HttpError(404, 'Demo sign-in is not available.');
  await rateLimit('demo-login', 30, 60);
  const failures = 'demo-login-failures';
  const locked = (await db().query('SELECT count FROM hrd_rate_limits WHERE bucket=$1 AND expires_at>now()', [failures])).rows[0]?.count >= 10;
  if (locked) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const phone = input.phone.replace(/\D/g, '');
  const code = input.code;
  if (!phone || !code || !sameSecret(phone.slice(-10), demo.phone.slice(-10)) || !sameSecret(code, demo.code)) {
    await audit('anonymous','demo_login_failed');
    await rateLimit(failures, 10, 900).catch(() => {});
    throw new HttpError(401, 'Phone number or access code is incorrect.');
  }
  return startSession(res, DEMO_IDENTITY, new Date(Math.min(Date.now()+43200000, demo.until)), 'demo_login_success');
}
export async function requireSession(req: NextApiRequest, mutation = false): Promise<SessionUser> {
  const token = sessionToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, 'Sign in to HRD to continue.');
  const { rows } = await db().query('SELECT email,csrf,expires_at FROM hrd_admin_sessions WHERE token_hash=$1 AND expires_at>now()', [hash(token)]);
  const row = rows[0];
  if (!row || !allowedIdentity(row.email)) throw new HttpError(401, 'Your HRD session has expired. Sign in again.');
  if (mutation) { assertOrigin(req); if (req.headers['x-hrd-csrf'] !== row.csrf) throw new HttpError(403, 'Session verification failed. Reload the page.'); }
  return { email: row.email, csrf: row.csrf, expiresAt: row.expires_at.toISOString() };
}
export async function login(req: NextApiRequest, res: NextApiResponse, input: { credential: string }) {
  assertOrigin(req);
  // Global budget cannot be bypassed by spoofing proxy headers. Per-account budget follows verified identity.
  await rateLimit('google-login', 60, 60);
  if (!process.env.GOOGLE_CLIENT_ID || !adminEmails().length) throw new HttpError(503, 'Admin sign-in is not configured yet.');
  const credential = input.credential;
  let payload;
  try { payload = (await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID })).getPayload(); }
  catch { await audit('anonymous','login_failed'); throw new HttpError(401, 'Google sign-in could not be verified.'); }
  const email = payload?.email?.toLowerCase() || '';
  try { assertAdminEmail(email, payload?.email_verified === true); }
  catch (error) { await audit('anonymous','login_denied'); throw error; }
  await rateLimit(`google-account:${hash(email)}`, 10, 60);
  return startSession(res, email, new Date(Date.now()+43200000), 'login_success');
}
export async function logout(req: NextApiRequest, res: NextApiResponse, email: string) {
  await transaction(async client=>{
    await client.query('DELETE FROM hrd_admin_sessions WHERE token_hash=$1',[hash(sessionToken(req))]);
    await audit(email,'logout',undefined,{},client);
  });res.setHeader('Set-Cookie',sessionCookie('',true));
}
