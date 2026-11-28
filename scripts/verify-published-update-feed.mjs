import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchSignedUpdate} from './download-signed-update.mjs';

export async function verifyPublishedUpdateFeed(feed, version, publicKey) {
 const base = new URL(feed);
 if (base.protocol !== 'https:' || base.username || base.password ||
     base.search || base.hash || !base.pathname.endsWith('/')) {
  throw Error('Expected a public HTTPS feed directory ending in /.');
 }
 const directory = await mkdtemp(join(tmpdir(), 'ars-published-feed-'));
 const platforms = ['windows', 'linux-mint'];
 try {
  // Wait for both transfers to settle before removing the staging directory.
  const checks = await Promise.allSettled(platforms.map(platform => fetchSignedUpdate({
   feed: new URL(platform + '/', base).href,
   platform,
   expectedVersion: version,
   publicKey,
   output: join(directory, platform)
  })));
  const issues = checks.flatMap((result, index) =>
   result.status === 'rejected' ? [platforms[index] + ': ' + result.reason.message] : []);
  if (issues.length) throw Error(issues.join('\n'));
  return {version, platforms, signaturesVerified: true, archivesVerified: true};
 } finally {
  await rm(directory, {recursive: true, force: true});
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  const [url, version, key, ...extra] = process.argv.slice(2);
  if (!key || extra.length) throw Error('Usage: node verify-published-update-feed.mjs HTTPS_FEED EXPECTED_VERSION PUBLIC_KEY');
  console.log(JSON.stringify(await verifyPublishedUpdateFeed(url, version, key)));
 } catch (error) {
  console.error(error.message);
  process.exitCode = 1;
 }
}
