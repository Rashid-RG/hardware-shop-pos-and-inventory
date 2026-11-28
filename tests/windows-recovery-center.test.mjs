import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/show-windows-recovery-center.ps1',import.meta.url),'utf8');
test('offline recovery center uses verified binding and read-only diagnostics',()=>{
 assert.match(source,/windows-database-binding\.ps1/);
 assert.match(source,/bindingMatched -ne \$true/);
 assert.match(source,/writer-loss-offline-diagnostics\.mjs/);
 assert.match(source,/startupAllowed -ne \$false/);
 assert.doesNotMatch(source,/-Register|Remove-Item|Start-Process|runIncidentRestore|docker compose up/);
});
