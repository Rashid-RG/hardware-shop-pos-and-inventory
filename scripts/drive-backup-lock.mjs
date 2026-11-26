import { mkdir, open, unlink, realpath, lstat } from 'node:fs/promises';
import { join } from 'node:path';

// Fail closed on existing locks, including after a crash. Never guess that a PID is stale.
export async function withDriveBackupLock(directory, work) {
  await mkdir(directory, { recursive: true });
  const canonical = await realpath(directory);
  const lock = join(canonical, '.ars-drive-backup.lock');
  let handle;
  try {
    handle = await open(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Encrypted backup already running or interrupted. Review the retained lock before retrying.');
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ schema: 1, pid: process.pid, startedAt: new Date().toISOString() }));
    await handle.sync();
    const identity = await handle.stat();
    try {
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
