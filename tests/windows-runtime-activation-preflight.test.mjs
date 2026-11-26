import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('combined runtime preflight verifies both database bindings without activating runtime',()=>{
 const s=readFileSync(new URL('../scripts/plan-windows-runtime-activation.ps1',import.meta.url),'utf8');
 for(const token of ['plan-windows-runtime-integration.ps1','plan-windows-update-switch.ps1','windows-database-binding.ps1','originalDatabaseBindingMatched=$true','preparedDatabaseBindingMatched=$true','runtimeActivated=$false;activationAllowed=$false','.ars-drive-recovery.lock','SetEnvironmentVariable(\'ARS_RUNTIME_ROOT\',$previous,\'Process\')'])assert.ok(s.includes(token),token);
 assert.equal((s.match(/Invoke-Plan 'windows-database-binding.ps1'/g)||[]).length,2);
 assert.doesNotMatch(s,/Start-Process|Register-ScheduledTask|Remove-Item|docker compose|Set-Content/);
});
