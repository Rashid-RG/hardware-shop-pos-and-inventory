import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectDriveBackupHealth } from './drive-backup-health.mjs';
import { verifyBackup } from './verify-backup.mjs';
import { windowsBootEvidence, compareWindowsBoot, corroborateWindowsBoot } from './drive-backup-windows-boot.mjs';

async function record(path) {
  try {
    const item=await lstat(path);
    if (!item.isFile() || item.size>65536) return null;
    return JSON.parse(await readFile(path,'utf8'));
  } catch { return null; }
}

// Diagnostic only. Neither PID absence nor a valid archive authorizes lock removal.
export async function inspectInterruptedDriveBackup(directory) {
  const health=await inspectDriveBackupHealth(directory);
  const status=await record(join(directory,'drive-status.json'));
  const lock=await record(join(directory,'.ars-drive-backup.lock'));
  const lockRecordValid=lock?.schema===1 && Number.isSafeInteger(lock.pid) && lock.pid>0 &&
    typeof lock.startedAt==='string' && Number.isFinite(Date.parse(lock.startedAt));
  let historyMatches=false;
  if (typeof status?.attemptId==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(status.attemptId)) {
    try {
      const historyDir=join(directory,'drive-history');
      if ((await lstat(historyDir)).isDirectory()) {
        const history=await record(join(historyDir,status.attemptId+'.json'));
        historyMatches=!!history && history.attemptId===status.attemptId && history.phase===status.phase &&
          history.attemptedAt===status.attemptedAt && history.archive===status.archive &&
          history.verifiedAt===status.verifiedAt;
      }
    } catch { /* Missing or inaccessible history is not matching evidence. */ }
  }
  let archiveState='not-recorded';
  if (status?.archive!==undefined) {
    archiveState='invalid-or-unverified';
    if (typeof status.archive==='string' && /^ars-[a-z0-9_-]+-(with-uploads|database-only)\.dump$/i.test(status.archive)) {
      try {
        const archive=join(directory,status.archive);
        const stem=archive.slice(0,-5);
        const files=[archive,archive+'.sha256'];
        if (stem.includes('-v2-')) files.push(stem+'.manifest.json',stem+'.manifest.json.sha256');
        if (status.archive.endsWith('-with-uploads.dump')) files.push(stem+'-uploads.zip',stem+'-uploads.zip.sha256');
        for (const file of files) {
          if (!(await lstat(file)).isFile()) throw new Error('Invalid archive companion');
        }
        await verifyBackup(archive);
        archiveState='locally-verified';
      } catch { /* Preserve files and report unverified evidence. */ }
    }
  }
  const currentWindowsBoot=await windowsBootEvidence();
  return {schema:1,health:health.health,lockPresent:health.lockPresent,lockRecordValid:!!lockRecordValid,
    historyMatches,archiveState,lastVerifiedAt:health.lastVerifiedAt,
    windowsBootObservation:compareWindowsBoot(lock?.windowsBoot,currentWindowsBoot,lock?.startedAt),
    windowsBootCorroborated:corroborateWindowsBoot(lock?.windowsBoot,currentWindowsBoot,lock?.startedAt),
    lockRemovalAllowed:false,retryAllowed:false,restoreAllowed:false,uploadAllowed:false,
    requiresOperatorReview:true};
}
