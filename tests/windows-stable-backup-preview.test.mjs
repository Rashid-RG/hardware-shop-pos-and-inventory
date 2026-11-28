import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../scripts/'+name,import.meta.url),'utf8');
test('permanent backup preview is packaged and checks release, database and retained locks without executing backups',()=>{
 const s=read('preview-windows-stable-backup.ps1');
 for(const token of ['launcher-prepared','Assert-ArsPreparedFingerprint','preview-windows-stable-launcher.ps1','Get-ArsWindowsRuntimeRoot $preview.release','.ars-drive-backup.lock','.ars-local-backup.lock','.ars-drive-recovery.lock','databaseBindingMatched=$true','schedulingAllowed=$false;uploadAllowed=$false;backupStarted=$false']) assert.ok(s.includes(token),token);
 assert.doesNotMatch(s,/Register-ScheduledTask|Start-ScheduledTask|Start-Process|Remove-Item/);
 assert.ok(read('prepare-windows-stable-launcher.ps1').includes("'preview-windows-stable-backup.ps1'"));
});
