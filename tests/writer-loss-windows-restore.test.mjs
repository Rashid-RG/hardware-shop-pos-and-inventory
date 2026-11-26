import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedContainerArgs} from '../scripts/writer-loss-windows-restore.mjs';
test('Windows test container has no published ports, live mounts or network',()=>{
 const args=isolatedContainerArgs('ars-incident-test-'+'a'.repeat(32),'b'.repeat(64));
 assert.equal(args[args.indexOf('--network')+1],'none');
 assert.equal(args[args.indexOf('--tmpfs')+1],'/var/lib/postgresql/data:rw,mode=0700');
 for(const arg of ['-v','--volume','-p','--publish','--privileged','--mount'])assert.ok(!args.includes(arg));
 assert.throws(()=>isolatedContainerArgs('hardware-pos-postgres','b'.repeat(64)));
});
