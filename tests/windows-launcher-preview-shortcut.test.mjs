import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/install-windows-launcher-preview-shortcut.ps1',import.meta.url),'utf8');
test('preview shortcut requires consent, verified package and non-overwriting publication',()=>{
 assert.match(s,/ARS Distributor - Readiness Preview\.lnk/);
 assert.match(s,/Assert-ArsPreparedFingerprint \$package/);
 assert.match(s,/\$answer -ne 'Yes'/);
 assert.match(s,/\[IO.File\]::Move\(\$temp,\$path\)/);
 assert.match(s,/show-windows-launcher-preview\.ps1/);
 assert.doesNotMatch(s,/ARS Distributor POS\.lnk|Register-ScheduledTask|Start-Process|docker compose|ExecutionPolicy Bypass/);
});
