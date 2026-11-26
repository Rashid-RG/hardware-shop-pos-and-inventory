import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/register-windows-disabled-backup-task.ps1',import.meta.url),'utf8');
test('stable backup registration is create-only and disabled before registration',()=>{
 for(const token of ['REGISTER DISABLED BACKUP TASK','prepare-windows-backup-schedule.ps1','Settings.Enabled=$false','Settings.AllowDemandStart=$false','trigger.Enabled=$false','RegisterTaskDefinition($name,$definition,2,$sid,$null,3,$null)','preview-windows-stable-backup.ps1','taskEnabled=$false;triggerEnabled=$false','GetTask($name)']) assert.ok(s.includes(token),token);
 assert.ok(s.indexOf('Settings.Enabled=$false')<s.indexOf('$folder.RegisterTaskDefinition'));
 assert.doesNotMatch(s,/Start-ScheduledTask|Enable-ScheduledTask|drive-backup\.mjs|DeleteTask/);
});
