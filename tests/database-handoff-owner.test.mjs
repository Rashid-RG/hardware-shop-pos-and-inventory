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
