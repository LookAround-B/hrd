// LOCAL TESTING ONLY. Creates an admin session without Google so the dashboard can be opened.
// Usage: npm run dev:session -w backend -- you@example.com
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../src/lib/db';

if (process.env.NODE_ENV === 'production') throw new Error('dev-session is disabled in production');
const email = (process.argv[2] || process.env.ADMIN_EMAILS?.split(',')[0] || '').trim().toLowerCase();
if (!email) throw new Error('Pass an email or set ADMIN_EMAILS');
if (!(process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(v => v.trim()).includes(email)) throw new Error(`${email} is not in ADMIN_EMAILS`);

const token = randomBytes(32).toString('hex');
await db().query('INSERT INTO hrd_admin_sessions(token_hash,email,csrf,expires_at) VALUES($1,$2,$3,$4)',
  [createHash('sha256').update(token).digest('hex'), email, randomBytes(24).toString('hex'), new Date(Date.now() + 43200000)]);
await db().end();
console.log(`Session for ${email} (12h). In the browser console on http://localhost:8001 run:\n\ndocument.cookie = "hrd_session=${token}; path=/"; location.reload();\n`);
