import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/prepare-windows-startup-migration.ps1',import.meta.url),'utf8');
test('startup migration preparation preserves original bytes and blocks conflicts without activation',()=>{
 for(const fragment of ['PREPARE STARTUP MIGRATION','legacy-shortcut.backup','Get-LegacyDigest','registryMatchingObservations','matchingBootOrLogonTasks','userSid','[IO.Directory]::Move($pending,$target)','automaticStartupAllowed=$false;existingStartupChanged=$false;recoveryExecuted=$false']) assert.ok(s.includes(fragment),fragment);
 assert.doesNotMatch(s,/Remove-Item|Register-ScheduledTask|CreateShortcut|Start-Process|Set-ItemProperty/);
});
