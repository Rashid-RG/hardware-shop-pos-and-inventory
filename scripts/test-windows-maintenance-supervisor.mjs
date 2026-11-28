// Disposable Windows CI fixture. No live database or installed application access.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Node's generic test discovery also finds this platform-specific fixture.
if(process.platform!=='win32'){
 console.log('Skipping native Windows supervisor fixture on non-Windows platform.');
 process.exit(0);
}
if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted')throw Error('Disposable Windows CI only.');
const [supervisor,dir]=process.argv.slice(2);
if(!supervisor||!dir)throw Error('Fixture paths required.');
async function run(mode){
 const marker=join(dir,mode+'.json');
 const source=mode==='success'
  ?"require('node:fs').writeFileSync(process.argv[1],'ok')"
  :"const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});const fs=require('node:fs');fs.writeFileSync(process.argv[1]+'.tmp',JSON.stringify([process.pid,c.pid]));fs.renameSync(process.argv[1]+'.tmp',process.argv[1]);setInterval(()=>{},1000)";
 const child=spawn(supervisor,[mode==='protocol'?'--invalid':'--private-worker-v1','15000',dir,process.execPath,'-e',source,marker],{cwd:dir,stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
 let output=0;
 child.stdout.on('data',b=>{output+=b.length;});
 child.stderr.on('data',b=>{output+=b.length;});
 child.stdin.on('error',()=>{});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 done.catch(()=>{});
 const timer=setTimeout(()=>child.kill(),30000);
 try{
  if(mode==='missing')child.stdin.end();
  else if(mode==='invalid')child.stdin.end('X');
  else if(mode==='protocol')child.stdin.end();
  else child.stdin.write('A');
  if(mode==='eof'||mode==='revoke'){
   let ids;
   for(let i=0;i<200;i++){
    try{ids=JSON.parse(await readFile(marker,'utf8'));break;}catch(e){if(e.code!=='ENOENT')throw e;}
    await delay(50);
   }
   assert.equal(ids?.length,2,'worker readiness not observed');
   if(mode==='eof')child.stdin.end();else child.stdin.write('X');
   assert.deepEqual(await done,{code:75,signal:null});
   for(const pid of ids){
    assert.ok(Number.isSafeInteger(pid)&&pid>1);
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
   }
  }else{
   assert.deepEqual(await done,{code:mode==='success'?0:mode==='protocol'?64:70,signal:null});
   if(mode==='success')assert.equal(await readFile(marker,'utf8'),'ok');
   else await assert.rejects(access(marker),{code:'ENOENT'});
  }
  assert.equal(output,0,'supervisor must not disclose diagnostics');
 }finally{
  clearTimeout(timer);
  child.stdin.destroy();
  if(child.exitCode===null&&child.signalCode===null){child.kill();await done.catch(()=>{});}
 }
}
for(const mode of ['protocol','missing','invalid','success','eof','revoke'])await run(mode);
console.log('Private Windows supervisor pipe regression checks passed.');

import {EventEmitter,getEventListeners} from 'node:events';
import {withMaintenanceSession} from './database-maintenance-session.mjs';
import {runWindowsMaintenanceWorker} from './windows-maintenance-supervisor-adapter.mjs';

class FixtureDatabase extends EventEmitter{
 constructor(){super();this.closed=false;this.pid=123;}
 async connect(){}
 async end(){this.closed=true;this.emit('end');}
 async query(sql){
  if(sql==='SELECT current_database() AS name')return {rows:[{name:'hardware_pos_ci'}]};
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};
  return {rows:[{pid:this.pid,started:'2026-01-01 00:00:00.123456+00',database:'hardware_pos_ci',database_oid:'12345',locks:3}]};
 }
}
const options={cwd:dir,timeoutMs:15000};
const db=new FixtureDatabase();
let capability;
const successMarker=join(dir,'adapter-success.txt');
await withMaintenanceSession(db,'hardware_pos_ci',async session=>{
 capability=session;
 await runWindowsMaintenanceWorker(session,supervisor,process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],'ok')",successMarker],options);
 assert.equal(db.closed,false);
 assert.equal(getEventListeners(session.signal,'abort').length,0);
});
assert.equal(await readFile(successMarker,'utf8'),'ok');
assert.equal(db.closed,true);
assert.equal(capability.signal.aborted,true);

const refused=join(dir,'adapter-refused.txt');
await assert.rejects(runWindowsMaintenanceWorker(capability,supervisor,process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],'unexpected')",refused],options),/unavailable/);
await assert.rejects(access(refused),{code:'ENOENT'});

for(const mode of ['error','end','identity']){
 const database=new FixtureDatabase();
 const marker=join(dir,'adapter-'+mode+'.json');
 const source="const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});const fs=require('node:fs');fs.writeFileSync(process.argv[1]+'.tmp',JSON.stringify([process.pid,c.pid]));fs.renameSync(process.argv[1]+'.tmp',process.argv[1]);setInterval(()=>{},1000)";
 let ids,sessionRef;
 await assert.rejects(withMaintenanceSession(database,'hardware_pos_ci',async session=>{
  sessionRef=session;
  const pending=runWindowsMaintenanceWorker(session,supervisor,process.execPath,['-e',source,marker],options);
  pending.catch(()=>{});
  try{
   for(let i=0;i<200;i++){
    try{ids=JSON.parse(await readFile(marker,'utf8'));break;}catch(e){if(e.code!=='ENOENT')throw e;}
    await delay(50);
   }
   assert.equal(ids?.length,2,'adapter worker readiness not observed');
   if(mode==='error')database.emit('error',Error('fixture connection lost'));
   else if(mode==='end')database.emit('end');
   else{
    database.pid++;
    await assert.rejects(session.assertActive(),/identity changed/);
   }
   await pending;
  }finally{
   if(!session.signal.aborted)database.emit('end');
   await pending.catch(()=>{});
  }
 }),/Maintenance interrupted/);
 assert.equal(database.closed,true);
 assert.equal(sessionRef.signal.aborted,true);
 assert.equal(getEventListeners(sessionRef.signal,'abort').length,0);
 for(const pid of ids){
  assert.ok(Number.isSafeInteger(pid)&&pid>1);
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 }
}
console.log('Windows maintenance session adapter interruption checks passed.');

// Exercise the real PowerShell worker, native supervisor and independent result
// verifier together. The backup producer is a disposable fixture, not Docker.
import {mkdir,copyFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runProtectedWindowsBackup} from './windows-protected-backup-stage.mjs';
const stageRoot=join(dir,'stage-runtime');
const stageScripts=join(stageRoot,'scripts');
const stageDestination=join(dir,'stage-recovery');
await mkdir(stageScripts,{recursive:true});
await mkdir(stageDestination);
await copyFile(fileURLToPath(new URL('./windows-maintenance-backup-worker.ps1',import.meta.url)),join(stageScripts,'windows-maintenance-backup-worker.ps1'));
const producer=join(stageScripts,'backup-local-postgres.ps1');
await writeFile(producer,[
 'param([string]$Destination,[switch]$OutputArchive,[switch]$PreserveExistingArchives,[string]$Database,[string]$Container,[string]$DbUser)',
 '$ErrorActionPreference="Stop"',
 'if (-not $PreserveExistingArchives) { throw "Protected retention required" }',
 '$archive=Join-Path $Destination "ars-hardware_pos-ci-fixture.dump"',
 '[IO.File]::WriteAllBytes($archive,(New-Object byte[] 4096))',
 'if ($OutputArchive) { Write-Output ("ARS_ARCHIVE="+$archive) }'
].join('\r\n'));
const oldArchive=join(stageDestination,'ars-hardware_pos-old-fixture.dump');
const oldChecksum=oldArchive+'.sha256';
await writeFile(oldArchive,'retained recovery archive');
await writeFile(oldChecksum,'retained checksum evidence');
const stageDb=new FixtureDatabase();
const stageResult=await withMaintenanceSession(stageDb,'hardware_pos_ci',session=>
 runProtectedWindowsBackup(session,{root:stageRoot,destination:stageDestination,supervisor,timeoutMs:15000})
);
assert.equal(stageResult.archive,join(stageDestination,'ars-hardware_pos-ci-fixture.dump'));
assert.equal(stageResult.sha256,createHash('sha256').update(Buffer.alloc(4096)).digest('hex'));
assert.match(stageResult.resultDigest,/^[a-f0-9]{64}$/);
for(const field of ['applicationRemovalAllowed','databaseDeletionAllowed','activationAllowed','continuousExclusionVerified'])assert.equal(stageResult[field],false);
assert.equal(stageDb.closed,true);
assert.equal(await readFile(oldArchive,'utf8'),'retained recovery archive');
assert.equal(await readFile(oldChecksum,'utf8'),'retained checksum evidence');
const resultFiles=async()=>(await readdir(stageDestination)).filter(name=>name.startsWith('maintenance-result-'));
assert.deepEqual(await resultFiles(),[stageResult.resultName]);
const retained=await readFile(join(stageDestination,stageResult.resultName));
// A failed producer must not publish a second result or remove existing evidence.
await writeFile(producer,'param([string]$Destination,[switch]$OutputArchive,[switch]$PreserveExistingArchives,[string]$Database,[string]$Container,[string]$DbUser)\r\nthrow "Fixture backup failure"');
await assert.rejects(withMaintenanceSession(new FixtureDatabase(),'hardware_pos_ci',session=>
 runProtectedWindowsBackup(session,{root:stageRoot,destination:stageDestination,supervisor,timeoutMs:15000})
),/Native maintenance worker did not complete/);
assert.deepEqual(await resultFiles(),[stageResult.resultName]);
assert.deepEqual(await readFile(join(stageDestination,stageResult.resultName)),retained);
console.log('Protected Windows backup stage fixture checks passed.');


// Use the compiled executable and actual Windows user token in a disposable
// installed-runtime layout. No PostgreSQL or Docker data is touched.
import {realpath} from 'node:fs/promises';
import {getWindowsProcessSid} from './windows-maintenance-current-identity.mjs';
import {runVerifiedInstalledWindowsBackup} from './windows-verified-installed-backup.mjs';
const installedRoot=await realpath(stageRoot);
const installedRuntime=join(installedRoot,'installer-runtime');
await mkdir(installedRuntime);
const nativeRelative='installer-runtime/maintenance-supervisor.exe';
const installedExe=join(installedRoot,nativeRelative);
await copyFile(supervisor,installedExe);
const digest=b=>createHash('sha256').update(b).digest('hex');
const nativeDigest=digest(await readFile(installedExe));
const manifestRaw=JSON.stringify({[nativeRelative]:{sha256:nativeDigest,mode:420}});
await writeFile(join(installedRoot,'PILOT-FILES.json'),manifestRaw);
const previousLocal=process.env.LOCALAPPDATA;
try{
 process.env.LOCALAPPDATA=join(await realpath(dir),'verified-local');
 const state=join(process.env.LOCALAPPDATA,'RS Nextward','ARS Distributor');
 await mkdir(state,{recursive:true});
 const sid=await getWindowsProcessSid();
 const identity={schema:1,kind:'windows-installation-identity-observation',installation:installedRoot,desktopSid:sid,packageManifestDigest:digest(manifestRaw),applicationTreeDigest:'a'.repeat(64),entryCount:10,runtimeExcluded:true,installationOwnershipCertified:false,applicationRemovalAllowed:false,serviceRemovalAllowed:false,databaseDeletionAllowed:false};
 const identityPath=join(state,'installation-identity.json');
 const identityRaw=JSON.stringify(identity);
 await writeFile(identityPath,identityRaw);
 const destination=join(await realpath(dir),'verified-recovery');
 await mkdir(destination);
 await writeFile(producer,[
  'param([string]$Destination,[switch]$OutputArchive,[switch]$PreserveExistingArchives,[string]$Database,[string]$Container,[string]$DbUser)',
  '$ErrorActionPreference="Stop"',
 'if (-not $PreserveExistingArchives) { throw "Protected retention required" }',
  '$archive=Join-Path $Destination "ars-hardware_pos-verified-fixture.dump"',
  '[IO.File]::WriteAllBytes($archive,(New-Object byte[] 4096))',
  'if ($OutputArchive) { Write-Output ("ARS_ARCHIVE="+$archive) }'
 ].join('\r\n'));
 const invoke=()=>withMaintenanceSession(new FixtureDatabase(),'hardware_pos_ci',session=>
  runVerifiedInstalledWindowsBackup(session,{root:installedRoot,destination,timeoutMs:15000})
 );
 const result=await invoke();
 assert.equal(result.installationIdentityDigest,digest(identityRaw));
 assert.equal(result.packageManifestDigest,digest(manifestRaw));
 assert.equal(result.supervisorSha256,nativeDigest);
 assert.equal(result.sha256,digest(Buffer.alloc(4096)));
 for(const field of ['signatureVerified','applicationTreeReverified','applicationRemovalAllowed','databaseDeletionAllowed','activationAllowed','continuousExclusionVerified'])assert.equal(result[field],false);
 const files=await readdir(destination);
 const resultRaw=await readFile(join(destination,result.resultName));
 await writeFile(identityPath,JSON.stringify({...identity,desktopSid:sid==='S-1-5-18'?'S-1-5-19':'S-1-5-18'}));
 await assert.rejects(invoke(),/identity does not match/);
 await writeFile(identityPath,identityRaw);
 const modified=await readFile(installedExe);
 modified[modified.length-1]^=1;
 await writeFile(installedExe,modified);
 await assert.rejects(invoke(),/integrity mismatch/);
 assert.deepEqual(await readdir(destination),files);
 assert.deepEqual(await readFile(join(destination,result.resultName)),resultRaw);
}finally{
 if(previousLocal===undefined)delete process.env.LOCALAPPDATA;
 else process.env.LOCALAPPDATA=previousLocal;
}
console.log('Verified installed backup coordinator fixture checks passed.');
