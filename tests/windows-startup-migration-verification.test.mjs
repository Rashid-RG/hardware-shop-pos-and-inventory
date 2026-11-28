import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/verify-windows-startup-migration.ps1',import.meta.url),'utf8');
test('startup recovery verification requires original user, matching inventory and original shortcut bytes',()=>{
 for(const fragment of ['migration.json','legacy-shortcut.backup','WindowsIdentity','Get-FileHash','ReparsePoint','plan-windows-stable-startup.ps1','registryMatchingObservations','matchingBootOrLogonTasks','recoveryEvidenceMatched=$true','automaticStartupAllowed=$false;recoveryExecuted=$false']) assert.ok(s.includes(fragment),fragment);
 assert.match(s,/foreach \(\$file in @\(\$backup,\$legacy\)\)/);
 assert.doesNotMatch(s,/Copy-Item|Move-Item|Remove-Item|Set-Content|Start-Process|Register-ScheduledTask|CreateShortcut/);
});
