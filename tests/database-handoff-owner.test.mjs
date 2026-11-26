import test from 'node:test';
import assert from 'node:assert/strict';
import {captureGateOwner,assertGateOwner} from '../scripts/database-handoff-gate.mjs';
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
