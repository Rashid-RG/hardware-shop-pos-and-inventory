import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchSignedUpdate, fetchUpdateFeedStatus} from './download-signed-update.mjs';

export async function verifyPublishedUpdateFeed(feed, version, publicKey, expectedCommit) {
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
   expectedCommit,
   publicKey,
   output: join(directory, platform)
  })));
  const issues = checks.flatMap((result, index) =>
   result.status === 'rejected' ? [platforms[index] + ': ' + result.reason.message] : []);
  if (issues.length) throw Error(issues.join('\n'));
  if (expectedCommit !== undefined) {
   const status = await fetchUpdateFeedStatus(base);
   if (status?.product !== 'ARS Distributors' || status.channel !== 'production' ||
       status.status !== 'published' || status.version !== version || status.commit !== expectedCommit ||
       !Array.isArray(status.platforms) || status.platforms.length !== platforms.length ||
       !platforms.every(platform => status.platforms.includes(platform))) {
    throw Error('Public release status does not match the verified downloads.');
   }
  }
  return {version, platforms, signaturesVerified: true, archivesVerified: true,
   ...(expectedCommit === undefined ? {} : {commit: expectedCommit, statusVerified: true})};
 } finally {
  await rm(directory, {recursive: true, force: true});
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  const [url, version, key, commit, ...extra] = process.argv.slice(2);
  if (!key || extra.length) throw Error('Usage: node verify-published-update-feed.mjs HTTPS_FEED EXPECTED_VERSION PUBLIC_KEY [APPROVED_COMMIT]');
  console.log(JSON.stringify(await verifyPublishedUpdateFeed(url, version, key, commit)));
 } catch (error) {
  console.error(error.message);
  process.exitCode = 1;
 }
}
