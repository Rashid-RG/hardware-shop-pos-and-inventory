// Disposable hosted CI only. Never connect to an operational installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {acquireHandoffGate, acquireMaintenanceTransactionFence, captureGateOwner, assertGateOwner, HANDOFF_CLASS, HANDOFF_ID, WRITER_ID, TRANSACTION_FENCE_ID} from '../scripts/database-handoff-gate.mjs';

const expected='postgresql://postgres:ci-test-only-password@127.0.0.1:5432/hardware_pos_ci';
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
 try{
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
  // Locks cannot survive connection loss. A durable maintenance marker is independently required.
  for(const id of keys)assert.equal(await tryLock(rival,id),true);
  await rival.query('SELECT pg_advisory_unlock_all()');
  assert.deepEqual((await observer.query('SELECT * FROM '+ident)).rows,[{id:1,quantity:8}]);
  await observer.query('UPDATE '+ident+' SET quantity=7 WHERE id=1');
  assert.equal((await observer.query('SELECT quantity FROM '+ident)).rows[0].quantity,7);
 }finally{
  // Close all lock owners before removing only our random CI fixture.
  for(const c of clients)await c.end().catch(()=>{});
  if(fixtureCreated){
   const cleanup=await connect();
   try{await cleanup.query('DROP TABLE '+ident);}finally{await cleanup.end();}
  }
 }
});
