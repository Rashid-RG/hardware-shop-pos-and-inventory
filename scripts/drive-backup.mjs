import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyBackup } from './verify-backup.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const backups = resolve(root, 'backups');
const statusFile = join(backups, 'drive-status.json');
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

async function dailyBackup() {
  await mkdir(backups, { recursive: true });
  let previous;
  try { previous = JSON.parse(await readFile(statusFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const state = { attemptedAt: new Date().toISOString(), verifiedAt: previous?.verifiedAt ?? null, phase: 'local' };
  await writeStatus(state);
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', join(root, 'scripts', 'backup-local-postgres.ps1'), '-OutputArchive'], { cwd: root });
    const archive = stdout.split(/\r?\n/).find(line => line.startsWith('ARS_ARCHIVE='))?.slice(12);
    if (!archive || dirname(resolve(archive)) !== backups) throw new Error('Backup did not return its archive.');
    state.phase = 'upload';
    await writeStatus(state);
    await uploadSet(archive, async args => (await exec('rclone', args, { cwd: root })).stdout);
    state.phase = 'verified';
    state.verifiedAt = new Date().toISOString();
    await writeStatus(state);
    console.log('Google Drive backup verified:', state.verifiedAt);
  } catch (error) {
    state.phase = state.phase === 'local' ? 'local-failed' : 'upload-failed';
    await writeStatus(state);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  dailyBackup().catch(error => { console.error(error.message); process.exitCode = 1; });
}
