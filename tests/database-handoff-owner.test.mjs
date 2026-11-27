import test from 'node:test';
import assert from 'node:assert/strict';
import {captureGateOwner,assertGateOwner,assertMaintenanceOwner} from '../scripts/database-handoff-gate.mjs';
test('coordinator proof binds backend identity and actual exclusive lock',async()=>{
 const calls=[];
 const owner={pid:123,started:'2026-01-01 00:00:00.123456+00'};
 const client={query:async(sql,args)=>{calls.push({sql,args});return {rows:[args?{owned:true}:owner]};}};
 assert.deepEqual(await captureGateOwner(client),owner);
 assert.deepEqual(calls[1].args,[1642958133,2,owner.pid,owner.started]);
 for(const token of ["objsubid=2","ExclusiveLock","l.granted","current_database()","backend_start"])assert.ok(calls[1].sql.includes(token));
 await assert.rejects(assertGateOwner({query:async()=>({rows:[{owned:false}]})},owner),/ownership not verified/);
 await assert.rejects(assertGateOwner(client,{pid:0,started:owner.started}),/Invalid coordinator/);
});

test('maintenance ownership requires all three locks and the original session and database',async()=>{
 const row={pid:123,started:'2026-01-01 00:00:00.123456+00',database:'fixture',database_oid:'12345',locks:3};
 const client={query:async(sql,args)=>{
  assert.deepEqual(args,[1642958133]);
  for(const token of ['pg_backend_pid()','backend_start','current_database()','objid IN (1,2,3)','ExclusiveLock','granted','objsubid=2'])assert.ok(sql.includes(token));
  return {rows:[row]};
 }};
 const owner=await assertMaintenanceOwner(client);
 assert.deepEqual(owner,{pid:123,started:row.started,database:'fixture',databaseOid:'12345'});
 assert.ok(Object.isFrozen(owner));
 await assertMaintenanceOwner(client,owner);
 for(const [key,value] of [['pid',124],['started','different'],['database','other'],['database_oid','12346']]){
  await assert.rejects(assertMaintenanceOwner({query:async()=>({rows:[{...row,[key]:value}]})},owner),/identity changed/);
 }
 for(const locks of [0,1,2,4,null,'3']){
  await assert.rejects(assertMaintenanceOwner({query:async()=>({rows:[{...row,locks}]})},owner),/ownership not verified/);
 }
 for(const rows of [[],[row,row],[{...row,pid:0}],[{...row,database_oid:'invalid'}]]){
  await assert.rejects(assertMaintenanceOwner({query:async()=>({rows})},owner),/ownership not verified/);
 }
 await assert.rejects(assertMaintenanceOwner({query:async()=>{throw Error('connection lost');}},owner),/connection lost/);
});

import {EventEmitter} from 'node:events';
import {withMaintenanceSession} from '../scripts/database-maintenance-session.mjs';
class FixtureClient extends EventEmitter {
 constructor(){super();this.calls=[];this.database='hardware_pos_ci';this.denied=0;this.locks=3;this.pid=123;this.closed=0;}
 async connect(){this.calls.push('connect');}
 async end(){this.closed++;this.calls.push('end');this.emit('end');}
 async query(sql,args){
  if(sql==='SELECT current_database() AS name')return {rows:[{name:this.database}]};
  if(sql.includes('pg_try_advisory_lock')){
   this.calls.push(args[1]);return {rows:[{acquired:args[1]!==this.denied}]};
  }
  this.calls.push('verify');
  return {rows:[{pid:this.pid,started:'2026-01-01 00:00:00.123456+00',database:this.database,database_oid:'12345',locks:this.locks}]};
 }
}
test('dedicated maintenance session retains lock order and invalidates capability on cleanup',async()=>{
 const client=new FixtureClient();let capability;
 const value=await withMaintenanceSession(client,'hardware_pos_ci',async session=>{
  capability=session;
  assert.equal(session.signal.aborted,false);
  assert.equal(client.closed,0);
  await session.assertActive();
  return 'fixture complete';
 });
 assert.equal(value,'fixture complete');
 assert.deepEqual(client.calls.slice(0,4),['connect',2,1,3]);
 assert.equal(client.closed,1);
 assert.equal(capability.signal.aborted,true);
 await assert.rejects(capability.assertActive(),/unavailable/);
 assert.equal(client.listenerCount('error'),0);
 assert.equal(client.listenerCount('end'),0);
});
test('failed lock acquisition and unexpected database never start maintenance work',async()=>{
 for(const denied of [1,2,3]){
  const client=new FixtureClient();client.denied=denied;
  await assert.rejects(withMaintenanceSession(client,'hardware_pos_ci',async()=>assert.fail('work started')));
  assert.equal(client.closed,1);
 }
 const client=new FixtureClient();client.database='other';
 await assert.rejects(withMaintenanceSession(client,'hardware_pos_ci',async()=>assert.fail('work started')),/Unexpected maintenance database/);
 assert.deepEqual(client.calls,['connect','end']);
 const pooled=new FixtureClient();pooled.release=()=>{};
 await assert.rejects(withMaintenanceSession(pooled,'hardware_pos_ci',async()=>{}),/Dedicated managed/);
 assert.deepEqual(pooled.calls,[]);
});
test('connection loss, owner changes and stage failures prevent successful completion',async()=>{
 for(const mode of ['error','end','owner','lock','stage']){
  const client=new FixtureClient();let capability;
  await assert.rejects(withMaintenanceSession(client,'hardware_pos_ci',async session=>{
   capability=session;
   if(mode==='error')client.emit('error',Error('fixture loss'));
   if(mode==='end')client.emit('end');
   if(mode==='owner')client.pid++;
   if(mode==='lock')client.locks=2;
   if(mode==='stage')throw Error('fixture stage failure');
   if(['error','end'].includes(mode))assert.equal(session.signal.aborted,true);
   return 'must not complete';
  }));
  assert.equal(client.closed,1);
  assert.equal(capability.signal.aborted,true);
 }
});
