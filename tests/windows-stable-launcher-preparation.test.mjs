import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/prepare-windows-stable-launcher.ps1',import.meta.url),'utf8');
test('launcher preparation uses fingerprinted source, independent bundle and new destination only',()=>{
 assert.match(s,/Assert-ArsPreparedFingerprint \$source/);
 assert.match(s,/PREPARE LAUNCHER/);
 assert.match(s,/probe-postgres-identity\.cjs/);
 assert.match(s,/--bundle/);
 assert.match(s,/--check \$bundle/);
 assert.match(s,/Assert-ArsPreparedFingerprint \$pending/);
 assert.match(s,/\[IO.Directory\]::Move\(\$pending,\$target\)/);
 assert.match(s,/shortcutInstalled=\$false;startupAllowed=\$false;schedulingAllowed=\$false/);
 assert.doesNotMatch(s,/CreateShortcut|Register-ScheduledTask|Start-Process|docker compose|npm\.cmd|Remove-Item/);
});
