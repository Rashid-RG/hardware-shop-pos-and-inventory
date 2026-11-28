import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL('../scripts/'+n,import.meta.url),'utf8');
test('schedule window exposes read-only status through packaged launcher',()=>{
 const s=read('inspect-windows-backup-schedule.ps1');
 for(const token of ['Assert-ArsPreparedFingerprint','Get-ScheduledTask','disabled-preview','local-metadata-matched','activationAllowed=$false;uploadAllowed=$false']) assert.ok(s.includes(token),token);
 assert.doesNotMatch(s,/Register-ScheduledTask|Enable-ScheduledTask|Start-ScheduledTask|Remove-Item/);
 assert.ok(read('show-windows-backup-schedule.ps1').includes('inspect-windows-backup-schedule.ps1'));
 assert.ok(read('show-windows-launcher-preview.ps1').includes('show-windows-backup-schedule.ps1'));
 assert.ok(read('prepare-windows-stable-launcher.ps1').includes("'inspect-windows-backup-schedule.ps1','show-windows-backup-schedule.ps1'"));
});
