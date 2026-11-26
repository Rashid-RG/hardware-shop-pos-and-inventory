import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/install-windows-recovery-shortcut.ps1',import.meta.url),'utf8');
test('Windows recovery shortcut is separate and non-overwriting',()=>{
 assert.match(source,/ARS Distributor - Recovery Center\.lnk/);
 assert.match(source,/show-windows-recovery-center\.ps1/);
 assert.match(source,/\[IO\.File\]::Move\(\$temp,\$path\)/);
 assert.match(source,/Get-FileHash/);
 assert.match(source,/ARS_RUNTIME_ROOT/);
 assert.doesNotMatch(source,/ExecutionPolicy Bypass|Register-ScheduledTask|start-local\.ps1/);
});
