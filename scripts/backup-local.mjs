// Windows Task Scheduler entry point. Uses the same DATABASE_URL-validated
// PowerShell backup implementation as the manually invoked recovery workspace.
// Do not hardcode a database name or silently back up the wrong ARS database.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const script=join(dirname(fileURLToPath(import.meta.url)),'backup-local-postgres.ps1');
if(process.platform!=='win32') {
  console.error('ARS scheduled backup requires Windows PowerShell and Docker Desktop.');
  process.exit(1);
}
const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],
  {stdio:'inherit',windowsHide:true,timeout:30*60*1000});
if(result.error||result.status!==0) {
  console.error('ARS scheduled backup failed. Review the task history; no verified backup was confirmed.');
  process.exit(1);
}
console.log('ARS scheduled backup completed; verify the archive and restore drill before relying on it.');
