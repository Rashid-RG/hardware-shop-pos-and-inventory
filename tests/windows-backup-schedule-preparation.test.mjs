import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/prepare-windows-backup-schedule.ps1',import.meta.url),'utf8');
test('persistent schedule proposal binds current readiness and never registers a task',()=>{
 for(const token of ['backup-schedule-prepared.json','PREPARE BACKUP SCHEDULE','preview-windows-stable-backup.ps1','matchingTasks -ne 0','userSid','startWhenAvailable=$true','[IO.FileMode]::CreateNew','[IO.File]::Move($pending,$target)','scheduleMatched=$true','schedulingAllowed=$false;uploadAllowed=$false']) assert.ok(s.includes(token),token);
 assert.doesNotMatch(s,/Register-ScheduledTask|Start-ScheduledTask|Remove-Item|Start-Process/);
});
