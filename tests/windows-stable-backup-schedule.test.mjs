import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const s=readFileSync(new URL('../scripts/plan-windows-stable-backup-schedule.ps1',import.meta.url),'utf8');
test('stable encrypted backup schedule is a read-only plan with explicit runtime and task conflict inventory',()=>{
 for(const fragment of ['ARS_RUNTIME_ROOT','Get-ArsWindowsRuntimeRoot $package','Assert-ArsPreparedFingerprint $package','Get-ScheduledTask -ErrorAction Stop','enabledMatchingTasks','IgnoreNew','TimeZoneInfo','schedulingAllowed=$false;uploadAllowed=$false;existingTasksChanged=$false']) assert.ok(s.includes(fragment),fragment);
 assert.doesNotMatch(s,/Register-ScheduledTask|Start-ScheduledTask|Unregister-ScheduledTask|Disable-ScheduledTask|Start-Process|Set-Content/);
});
