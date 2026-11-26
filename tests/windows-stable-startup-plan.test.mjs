import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/plan-windows-stable-startup.ps1',import.meta.url),'utf8');
test('stable startup inventory recognizes legacy entries without modifying startup',()=>{
 assert.match(s,/GetFolderPath\('Startup'\)/);
 assert.match(s,/GetFolderPath\('CommonStartup'\)/);
 assert.match(s,/matches-current-installation/);
 assert.match(s,/unrecognized/);
 assert.match(s,/Assert-ArsPreparedFingerprint \$package/);
 assert.match(s,/automaticStartupAllowed=\$false;existingStartupChanged=\$false/);
 assert.doesNotMatch(s,/\.Save\(|Register-ScheduledTask|Remove-Item|Start-Process|Set-Content|New-Item/);
});

test('startup inventory reads registry views and scheduled task triggers without mutation',()=>{
 assert.match(s,/RegistryView\]::Registry32/);
 assert.match(s,/RegistryView\]::Registry64/);
 assert.match(s,/OpenSubKey\(\$sub,\$false\)/);
 assert.match(s,/Get-ScheduledTask -ErrorAction Stop/);
 assert.match(s,/MSFT_TaskBootTrigger/);
 assert.match(s,/MSFT_TaskLogonTrigger/);
 assert.match(s,/registryMatchingObservations=\$registryMatches/);
 assert.doesNotMatch(s,/SetValue\(|DeleteValue\(|Set-ItemProperty|Unregister-ScheduledTask|Disable-ScheduledTask/);
});
