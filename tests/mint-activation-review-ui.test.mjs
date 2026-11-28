import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/mint/update-center.py',import.meta.url),'utf8');
test('Mint activation review has dedicated graphical preparation and verification only',()=>{
 const block=s.slice(s.indexOf('def activation_review(project):'),s.indexOf('def status(project):'));
 assert.match(block,/PREPARE MINT ACTIVATION/);
 assert.match(block,/--verify/);
 assert.match(block,/prepare-runtime-activation\.py/);
 assert.match(block,/proposalMatched/);
 assert.match(block,/backupHoldBindingVerified/);
 assert.match(block,/continuousExclusionVerified/);
 assert.match(block,/timeout=900/);
 assert.doesNotMatch(block,/resume_maintenance|switch_pointer|systemctl|\.unlink\(/);
 assert.match(s,/elif action=="Activation Review Center":\s+activation_review\(project\)/);
});
