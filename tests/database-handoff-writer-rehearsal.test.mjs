import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireRehearsalWriter} from '../scripts/database-handoff-writer-rehearsal.mjs';
const owner={pid:123,started:'2026-01-01T00:00:00Z'};
const keys={lockClass:1642958133,gateId:101,writerId:100};
test('rehearsal refuses production database and lock keys',async()=>{
 await assert.rejects(acquireRehearsalWriter({query:async()=>({rows:[{name:'hardware_pos'}]})},owner,keys),/Disposable CI database/);
 await assert.rejects(acquireRehearsalWriter({query:async()=>({rows:[{name:'hardware_pos_ci'}]})},owner,{...keys,writerId:1}),/Disposable lock keys/);
});
test('lost coordinator after lease acquisition destroys dedicated candidate session',async()=>{
 let n=0,ended=false;
 const client={query:async()=>({rows:[[{name:'hardware_pos_ci'},{owned:true},{acquired:true},{owned:false}][n++]]}),end:async()=>{ended=true;}};
 await assert.rejects(acquireRehearsalWriter(client,owner,keys),/ownership not verified/);
 assert.equal(ended,true);
});
