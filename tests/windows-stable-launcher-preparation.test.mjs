import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/prepare-windows-stable-launcher.ps1',import.meta.url),'utf8');
test('launcher preparation uses fingerprinted source, independent bundle and new destination only',()=>{
 assert.match(s,/Assert-ArsPreparedFingerprint \$source/);
 assert.match(s,/PREPARE LAUNCHER/);
 assert.match(s,/probe-postgres-identity\.cjs/);
 const helper=readFileSync(new URL('../scripts/windows-identity-probe-bundle.ps1',import.meta.url),'utf8');
 assert.match(s,/New-ArsIdentityProbeBundle/);
 assert.match(helper,/--bundle/);
 assert.match(helper,/--check \$Destination/);
 assert.match(s,/Assert-ArsPreparedFingerprint \$pending/);
 assert.match(s,/\[IO.Directory\]::Move\(\$pending,\$target\)/);
 assert.match(s,/shortcutInstalled=\$false;startupAllowed=\$false;schedulingAllowed=\$false/);
 assert.doesNotMatch(s,/CreateShortcut|Register-ScheduledTask|Start-Process|docker compose|npm\.cmd|Remove-Item/);
});

test('Windows bundle builder and executable test select exactly one Node executable',()=>{
 for(const path of ['../scripts/windows-identity-probe-bundle.ps1','../scripts/test-windows-identity-probe-bundle.ps1']){
  const content=readFileSync(new URL(path,import.meta.url),'utf8');
  assert.match(content,/Get-Command node\.exe -CommandType Application -ErrorAction Stop \| Select-Object -First 1/);
 }
});
