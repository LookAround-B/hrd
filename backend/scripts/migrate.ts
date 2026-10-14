import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { db, transaction } from '../src/lib/db';
import { hash } from '../src/lib/crypto';

async function main() {
  const sql = await readFile(fileURLToPath(new URL('../migrations/001_initial.sql',import.meta.url)),'utf8');
  await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(18472001)');
    await client.query('CREATE TABLE IF NOT EXISTS hrd_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query('SELECT checksum FROM hrd_migrations WHERE name=$1',['001_initial']);
    if (rows.length) { if (rows[0].checksum !== hash(sql)) throw new Error('Applied HRD migration was changed'); return; }
    await client.query(sql); await client.query('INSERT INTO hrd_migrations(name,checksum) VALUES($1,$2)',['001_initial',hash(sql)]);
  });
  console.log('HRD database migrations are current.');
}
main().catch(() => { console.error('HRD migration failed. Check its database connection and migration history.'); process.exitCode=1; }).finally(() => db().end());
