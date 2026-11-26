import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/mint/recovery-center.py',import.meta.url),'utf8');
test('Mint graphical recovery center uses saved identity and offline diagnostic command',()=>{
 assert.match(source,/database-binding\.json/);
 assert.match(source,/writer-loss-offline-diagnostics\.mjs/);
 assert.match(source,/startupAllowed.*is not False/);
 assert.match(source,/--no-markup/);
 assert.doesNotMatch(source,/systemctl|docker compose|\.unlink\(|runIncidentRestore/);
});
