// Local Docker PostgreSQL backup. Requires Node.js and running hardware-pos-postgres.
// Never restores or modifies the live database.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

const container = 'hardware-pos-postgres';
const database = 'hardware_pos';
const backupDir = resolve(process.env.ARS_BACKUP_DIR || 'backups');
const retention = Number(process.env.ARS_BACKUP_KEEP || 30);
if (!Number.isSafeInteger(retention) || retention < 7 || retention > 3650) {
  throw new Error('ARS_BACKUP_KEEP must be an integer from 7 to 3650');
}
mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const finalFile = join(backupDir, `ars_${timestamp}.dump`);
const tempFile = finalFile + '.partial';
const lockFile = join(backupDir, '.ars-backup.lock');
let lockHandle;
try {
  lockHandle = openSync(lockFile, 'wx');
} catch (error) {
  if (error.code === 'EEXIST') throw new Error('Another backup may be running; verify before removing the backup lock.');
  throw error;
}
function runCheck(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Docker command failed');
  return result.stdout;
}
async function dump() {
  await new Promise((accept, reject) => {
    const proc = spawn('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-d', database, '-Fc', '--no-owner', '--no-privileges'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const output = createWriteStream(tempFile, { flags: 'wx' });
    let stderr = '';
    let processCode = null;
    let fileFinished = false;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      proc.kill();
      output.destroy();
      reject(error);
    };
    const maybeDone = () => {
      if (settled || processCode === null || !fileFinished) return;
      settled = true;
      accept();
    };
    proc.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    proc.on('error', fail);
    output.on('error', fail);
    proc.stdout.pipe(output);
    proc.on('close', code => {
      if (code !== 0) return fail(new Error(`pg_dump exited ${code}: ${stderr}`));
      processCode = code;
      maybeDone();
    });
    output.on('finish', () => { fileFinished = true; maybeDone(); });
  });
}
async function verifyArchive(file) {
  await new Promise((accept, reject) => {
    const proc = spawn('docker', ['exec', '-i', container, 'pg_restore', '--list'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const input = createReadStream(file);
    const fail = error => {
      if (settled) return;
      settled = true;
      input.destroy();
      proc.kill();
      reject(error);
    };
    proc.on('error', fail);
    input.on('error', fail);
    proc.stdin.on('error', fail);
    proc.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-65536); });
    proc.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    input.pipe(proc.stdin);
    proc.on('close', code => {
      if (settled) return;
      settled = true;
      if (code !== 0 || !stdout.includes('TABLE')) return reject(new Error('Archive verification failed: ' + (stderr || 'missing table metadata')));
      accept();
    });
  });
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
try {
  runCheck(['exec', container, 'pg_isready', '-U', 'postgres', '-d', database]);
  await dump();
  if (!existsSync(tempFile) || statSync(tempFile).size < 1024) throw new Error('Dump missing or unexpectedly small');
  // pg_restore parses the archive contents without applying changes to any database.
  await verifyArchive(tempFile);
  renameSync(tempFile, finalFile);
  const digest = await sha256(finalFile);
  console.log(JSON.stringify({ status: 'verified', file: finalFile, bytes: statSync(finalFile).size, sha256: digest }));
  // Retain the latest N successful archives; never count or delete partial files.
  const completed = readdirSync(backupDir)
    .filter(name => /^ars_\d{4}-.*\.dump$/.test(name))
    .sort().reverse();
  for (const oldName of completed.slice(retention)) rmSync(join(backupDir, oldName));
} catch (error) {
  console.error('ARS backup FAILED:', error.message);
  process.exitCode = 1;
} finally {
  if (existsSync(tempFile)) rmSync(tempFile, { force: true });
  if (lockHandle !== undefined) closeSync(lockHandle);
  rmSync(lockFile, { force: true });
}
