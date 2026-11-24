import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uploadSet } from '../scripts/drive-backup.mjs';

test('encrypted backup verifies the whole set and can be downloaded', async t => {
  const exec = promisify(execFile);
  try { await exec('rclone', ['version']); }
  catch (error) { if (error.code === 'ENOENT') return t.skip('rclone unavailable'); throw error; }
  const dir = await mkdtemp(join(tmpdir(), 'ars-drive-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const local = join(dir, 'backups');
  const cloud = join(dir, 'encrypted');
  const download = join(dir, 'download');
  await mkdir(local);
  const stem = 'ars-sample-20261124-with-uploads';
  const name = stem + '.dump';
  for (const file of [name, stem + '-uploads.zip']) {
    await writeFile(join(local, file), 'test payload ' + file);
    const hash = createHash('sha256').update(await readFile(join(local, file))).digest('hex');
    await writeFile(join(local, file + '.sha256'), hash + '  ' + file);
  }
  const config = join(dir, 'rclone.conf');
  const pass = (await exec('rclone', ['obscure', 'disposable-test-password'])).stdout.trim();
  await writeFile(config, '[ars-encrypted]\ntype = crypt\nremote = ' + cloud + '\npassword = ' + pass + '\n');
  const run = async args => (await exec('rclone', ['--config', config, ...args])).stdout;
  // Replace only the Drive transport with a temporary directory.
  const transport = args => args[0] === 'listremotes' ? 'ars-drive: drive\nars-encrypted: crypt' :
    run(args.map(arg => arg === 'ars-drive:ARS-Backups' ? cloud : arg));
  const dump = join(local, name);
  assert.equal(await uploadSet(dump, transport), stem);
  assert.equal(await uploadSet(dump, transport), stem);
  assert(!(await readdir(cloud)).includes('daily'));
  await run(['copy', 'ars-encrypted:daily/' + stem, download]);
  for (const file of await readdir(local)) assert.deepEqual(await readFile(join(download, file)), await readFile(join(local, file)));
  await assert.rejects(uploadSet(dump, async () => 'ars-encrypted: drive'), /Configure/);
  await assert.rejects(uploadSet(dump, args => { if (args[0] === 'check') throw Error('verification failed'); return transport(args); }), /verification failed/);
  await writeFile(dump, 'corrupted');
  await assert.rejects(uploadSet(dump, transport), /mismatch/);
});
