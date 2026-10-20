// Operator tool: issue an EFM integration key and onboard it into HRD in one step.
// The plain key only travels through a child-process pipe and HRD's API; it is never printed.
// On any failure after issuance the key is revoked.
//
// Usage (HRD API must be running):
//   pnpm --filter @hrd/backend link:efm --efm-dir /path/to/Stable/backend --employee admin@stable.com \
//     --club "Club name" --issuer "EFM administrator" --authorisation "Written approval ref" [--activate]
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from '../src/lib/db';

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const next = argv[i + 1];
  args.set(argv[i].slice(2), next && !next.startsWith('--') ? (i++, next) : 'true');
}
const need = (k: string) => { const v = args.get(k); if (!v) throw new Error(`Missing --${k}`); return v; };
const efmDir = need('efm-dir'), employee = need('employee'), club = need('club');
const issuer = need('issuer'), authorisation = need('authorisation');
const baseUrl = args.get('base-url') || 'https://efm.eirs.app';
const api = (args.get('api') || 'http://localhost:8501').replace(/\/$/, '');
const origin = process.env.APP_ORIGIN || '';
const child = fileURLToPath(new URL('./efm-key-child.mjs', import.meta.url));

function efmKey(command: 'create' | 'revoke', value: string): Promise<any> {
  // Clean environment: EFM must load its own DATABASE_URL, never HRD's.
  const env = { PATH: process.env.PATH || '', HOME: process.env.HOME || '', NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [child, command, value, 'HRD'], { cwd: efmDir, env, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`EFM key ${command} failed`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('EFM key output unreadable')); }
    });
  });
}

const email = (process.env.ADMIN_EMAILS || '').split(',')[0]?.trim().toLowerCase();
if (!email || !origin) throw new Error('ADMIN_EMAILS and APP_ORIGIN must be set in HRD backend/.env');
const session = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
const sessionHash = createHash('sha256').update(session).digest('hex');

async function call(path: string, body?: unknown) {
  const res = await fetch(`${api}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie: `hrd_session=${session}`, origin, 'x-hrd-csrf': csrf, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${json.error || ''}`.trim());
  return json;
}

let keyId: string | null = null;
let clubId: string | null = null;
let linked = false;
try {
  await call('health');
  await db().query('INSERT INTO hrd_admin_sessions(token_hash,email,csrf,expires_at) VALUES($1,$2,$3,$4)',
    [sessionHash, email, csrf, new Date(Date.now() + 15 * 60_000)]);

  const issued = await efmKey('create', employee);
  keyId = issued.id;
  console.log(`EFM key issued for ${employee}. Key ID (keep for revocation): ${keyId}`);

  const { id } = await call('clubs', {
    name: club, brief: args.get('brief') || '', baseUrl, token: issued.key, authorisation, issuer,
    termsConfirmed: true, scopeNotes: 'Read-only HRD integration key', rateLimitNotes: 'EFM token exchange 30/min',
  });
  issued.key = '';
  clubId = id;
  console.log(`HRD club created: ${id}`);

  const test = await call(`clubs/${id}/test`, {});
  console.log(`Connection: ${test.message}${test.account?.name ? ` (as ${test.account.name})` : ''}`);
  linked = true;

  const sync = await call(`clubs/${id}/sync`, {});
  console.log(`Sync: ${sync.state}`);
  for (const [dataset, result] of Object.entries(sync.datasets || {})) console.log(`  ${dataset.padEnd(22)} ${result}`);

  if (args.get('activate') === 'true') {
    await call(`clubs/${id}/activate`, { reconciled: true });
    console.log('Club activated. Scheduled sync runs every 5 minutes.');
  } else console.log('Compare counts with EFM, then press Activate in HRD (or rerun with --activate).');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Link failed');
  if (clubId && !linked) await call(`clubs/${clubId}/disconnect`, {}).catch(() => {});
  if (keyId && !linked) {
    await efmKey('revoke', keyId).then(() => console.error(`Key ${keyId} revoked because onboarding did not complete.`),
      () => console.error(`Could not revoke ${keyId}; run: npm run integration:key -- revoke ${keyId}`));
  }
  process.exitCode = 1;
} finally {
  await db().query('DELETE FROM hrd_admin_sessions WHERE token_hash=$1', [sessionHash]).catch(() => {});
  await db().end();
}
