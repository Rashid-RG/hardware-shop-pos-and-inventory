import { mkdir, open, unlink, realpath, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { currentLinuxBootId } from './drive-backup-previous-boot.mjs';
import { windowsBootEvidence } from './drive-backup-windows-boot.mjs';

// Fail closed on existing locks, including after a crash. Never guess that a PID is stale.
export async function withDriveBackupLock(directory, work) {
  await mkdir(directory, { recursive: true });
  const canonical = await realpath(directory);
  const lock = join(canonical, '.ars-drive-backup.lock');
  const guard=join(canonical,'.ars-drive-recovery.lock');
  try { await lstat(guard); throw new Error('Backup recovery in progress or interrupted.'); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  let handle;
  try {
    handle = await open(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Encrypted backup already running or interrupted. Review the retained lock before retrying.');
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ schema: 1, pid: process.pid, startedAt: new Date().toISOString(), bootId: await currentLinuxBootId(), windowsBoot: await windowsBootEvidence() }));
    await handle.sync();
    const identity = await handle.stat();
    try {
      // Recheck after acquiring the lock to close the recovery guard acquisition window.
      try { await lstat(guard); throw new Error('Backup recovery in progress or interrupted.'); }
      catch(error) { if(error.code!=='ENOENT') throw error; }
      return await work(canonical);
    } finally {
      const current = await lstat(lock);
      if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('Backup lock changed; manual review required.');
      await handle.close();
      handle = undefined;
      await unlink(lock);
    }
  } finally {
    if (handle) await handle.close();
  }
}
