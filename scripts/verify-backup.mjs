import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function verifyFile(path) {
  const record = (await readFile(path + '.sha256', 'utf8')).trim();
  const [checksum, ...name] = record.split(/\s+/);
  if (name.length && name.join(' ') !== basename(path)) {
    throw new Error('Filename differs from its checksum record: ' + basename(path));
  }
  if (!/^[a-f0-9]{64}$/i.test(checksum)) throw new Error('Invalid checksum for ' + basename(path));
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const digest = hash.digest('hex');
  if (digest !== checksum.toLowerCase()) throw new Error('Checksum mismatch for ' + basename(path));
  return digest;
}

export async function verifyBackup(path) {
  if (!path.toLowerCase().endsWith('.dump')) throw new Error('Choose a PostgreSQL .dump file.');
  const digest = await verifyFile(path);
  if (basename(path).includes('-v2-')) {
    const manifestPath = path.slice(0, -5) + '.manifest.json';
    await verifyFile(manifestPath);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== 1 || manifest.archive !== basename(path) || manifest.dumpSha256 !== digest ||
        !manifest.tables || Array.isArray(manifest.tables) || typeof manifest.tables !== 'object') {
      throw new Error('Fingerprint manifest does not match the database archive.');
    }
  }
  const zip = path.slice(0, -5) + '-uploads.zip';
  const withAssets = /-with-uploads\.dump$/i.test(path);
  if (withAssets || await exists(zip) || await exists(zip + '.sha256')) {
    await verifyFile(zip);
    return 'Database and uploaded-file checksums match.';
  }
  return /-database-only\.dump$/i.test(path)
    ? 'Database checksum matches. This backup was created without an uploads folder.'
    : 'Database checksum matches. This older backup has no accompanying uploads archive here.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(await verifyBackup(process.argv[2] || ''));
  } catch (error) {
    console.error('Backup verification failed:', error.message);
    process.exitCode = 1;
  }
}
