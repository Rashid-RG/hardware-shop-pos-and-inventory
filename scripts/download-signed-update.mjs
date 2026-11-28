// Fetch a verified bundle for the existing staging tools. This does not activate it.
import {createHash, verify} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';

const archives = new Map([['windows', 'release.zip'], ['linux-mint', 'release.tar.gz']]);

function stableVersion(value) {
 if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value)) {
  throw Error('Expected a stable release version.');
 }
 return value.split('.').map(Number);
}

function isNewer(current, offered) {
 const installed = stableVersion(current);
 const candidate = stableVersion(offered);
 const difference = candidate.findIndex((part, index) => part !== installed[index]);
 return difference >= 0 && candidate[difference] > installed[difference];
}

async function fetchAsset(base, name, limit, consume, timeoutMs) {
 const signal = AbortSignal.timeout(timeoutMs);
 const response = await fetch(new URL(name, base), {redirect: 'error', signal});
 if (!response.ok || !response.body) {
  await response.body?.cancel();
  throw Error('Update asset unavailable: ' + name);
 }
 let bytes = 0;
 async function* boundedBody() {
  for await (const chunk of response.body) {
   bytes += chunk.length;
   if (bytes > limit) throw Error('Update asset exceeds the size limit: ' + name);
   yield chunk;
  }
  if (!bytes) throw Error('Update asset is empty: ' + name);
 }
 return consume(boundedBody(), signal);
}

async function collect(body) {
 const chunks = [];
 for await (const chunk of body) chunks.push(chunk);
 return Buffer.concat(chunks);
}

export async function fetchUpdateFeedStatus(base) {
 const raw = await fetchAsset(base, 'status.json', 4096, collect, 15000);
 return JSON.parse(raw.toString('utf8'));
}

export async function fetchSignedUpdate({feed, platform, currentVersion, expectedVersion, expectedCommit, publicKey, output}) {
 const base = new URL(feed);
 if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) {
  throw Error('Expected a trusted HTTPS release directory URL ending in /.');
 }
 const archive = archives.get(platform);
 if (!archive) throw Error('Unsupported update platform.');
 if ((currentVersion === undefined) === (expectedVersion === undefined)) {
  throw Error('Specify the installed version or the exact expected release version.');
 }
 stableVersion(currentVersion ?? expectedVersion);
 if (expectedCommit !== undefined && (expectedVersion === undefined ||
     typeof expectedCommit !== 'string' || !/^[a-f0-9]{40}$/.test(expectedCommit))) {
  throw Error('An exact approved commit must accompany the expected release version.');
 }
 const key = await readFile(publicKey);
 const [manifest, signature] = await Promise.all([
  fetchAsset(base, 'manifest.json', 65536, collect, 15000),
  fetchAsset(base, 'manifest.sig', 16384, collect, 15000)
 ]);
 if (!verify('sha256', manifest, key, signature)) throw Error('Update manifest signature is invalid.');
 const release = JSON.parse(manifest.toString('utf8'));
 if (release?.product !== 'ARS Distributor' || release.platform !== platform ||
     typeof release.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(release.sha256)) {
  throw Error('Update manifest does not match the requested product and platform.');
 }
 if (expectedVersion !== undefined) {
  if (release.version !== expectedVersion) throw Error('Published update version does not match the approved release.');
  if (expectedCommit !== undefined && release.commit !== expectedCommit) {
   throw Error('Published update commit does not match the approved release.');
  }
 } else if (!isNewer(currentVersion, release.version)) return {available: false};
 if (output === undefined) return {available: true, version: release.version};

 await mkdir(output, {mode: 0o700});
 try {
  const digest = createHash('sha256');
  await fetchAsset(base, archive, 512 * 1024 * 1024, async (body, signal) => {
   async function* hashedBody() {
    for await (const chunk of body) {
     digest.update(chunk);
     yield chunk;
    }
   }
   await pipeline(hashedBody(), createWriteStream(join(output, archive), {flags: 'wx'}), {signal});
  }, 300000);
  if (digest.digest('hex') !== release.sha256) throw Error('Update archive checksum mismatch.');
  const {writeFile} = await import('node:fs/promises');
  await writeFile(join(output, 'manifest.sig'), signature, {flag: 'wx'});
  await writeFile(join(output, 'manifest.json'), manifest, {flag: 'wx'});
  return {available: true, version: release.version, output};
 } catch (error) {
  await rm(output, {recursive: true, force: true});
  throw error;
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  const [feed, platform, currentVersion, publicKey, output, ...extra] = process.argv.slice(2);
  if (!publicKey || extra.length) throw Error('Usage: node download-signed-update.mjs HTTPS_FEED PLATFORM CURRENT_VERSION PUBLIC_KEY [NEW_OUTPUT_DIRECTORY]');
  console.log(JSON.stringify(await fetchSignedUpdate({feed, platform, currentVersion, publicKey, output})));
 } catch (error) {
  console.error(error.message);
  process.exitCode = 1;
 }
}
