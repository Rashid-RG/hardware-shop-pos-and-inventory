import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyBackup } from './verify-backup.mjs';
import { withDriveBackupLock } from './drive-backup-lock.mjs';
import { inspectDriveBackupHealth } from './drive-backup-health.mjs';
import { inspectInterruptedDriveBackup } from './drive-backup-recovery.mjs';
import { recoverPreviousBootLock, recoverWindowsPreviousBootLock, recoverWindowsLocalPreviousBootLock } from './drive-backup-previous-boot.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
// Resolve the same Windows runtime contract as the local backup script before writing status.
async function resolveBackupDirectory() {
  if (process.env.ARS_RUNTIME_ROOT === undefined) return resolve(root, 'backups');
  if (process.platform !== 'win32') throw new Error('External runtime cloud backup is not enabled on this platform.');
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(root, 'scripts', 'resolve-windows-backup-directory.ps1')], { cwd: root });
  const lines = stdout.trim().split(/\r?\n/);
  if (lines.length !== 1 || !lines[0].startsWith('ARS_BACKUP_DIRECTORY=')) throw new Error('External backup directory validation failed.');
  const selected = lines[0].slice('ARS_BACKUP_DIRECTORY='.length);
  if (resolve(selected).toLowerCase() !== resolve(process.env.ARS_RUNTIME_ROOT, 'backups').toLowerCase()) throw new Error('External backup directory mismatch.');
  return resolve(selected);
}
let backups, statusFile, historyDir;
const backing = 'ars-drive:ARS-Backups';
const remote = 'ars-encrypted:daily';

export async function uploadSet(dump, run) {
  await verifyBackup(dump);
  const name = basename(dump);
  if (!/^ars-[a-z0-9_-]+-(with-uploads|database-only)\.dump$/i.test(name)) {
    throw new Error('Expected a dated ARS backup set.');
  }
  const stem = name.slice(0, -5);
  const files = [name, name + '.sha256'];
  if (stem.includes('-v2-')) files.push(stem + '.manifest.json', stem + '.manifest.json.sha256');
  if (name.endsWith('-with-uploads.dump')) files.push(stem + '-uploads.zip', stem + '-uploads.zip.sha256');
  const types = await run(['listremotes', '--long']);
  if (!/^ars-drive:\s+drive\s*$/m.test(types) || !/^ars-encrypted:\s+crypt\s*$/m.test(types)) {
    throw new Error('Configure ars-drive as Google Drive and ars-encrypted as crypt.');
  }
  const temp = await mkdtemp(join(tmpdir(), 'ars-upload-'));
  try {
    const list = join(temp, 'files.txt');
    await writeFile(list, files.join('\n') + '\n');
    const destination = remote + '/' + stem;
    const args = [dirname(dump), destination, '--crypt-remote', backing, '--files-from-raw', list];
    await run(['copy', ...args, '--immutable']);
    await run(['check', ...args, '--download']);
    return stem;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function writeStatus(state) {
  const temp = statusFile + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(state), { flag: 'wx' });
  await rename(temp, statusFile);
}

async function writeHistory(state) {
  await mkdir(historyDir,{recursive:true,mode:0o700});
  const destination=join(historyDir,state.attemptId+'.json');
  const temporary=destination+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(state),{flag:'wx',mode:0o600});
  await rename(temporary,destination);
}

async function dailyBackup() {
  const directory = await resolveBackupDirectory();
  return withDriveBackupLock(directory, async () => runDailyBackup(directory));
}

async function runDailyBackup(directory) {
  backups = directory;
  statusFile = join(backups, 'drive-status.json');
  historyDir = join(backups, 'drive-history');
  await mkdir(backups, { recursive: true });
  let previous;
  try { previous = JSON.parse(await readFile(statusFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const state = { attemptId: randomUUID(), attemptedAt: new Date().toISOString(), verifiedAt: previous?.verifiedAt ?? null, phase: 'local' };
  await writeHistory(state);
  await writeStatus(state);
  try {
    const { stdout } = process.platform === 'linux'
      ? await exec('python3', [join(root, 'scripts/mint/backup.py')], { cwd: root })
      : await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', join(root, 'scripts', 'backup-local-postgres.ps1'), '-OutputArchive'], { cwd: root });
    const archive = stdout.split(/\r?\n/).find(line => line.startsWith('ARS_ARCHIVE='))?.slice(12);
    if (!archive || (process.platform === 'win32' ? dirname(resolve(archive)).toLowerCase() !== backups.toLowerCase() : dirname(resolve(archive)) !== backups)) throw new Error('Backup did not return its archive.');
    state.archive = basename(archive);
    state.phase = 'upload';
    await writeHistory(state);
    await writeStatus(state);
    await uploadSet(archive, async args => (await exec('rclone', args, { cwd: root })).stdout);
    state.phase = 'verified';
    state.verifiedAt = new Date().toISOString();
    state.finishedAt = state.verifiedAt;
    await writeHistory(state);
    await writeStatus(state);
    console.log('Google Drive backup verified:', state.verifiedAt);
  } catch (error) {
    state.phase = state.phase === 'local' ? 'local-failed' : state.phase === 'verified' ? 'recording-failed' : 'upload-failed';
    state.finishedAt = new Date().toISOString();
    await writeHistory(state);
    await writeStatus(state);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  const run=args.length===0 ? dailyBackup : args.length===1 && args[0]==='--health'
    ? async()=>{console.log(JSON.stringify(await inspectDriveBackupHealth(await resolveBackupDirectory())));}
    : args.length===1 && args[0]==='--inspect-recovery'
    ? async()=>{console.log(JSON.stringify(await inspectInterruptedDriveBackup(await resolveBackupDirectory())));}
    : args.length===2 && args[0]==='--recover-previous-boot'
    ? async()=>{console.log(JSON.stringify(await recoverPreviousBootLock(await resolveBackupDirectory(),args[1])));}
    : args.length===2 && args[0]==='--recover-windows-previous-boot'
    ? async()=>{console.log(JSON.stringify(await recoverWindowsPreviousBootLock(await resolveBackupDirectory(),args[1])));}
    : args.length===2 && args[0]==='--recover-windows-local-previous-boot'
    ? async()=>{console.log(JSON.stringify(await recoverWindowsLocalPreviousBootLock(await resolveBackupDirectory(),args[1])));}
    : async()=>{throw new Error('Unsupported backup command');};
  run().catch(() => { console.error('Backup operation failed or blocked. Review local backup health and history.'); process.exitCode = 1; });
}
