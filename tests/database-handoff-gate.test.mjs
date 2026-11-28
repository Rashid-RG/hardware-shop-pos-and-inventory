import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireHandoffGate,releaseHandoffGate,HANDOFF_CLASS,HANDOFF_ID,WRITER_ID} from '../scripts/database-handoff-gate.mjs';
test('handoff gate is distinct from writer lease and fails closed',async()=>{
 assert.equal(HANDOFF_CLASS,1642958133);
 assert.notEqual(HANDOFF_ID,WRITER_ID);
 const calls=[];
 const client={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{acquired:true,released:true}]};}};
 await acquireHandoffGate(client);await releaseHandoffGate(client);
 for(const c of calls) assert.deepEqual(c.args,[1642958133,2]);
 const blocked={query:async()=>({rows:[{acquired:false,released:false}]})};
 await assert.rejects(acquireHandoffGate(blocked),/already held/);
 await assert.rejects(releaseHandoffGate(blocked),/not verified/);
});
