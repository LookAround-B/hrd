import { Pool, type PoolClient } from 'pg';
const globalDb = globalThis as unknown as { hrdPool?: Pool };
// pg lets SSL parameters in the URL override the ssl option (e.g. sslmode=no-verify would
// switch certificate checks off), so they are removed and DB_SSL/DB_CA_CERT alone decide.
export function connectionString(value: string): string {
  const url = new URL(value);
  for (const key of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) url.searchParams.delete(key);
  return url.toString();
}
export function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error('HRD database is not configured');
  globalDb.hrdPool ??= new Pool({ connectionString: connectionString(process.env.DATABASE_URL), ssl: process.env.DB_SSL === 'false' ? false : { ca: process.env.DB_CA_CERT?.replace(/\\n/g, '\n') || undefined }, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
  return globalDb.hrdPool;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
