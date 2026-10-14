import { db } from '../src/lib/db';
import { syncAll } from '../src/lib/sync';
syncAll().then(result=>{console.log(JSON.stringify(result));if(result.failures) process.exitCode=1;})
  .catch(()=>{console.error('HRD scheduled sync failed. Check HRD configuration and sync diagnostics.');process.exitCode=1;})
  .finally(()=>db().end());
