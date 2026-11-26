import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/mint/prepare-runtime-activation.py',import.meta.url),'utf8');
test('Mint proposal is explicitly non-authorizing and preserves evidence',()=>{
 assert.match(s,/PREPARE MINT ACTIVATION/);
 assert.match(s,/os\.O_EXCL/);
 assert.match(s,/snapshot\(folder\)!=observed/);
 assert.match(s,/backupHoldBindingVerified":False/);
 assert.match(s,/continuousExclusionVerified":False/);
 for(const flag of ['activationAllowed','runtimeActivated','startupAllowed','rollbackAllowed'])assert.ok(s.includes('"'+flag+'":False'));
 assert.doesNotMatch(s,/switch_pointer\(|\.unlink\(|\.rename\(|systemctl.*start/);
});
