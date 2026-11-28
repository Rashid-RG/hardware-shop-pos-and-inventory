import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/show-windows-launcher-preview.ps1',import.meta.url),'utf8');
const prep=readFileSync(new URL('../scripts/prepare-windows-stable-launcher.ps1',import.meta.url),'utf8');
test('graphical launcher is preview only and included in retained package',()=>{
 assert.match(s,/Windows\.Forms/);
 assert.match(s,/preview-windows-stable-launcher\.ps1/);
 assert.match(s,/databaseBindingMatched/);
 assert.match(s,/Startup is still disabled/);
 assert.match(prep,/show-windows-launcher-preview\.ps1/);
 assert.doesNotMatch(s,/Start-Process|Register-ScheduledTask|Set-Content|CreateShortcut|docker compose/);
 assert.doesNotMatch(s,/\$_\.Exception\.Message/);
});
