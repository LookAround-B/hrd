import { readFile, readdir } from 'node:fs/promises';
import { transaction } from './db';
import { decryptToken,hash } from './crypto';

export async function runMigrations() {
  const directory=new URL('../../migrations/',import.meta.url);
  const files=(await readdir(directory)).filter(name=>/^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  await transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(18472001)');
    await client.query('CREATE TABLE IF NOT EXISTS hrd_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for(const file of files) {
      const sql=await readFile(new URL(file,directory),'utf8');const name=file.replace(/\.sql$/,'');
      const {rows}=await client.query('SELECT checksum FROM hrd_migrations WHERE name=$1',[name]);
      if(rows.length) {if(rows[0].checksum!==hash(sql))throw new Error('Applied HRD migration was changed');continue;}
      await client.query(sql);await client.query('INSERT INTO hrd_migrations(name,checksum) VALUES($1,$2)',[name,hash(sql)]);
    }
    // Older connections predate fingerprints. Backfill under the same lock;
    // duplicate legacy credentials make the transaction fail without data loss.
    const legacy=await client.query('SELECT id,encrypted_token FROM hrd_clubs WHERE encrypted_token IS NOT NULL AND credential_fingerprint IS NULL');
    for(const row of legacy.rows) await client.query('UPDATE hrd_clubs SET credential_fingerprint=$2 WHERE id=$1',[row.id,hash(decryptToken(row.encrypted_token,row.id))]);
  });
}
