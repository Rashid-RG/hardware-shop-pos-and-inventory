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
 // Only the transient observation marker may be removed, after exact byte verification.
 const finish=s.match(/^def finish_activation_observation\(marker, expected\):\n([\s\S]*?)(?=^def )/m);
 assert.ok(finish);
 assert.match(finish[1],/if read\(marker\)!=expected:\n        raise ValueError\([^\n]+\)\n    marker\.unlink\(\)\n    sync_state\(\)/);
 assert.equal((s.match(/\.unlink\(/g)||[]).length,1);
 assert.match(s,/marker, marker_raw=begin_activation_observation\(\)/);
 assert.match(s,/finish_activation_observation\(marker,marker_raw\)/);
 assert.match(s,/marker=STATE\/"runtime-activation-interrupted\.json"/);
 assert.doesNotMatch(s.replace(finish[0],''),/switch_pointer\(|\.unlink\(|\.rename\(|systemctl.*start/);
});

test('Mint activation requires protected backup receipt and exact hold digest',()=>{
 assert.match(s,/maintenance-backup-receipt\.json/);
 assert.match(s,/receipt\.get\("holdDigest"\)==sha\(raw\["hold"\]\)/);
 assert.match(s,/receipt\.get\("recoveryDigest"\)==sha\(raw\["recovery"\]\)/);
});

test('ordinary preflight rejection occurs before the durable incident marker is created',()=>{
 const body=s.slice(s.indexOf('def prepare(folder,'));
 const marker=body.indexOf('marker, marker_raw=begin_activation_observation()');
 assert.ok(marker>0);
 for(const check of ['if os.path.lexists(STATE/"runtime-activation-interrupted.json"):', 'if not verify and os.path.lexists(target):','observed=snapshot(folder)','if verify and not matches(json.loads(read(target)),observed):']){
  const position=body.indexOf(check);
  assert.ok(position>=0&&position<marker,check);
 }
 assert.ok(body.indexOf('if not verify:',marker)>marker);
 assert.ok(body.indexOf('finish_activation_observation(marker,marker_raw)',marker)>marker);
});
