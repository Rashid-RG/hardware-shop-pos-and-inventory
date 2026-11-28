// Disposable hosted CI only. Never connect to an operational installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {acquireHandoffGate, acquireMaintenanceTransactionFence, captureGateOwner, assertGateOwner, HANDOFF_CLASS, HANDOFF_ID, WRITER_ID, TRANSACTION_FENCE_ID} from '../scripts/database-handoff-gate.mjs';

const windows=process.platform==='win32';
const expected=windows?'postgresql://postgres@127.0.0.1:55432/hardware_pos_ci':'postgresql://postgres:ci-test-only-password@127.0.0.1:5432/hardware_pos_ci';
if(!windows&&process.platform!=='linux')throw Error('Unsupported CI platform.');
if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.DATABASE_URL!==expected)throw Error('Disposable hosted repair CI database required.');
const connect=async()=>{
 const c=new pg.Client({connectionString:expected,connectionTimeoutMillis:5000,query_timeout:10000});
 c.on('error',()=>{}); // Terminated coordinator is expected in the interruption case.
 await c.connect();
 return c;
};
const keys=[HANDOFF_ID,WRITER_ID,TRANSACTION_FENCE_ID];
const tryLock=async(c,id,shared=false)=>(await c.query('SELECT pg_try_advisory_lock'+(shared?'_shared':'')+'($1::integer,$2::integer) AS acquired',[HANDOFF_CLASS,id])).rows[0].acquired;

test('repair coordinator excludes cooperating writers and ordinary table writes until session loss', {timeout:90000}, async()=>{
 const clients=[];
 const open=async()=>{const c=await connect();clients.push(c);return c;};
 const table='ars_repair_ci_'+randomUUID().replaceAll('-','');
 const ident='"'+table+'"';
 let fixtureCreated=false;
 const fixtureHome=realpathSync(mkdtempSync(join(tmpdir(),'ars-repair-ci-')));
 const state=windows?join(fixtureHome,'RS Nextward','ARS Distributor'):join(fixtureHome,'.local','share','ars-hardware');
 const control=windows?join(state,'desktop-control'):state;
 const repairName='repair-preparation-'+randomUUID().replaceAll('-','');
 const repair=join(state,repairName);
 const marker=join(control,'repair-interrupted.json');
 const receipt=join(repair,'rollback-preparation.json');
 const root=fileURLToPath(new URL('../',import.meta.url));
 // Use the production Mint marker writer and reviewer inside a child with a
 // private HOME, never the installed user's state. No services are started.
 const python=(code,args=[])=>spawnSync('python3',['-c',code,...args],{
  cwd:root,env:{PATH:process.env.PATH,HOME:fixtureHome,PYTHONPATH:join(root,'scripts','mint')},
  encoding:'utf8',timeout:15000
 });
 const ps=(action,digest='')=>spawnSync(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'scripts','test-windows-repair-interruption-fixture.ps1'),'-FixtureHome',fixtureHome,'-RepairName',repairName,'-Action',action,'-Digest',digest||'unused'],{
  cwd:root,env:{...process.env,LOCALAPPDATA:fixtureHome},encoding:'utf8',timeout:15000
 });
 const assertStartup=(allowed)=>{
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',
   "import {assertOrdinaryStartupAllowed} from './backend/maintenanceStartupGuard.ts'; try {assertOrdinaryStartupAllowed(); process.exit(0)} catch {process.exit(23)}"],{
   cwd:root,env:windows?{...process.env,LOCALAPPDATA:fixtureHome}:{PATH:process.env.PATH,HOME:fixtureHome},encoding:'utf8',timeout:15000
  });
  assert.equal(result.status,allowed?0:23,result.stderr);
 };
 try{
  mkdirSync(repair,{recursive:true,mode:0o700});
  mkdirSync(control,{recursive:true,mode:0o700});
  const raw=JSON.stringify({schema:1,kind:windows?'windows-repair-rollback-preparation':'mint-repair-rollback-preparation',repairSpecificRollbackTested:true,activationAllowed:false,startupAllowed:false,repairApplied:false,rollbackAllowed:false});
  writeFileSync(receipt,raw,{flag:'wx',mode:0o600});
  const receiptDigest=createHash('sha256').update(raw).digest('hex');
  assertStartup(true);
  const coordinator=await open(), rival=await open(), observer=await open();
  const identities=await Promise.all(clients.map(c=>c.query("SELECT current_database() AS db,pg_backend_pid() AS pid,system_identifier::text AS cluster FROM pg_control_system()")));
  assert.ok(identities.every(r=>r.rows[0].db==='hardware_pos_ci'&&r.rows[0].cluster===identities[0].rows[0].cluster));
  assert.equal(new Set(identities.map(r=>r.rows[0].pid)).size,3);
  await observer.query('CREATE TABLE '+ident+' (id integer PRIMARY KEY, quantity integer NOT NULL)');
  fixtureCreated=true;
  await observer.query('INSERT INTO '+ident+' VALUES (1,8)');
  // An already-admitted transaction must prevent maintenance fence acquisition.
  await rival.query('BEGIN');
  await rival.query('SELECT pg_advisory_xact_lock_shared($1::integer,$2::integer)',[HANDOFF_CLASS,TRANSACTION_FENCE_ID]);
  await acquireHandoffGate(coordinator);
  assert.equal(await tryLock(coordinator,WRITER_ID),true);
  await assert.rejects(acquireMaintenanceTransactionFence(coordinator),/Outstanding fenced transaction/);
  await rival.query('ROLLBACK');
  await acquireMaintenanceTransactionFence(coordinator);
  const owner=await captureGateOwner(coordinator);
  await coordinator.query('BEGIN');
  await coordinator.query('LOCK TABLE '+ident+' IN SHARE MODE NOWAIT');
  const begin=windows?ps('begin',receiptDigest):python("import sys; from pathlib import Path; from repair_interruption import STATE,make_record,retain_marker,inspect; assert STATE==Path(sys.argv[1]); retain_marker(STATE,make_record(sys.argv[2],sys.argv[3])); assert inspect(STATE)['markerRetained'] is True",[state,repairName,receiptDigest]);
  assert.equal(begin.status,0,begin.stderr);
  const markerBytes=readFileSync(marker);
  assertStartup(false);
  await rival.query("SET lock_timeout='250ms'");
  // Simulate three stages of a repair plan without switching files or launching an app.
  for(const phase of ['preparation','file-switch-placeholder','verification']){
   for(const id of keys){
    await assertGateOwner(observer,owner,{lockClass:HANDOFF_CLASS,lockId:id});
    assert.equal(await tryLock(rival,id),false,phase+' exclusive lock');
    assert.equal(await tryLock(rival,id,true),false,phase+' shared lock');
   }
   await assert.rejects(rival.query('UPDATE '+ident+' SET quantity=0 WHERE id=1'),{code:'55P03'});
   await assert.rejects(rival.query('INSERT INTO '+ident+' VALUES (2,1)'),{code:'55P03'});
   await assert.rejects(rival.query('DELETE FROM '+ident+' WHERE id=1'),{code:'55P03'});
   assert.deepEqual((await observer.query('SELECT * FROM '+ident)).rows,[{id:1,quantity:8}]);
  }
  // Force loss of the dedicated coordinator backend, rather than claiming a normal close is a crash.
  const terminated=await observer.query('SELECT pg_terminate_backend($1::integer) AS terminated',[owner.pid]);
  assert.equal(terminated.rows[0].terminated,true);
  let released=false;
  for(let i=0;i<50;i++){
   const r=await observer.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1::integer) AS active',[owner.pid]);
   if(!r.rows[0].active){released=true;break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(released,true,'Coordinator backend did not disappear');
  await assert.rejects(assertGateOwner(observer,owner),/ownership not verified/);
  assertStartup(false);
  assert.deepEqual(readFileSync(marker),markerBytes);
  const review=windows?ps('review'):python("import sys; from pathlib import Path; from repair_interruption import STATE,inspect; assert STATE==Path(sys.argv[1]); result=inspect(STATE); assert result['rollbackReceiptMatched'] is True and result['startupAllowed'] is False and result['recoveryAllowed'] is False",[state]);
  assert.equal(review.status,0,review.stderr);
  // A corrupted marker must also fail closed; no recovery action may clear it.
  writeFileSync(marker,'{');
  assertStartup(false);
  const corrupt=windows?ps('review'):python("from repair_interruption import STATE,inspect; inspect(STATE)");
  assert.notEqual(corrupt.status,0);
  assert.equal(readFileSync(marker,'utf8'),'{');
  // Locks cannot survive connection loss. A durable maintenance marker is independently required.
  for(const id of keys)assert.equal(await tryLock(rival,id),true);
  await rival.query('SELECT pg_advisory_unlock_all()');
  assert.deepEqual((await observer.query('SELECT * FROM '+ident)).rows,[{id:1,quantity:8}]);
  await observer.query('UPDATE '+ident+' SET quantity=7 WHERE id=1');
  assert.equal((await observer.query('SELECT quantity FROM '+ident)).rows[0].quantity,7);
 }finally{
  // Close all lock owners before removing only our random CI fixture.
  for(const c of clients)await c.end().catch(()=>{});
  try{
   if(fixtureCreated){
    const cleanup=await connect();
    try{await cleanup.query('DROP TABLE '+ident);}finally{await cleanup.end();}
   }
  }finally{rmSync(fixtureHome,{recursive:true,force:true});}
 }
});

import {withMaintenanceSession} from '../scripts/database-maintenance-session.mjs';
import {withMaintenanceTableFence} from '../scripts/database-maintenance-table-fence.mjs';

test('real maintenance table fence permits reads but excludes writes across stages', {timeout:60000}, async()=>{
 const ident='"ars_fence_ci_'+randomUUID().replaceAll('-','')+'"';
 const fresh=()=>new pg.Client({connectionString:expected,connectionTimeoutMillis:5000,query_timeout:10000});
 let created=false;
 const setup=await connect();
 try{
  await setup.query('CREATE TABLE '+ident+' (id integer PRIMARY KEY, quantity integer NOT NULL)');
  created=true;
  await setup.query('INSERT INTO '+ident+' VALUES (1,8)');
 }finally{await setup.end();}
 try{
  const owner=fresh();
  await withMaintenanceSession(owner,'hardware_pos_ci',session=>withMaintenanceTableFence(owner,session,async fence=>{
   const rival=await connect();
   try{
    await rival.query("SET lock_timeout='250ms'");
    for(const phase of ['backup-placeholder','restore-placeholder','review-placeholder']){
     await fence.assertActive();
     assert.deepEqual((await rival.query('SELECT * FROM '+ident)).rows,[{id:1,quantity:8}]);
     for(const id of keys)assert.equal(await tryLock(rival,id),false,phase);
     for(const sql of ['UPDATE '+ident+' SET quantity=0 WHERE id=1','INSERT INTO '+ident+' VALUES (2,1)','DELETE FROM '+ident+' WHERE id=1']){
      await assert.rejects(rival.query(sql),{code:'55P03'});
     }
    }
   }finally{await rival.end();}
  }));
  const check=await connect();
  try{
   for(const id of keys)assert.equal(await tryLock(check,id),true);
   await check.query('SELECT pg_advisory_unlock_all()');
   assert.deepEqual((await check.query('SELECT * FROM '+ident)).rows,[{id:1,quantity:8}]);
   await check.query('UPDATE '+ident+' SET quantity=7 WHERE id=1');
   assert.equal((await check.query('SELECT quantity FROM '+ident)).rows[0].quantity,7);
  }finally{await check.end();}
  // A separate connected client at scope entry must prevent work.
  const busy=await connect();
  try{
   const next=fresh();
   await assert.rejects(withMaintenanceSession(next,'hardware_pos_ci',session=>withMaintenanceTableFence(next,session,async()=>assert.fail('Busy database admitted'))),/Other database clients/);
  }finally{await busy.end();}
 }finally{
  if(created){const cleanup=await connect();try{await cleanup.query('DROP TABLE '+ident);}finally{await cleanup.end();}}
 }
});
