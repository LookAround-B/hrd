import { setTimeout as delay } from 'node:timers/promises';
import { db } from '../src/lib/db';
import { syncAll } from '../src/lib/sync';

const shutdown=new AbortController();
process.once('SIGTERM',()=>shutdown.abort());
process.once('SIGINT',()=>shutdown.abort());

async function main() {
  while(!shutdown.signal.aborted) {
    try {
      const result=await syncAll();
      console.log(`HRD sync: ${result.clubs} active clubs, ${result.failures} failures.`);
    } catch {
      console.error('HRD sync failed. Check database configuration and club diagnostics.');
    }
    try {await delay(300000,undefined,{signal:shutdown.signal});}
    catch(error) {if(!shutdown.signal.aborted)throw error;}
  }
}
main().catch(()=>{console.error('HRD sync worker stopped unexpectedly.');process.exitCode=1;})
  .finally(()=>db().end());
