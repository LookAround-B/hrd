import { Pool, type PoolClient } from 'pg';
const globalDb = globalThis as unknown as { hrdPool?: Pool };
export function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error('HRD database is not configured');
  globalDb.hrdPool ??= new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
  return globalDb.hrdPool;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
