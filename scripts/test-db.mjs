// Start a disposable local PostgreSQL instance. Never load backend/.env.
import { mkdtemp, readdir, access, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function run(command,args,options={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:'inherit',...options});
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`${command} exited ${code??signal}`)));
  });
}
async function postgresBin() {
  if(process.env.HRD_TEST_POSTGRES_BIN) {
    await access(join(process.env.HRD_TEST_POSTGRES_BIN,'initdb'));
    return process.env.HRD_TEST_POSTGRES_BIN;
  }
  const versions=(await readdir('/usr/lib/postgresql')).sort((a,b)=>Number(b)-Number(a));
  for(const version of versions) {
    const bin=join('/usr/lib/postgresql',version,'bin');
    try {await access(join(bin,'initdb'));return bin;} catch {/* Try the next installed version. */}
  }
  throw new Error('Set HRD_TEST_POSTGRES_BIN to an installed PostgreSQL bin directory.');
}
async function freePort() {
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}

const directory=await mkdtemp(join(tmpdir(),'hrd-integration-test-'));
let bin,started=false,safeToRemove=true;
try {
  bin=await postgresBin();
  const port=await freePort();
  await run(join(bin,'initdb'),['-D',join(directory,'data'),'-A','trust','-U','hrd_test','--no-locale','--encoding=UTF8'],{stdio:'ignore'});
  try {
    await run(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-l',join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${directory}`,'-w','start']);
    started=true;
  } catch(error) {
    console.error(await readFile(join(directory,'postgres.log'),'utf8').catch(()=>''));throw error;
  }
  await run(join(bin,'createdb'),['-h','127.0.0.1','-p',String(port),'-U','hrd_test','hrd_test']);
  const url=`postgresql://hrd_test@127.0.0.1:${port}/hrd_test`;
  await run(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/database.test.ts'],{
    env:{...process.env,HRD_TEST_DATABASE_URL:url,DATABASE_URL:url,DB_SSL:'false'},
  });
} catch(error) {
  console.error(error.message);process.exitCode=1;
} finally {
  if(started) {
    try {await run(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-m','fast','-w','stop']);}
    catch {console.error(`Test PostgreSQL did not stop; inspect ${directory}.`);process.exitCode=1;safeToRemove=false;}
  }
  // Keep files if a server failed to stop; otherwise remove only our temp dir.
  if(safeToRemove) await rm(directory,{recursive:true,force:true});
}
