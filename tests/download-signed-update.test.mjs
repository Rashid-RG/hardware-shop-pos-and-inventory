import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fetchSignedUpdate} from '../scripts/download-signed-update.mjs';

test('only a newer, signed platform bundle with a matching archive is retained', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'ars-download-test-'));
 t.after(() => rm(directory, {recursive: true, force: true}));
 const {publicKey, privateKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
 const key = join(directory, 'trust.pem');
 await writeFile(key, publicKey.export({type: 'spki', format: 'pem'}));
 const archive = Buffer.from('sample archive');
 const manifest = Buffer.from(JSON.stringify({product: 'ARS Distributor', platform: 'windows',
  version: '1.10.0', sha256: createHash('sha256').update(archive).digest('hex')}));
 const signature = sign('sha256', manifest, privateKey);
 const assets = new Map([['manifest.json', manifest], ['manifest.sig', signature], ['release.zip', archive]]);
 const requested = [];
 t.mock.method(globalThis, 'fetch', async (url, options) => {
  assert.equal(url.origin, 'https://release.example');
  assert.equal(options.redirect, 'error');
  const name = url.pathname.split('/').at(-1);
  requested.push(name);
  return new Response(assets.get(name));
 });
 const options = {feed: 'https://release.example/stable/', platform: 'windows', currentVersion: '1.9.0', publicKey: key};
 assert.deepEqual(await fetchSignedUpdate(options), {available: true, version: '1.10.0'});
 assert.ok(!requested.includes('release.zip'));
 assert.deepEqual(await fetchSignedUpdate({...options, currentVersion: '1.10.0'}), {available: false});
 await assert.rejects(fetchSignedUpdate({...options, platform: 'linux-mint'}), /product and platform/);
 const output = join(directory, 'bundle');
 await fetchSignedUpdate({...options, output});
 assert.deepEqual(await readFile(join(output, 'release.zip')), archive);
 await assert.rejects(fetchSignedUpdate({...options, output}), {code: 'EEXIST'});
 assets.set('release.zip', 'changed archive');
 const failed = join(directory, 'failed');
 await assert.rejects(fetchSignedUpdate({...options, output: failed}), /checksum mismatch/);
 await assert.rejects(stat(failed), {code: 'ENOENT'});
 assets.set('manifest.sig', Buffer.alloc(16385));
 await assert.rejects(fetchSignedUpdate(options), /size limit/);
 assets.set('manifest.sig', Buffer.from('bad signature'));
 await assert.rejects(fetchSignedUpdate(options), /signature is invalid/);
});

test('signed downloads work over real TLS and reject an untrusted certificate', async t => {
 const {execFileSync, execFile} = await import('node:child_process');
 const {promisify} = await import('node:util');
 const {createServer} = await import('node:https');
 const {fileURLToPath} = await import('node:url');
 const run = promisify(execFile);
 const directory = await mkdtemp(join(tmpdir(), 'ars-tls-'));
 t.after(() => rm(directory, {recursive: true, force: true}));
 const tlsKey = join(directory, 'tls-key.pem');
 const certificate = join(directory, 'tls-cert.pem');
 execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1',
  '-keyout', tlsKey, '-out', certificate], {stdio: 'ignore'});
 const {publicKey, privateKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
 const trust = join(directory, 'release-trust.pem');
 await writeFile(trust, publicKey.export({type: 'spki', format: 'pem'}));
 const payload = Buffer.from('disposable release archive');
 const manifest = Buffer.from(JSON.stringify({product: 'ARS Distributor', platform: 'linux-mint',
  version: '2.0.0', sha256: createHash('sha256').update(payload).digest('hex')}));
 const routes = new Map([['/manifest.json', manifest], ['/manifest.sig', sign('sha256', manifest, privateKey)],
  ['/release.tar.gz', payload]]);
 for (const [platform, archive] of [['linux-mint', 'release.tar.gz'], ['windows', 'release.zip']]) {
  const platformManifest = Buffer.from(JSON.stringify({product: 'ARS Distributor', platform, version: '2.0.0',
   sha256: createHash('sha256').update(payload).digest('hex')}));
  routes.set('/' + platform + '/manifest.json', platformManifest);
  routes.set('/' + platform + '/manifest.sig', sign('sha256', platformManifest, privateKey));
  routes.set('/' + platform + '/' + archive, payload);
 }
 const server = createServer({key: await readFile(tlsKey), cert: await readFile(certificate)},
  (request, response) => {
   const body = routes.get(request.url);
   if (!body) response.statusCode = 404;
   response.end(body);
  });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 try {
  const url = 'https://127.0.0.1:' + server.address().port + '/';
  const script = fileURLToPath(new URL('../scripts/download-signed-update.mjs', import.meta.url));
  const args = [script, url, 'linux-mint', '1.0.0', trust, join(directory, 'bundle')];
  await assert.rejects(run(process.execPath, args, {timeout: 10000}), /fetch failed/);
  const {stdout} = await run(process.execPath, args, {timeout: 10000,
   env: {...process.env, NODE_EXTRA_CA_CERTS: certificate}});
  assert.equal(JSON.parse(stdout).version, '2.0.0');
  assert.deepEqual(await readFile(join(directory, 'bundle', 'release.tar.gz')), payload);
  const verifier = fileURLToPath(new URL('../scripts/verify-published-update-feed.mjs', import.meta.url));
  const trusted = {timeout: 10000, env: {...process.env, NODE_EXTRA_CA_CERTS: certificate}};
  const report = await run(process.execPath, [verifier, url, '2.0.0', trust], trusted);
  assert.deepEqual(JSON.parse(report.stdout), {
   version: '2.0.0', platforms: ['windows', 'linux-mint'], signaturesVerified: true, archivesVerified: true
  });
  await assert.rejects(run(process.execPath, [verifier, url, '2.0.1', trust], trusted), /does not match the approved release/);
  routes.set('/windows/release.zip', Buffer.from('tampered'));
  await assert.rejects(run(process.execPath, [verifier, url, '2.0.0', trust], trusted), /windows: Update archive checksum mismatch/);
 } finally {
  await new Promise(resolve => server.close(resolve));
 }
});
