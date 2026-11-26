import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('switch intent is non-authorizing and blocks ordinary startup',()=>{
 const s=read('scripts/prepare-windows-switch-intent.ps1');
 assert.match(s,/RETAIN SWITCH INTENT/);
 assert.match(s,/FileMode\]::CreateNew/);
 assert.match(s,/prepare-windows-runtime-activation\.ps1/);
 assert.match(s,/-RecoveryId \$RecoveryId -Verify/);
 assert.doesNotMatch(s,/Start-Process|Remove-Item|Move-Item|\[IO.File\]::Replace/);
 for(const p of ['scripts/windows-switch-inspection.ps1','backend/maintenanceStartupGuard.ts'])assert.match(read(p),/runtime-switch-intent\.json/);
});

test('Windows cancellation retains exact original intent without resuming POS',()=>{
 const s=read('scripts/prepare-windows-switch-intent.ps1');
 assert.match(s,/CANCEL SWITCH INTENT/);
 assert.match(s,/\[IO.File\]::Move\(\$target,\$archive\)/);
 assert.match(s,/maintenanceRetained=\$true/);
});
