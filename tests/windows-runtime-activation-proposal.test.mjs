import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/prepare-windows-runtime-activation.ps1',import.meta.url),'utf8');
test('activation preparation preserves maintenance and requires explicit confirmation',()=>{
 assert.match(s,/PREPARE RUNTIME ACTIVATION/);
 assert.match(s,/\[IO.FileMode\]::CreateNew/);
 assert.match(s,/Get-Snapshot/);
 assert.match(s,/Assert-MatchingProposal/);
 for(const flag of ['runtimeActivated','activationAllowed','startupAllowed','rollbackAllowed'])assert.ok(s.includes(flag+'=$false'));
 assert.doesNotMatch(s,/Remove-Item|Start-Process|Move-Item|Set-ItemProperty/);
});
