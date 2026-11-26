import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverWindowsLocalPreviousBootLock } from '../scripts/drive-backup-previous-boot.mjs';
test('Windows local archive lock records corroborating boot evidence and checks recovery guard',()=>{
 const ps=readFileSync(new URL('../scripts/backup-local-postgres.ps1',import.meta.url),'utf8');
 for(const token of ['Get-LocalBackupBootEvidence','Get-WinEvent','MachineGuid','bootId=$null;windowsBoot=(Get-LocalBackupBootEvidence)','Assert-NoBackupRecovery','FileShare]::None']) assert.ok(ps.includes(token),token);
 assert.ok(ps.indexOf('Assert-NoBackupRecovery',ps.indexOf('$localLock.Flush'))>ps.indexOf('$localLock.Flush'));
});
test('unconfirmed local lock recovery does not alter either backup lock',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-local-recovery-'));
 try{
  for(const name of ['.ars-local-backup.lock','.ars-drive-backup.lock']) await writeFile(join(dir,name),'retained');
  await assert.rejects(recoverWindowsLocalPreviousBootLock(dir,'no'),/confirmation/);
  if(process.platform!=='win32') await assert.rejects(recoverWindowsLocalPreviousBootLock(dir,'RECOVER WINDOWS LOCAL PREVIOUS BOOT'),/Windows host/);
  for(const name of ['.ars-local-backup.lock','.ars-drive-backup.lock']) assert.equal(await readFile(join(dir,name),'utf8'),'retained');
 }finally{await rm(dir,{recursive:true,force:true});}
});
