import { db } from '../src/lib/db';
import { runMigrations } from '../src/lib/migrate';

async function main() {
  await runMigrations();
  console.log('HRD database migrations are current.');
}
main().catch(() => { console.error('HRD migration failed. Check its database connection and migration history.'); process.exitCode=1; }).finally(() => db().end());
