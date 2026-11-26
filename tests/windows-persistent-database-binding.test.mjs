import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/windows-database-binding.ps1',import.meta.url),'utf8');
const preview=readFileSync(new URL('../scripts/preview-windows-docker-binding.ps1',import.meta.url),'utf8');
test('binding requires explicit registration, rechecks identity and never overwrites',()=>{
 assert.match(s,/REGISTER DATABASE/);
 assert.match(s,/FileMode\]::CreateNew/);
 assert.match(s,/Assert-SameIdentity \$first \$current/);
 assert.match(s,/Assert-SameIdentity \$saved \(Get-VerifiedIdentity\)/);
 assert.match(s,/activationAllowed=\$false/);
 assert.doesNotMatch(s,/Remove-Item|Start-Process|docker compose/);
});
test('identity script retains complete regex and one output record',()=>{
 assert.ok(preview.includes("^[0-9]{1,20}:[0-9]{1,10}$')"));
 assert.equal((preview.match(/finally \{/g)||[]).length,1);
 assert.match(preview,/databaseIdentityVerified=\$true/);
});
