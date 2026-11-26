import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Mint switch intent is non-authorizing and blocks ordinary resume',()=>{
 const s=read('scripts/mint/prepare-switch-intent.py');
 assert.match(s,/RETAIN MINT SWITCH INTENT/);
 assert.match(s,/os\.O_EXCL/);
 assert.match(s,/proposal\.snapshot\(folder\)/);
 assert.match(s,/verified_binding\(folder,proposal\)/);
 assert.doesNotMatch(s,/switch_pointer\(|\.unlink\(|\.rename\(|systemctl/);
 for(const p of ['scripts/mint/startup_guard.py','scripts/mint/resume_maintenance.py','backend/maintenanceStartupGuard.ts'])assert.match(read(p),/runtime-switch-intent\.json/);
});
