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
