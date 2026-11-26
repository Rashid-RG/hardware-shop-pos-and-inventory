import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/mint/prepare-runtime-activation.py',import.meta.url),'utf8');
test('Mint proposal is explicitly non-authorizing and preserves evidence',()=>{
 assert.match(s,/PREPARE MINT ACTIVATION/);
 assert.match(s,/os\.O_EXCL/);
 assert.match(s,/snapshot\(folder\)!=observed/);
 assert.match(s,/backupHoldBindingVerified":True/);
 assert.match(s,/continuousExclusionVerified":False/);
 for(const flag of ['activationAllowed','runtimeActivated','startupAllowed','rollbackAllowed'])assert.ok(s.includes('"'+flag+'":False'));
 assert.doesNotMatch(s,/switch_pointer\(|\.unlink\(|\.rename\(|systemctl.*start/);
});

test('Mint activation requires protected backup receipt and exact hold digest',()=>{
 assert.match(s,/maintenance-backup-receipt\.json/);
 assert.match(s,/receipt\.get\("holdDigest"\)==sha\(raw\["hold"\]\)/);
 assert.match(s,/receipt\.get\("recoveryDigest"\)==sha\(raw\["recovery"\]\)/);
});
