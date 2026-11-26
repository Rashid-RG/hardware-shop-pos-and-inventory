import test from 'node:test';
import assert from 'node:assert/strict';
import {rehearsePrivateHandoff} from '../scripts/database-handoff-ipc.mjs';
const binding={releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64),purpose:'candidate'};
test('private child IPC completes bound rehearsal without authorizing live startup',async()=>{
 assert.deepEqual(await rehearsePrivateHandoff(binding),{authorizationVerified:true,liveStartupAllowed:false});
});
test('private child IPC rejects wrong binding and replay',async()=>{
 for(const mode of ['wrong-binding','replay'])await assert.rejects(rehearsePrivateHandoff(binding,{mode}),/proof rejected/);
});
test('private child IPC times out when child does not respond',async()=>{
 await assert.rejects(rehearsePrivateHandoff(binding,{mode:'silent',timeoutMs:500}),/timed out/);
});
