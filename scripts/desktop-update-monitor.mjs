import {execFile} from 'node:child_process';
import {lstat, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';

const run = promisify(execFile);

export async function checkDesktopFeed(state, project, platform, version, signal) {
 const feedFile = join(state, 'release-feed-url.txt');
 const trust = join(state, 'release-signing-public.pem');
 let entries;
 try {
  entries = await Promise.all([lstat(feedFile), lstat(trust)]);
 } catch (error) {
  if (error.code === 'ENOENT') return {state: 'unconfigured'};
  throw error;
 }
 if (entries.some(entry => !entry.isFile()) || entries[0].size > 2048 || entries[1].size > 65536) {
  throw Error('Invalid desktop update configuration.');
 }
 const feed = (await readFile(feedFile, 'utf8')).trim();
 const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['path', 'systemroot', 'windir', 'temp', 'tmp', 'node_extra_ca_certs'].includes(key.toLowerCase())));
 const {stdout} = await run(process.execPath, [
  join(project, 'scripts', 'download-signed-update.mjs'), feed, platform, version, trust
 ], {cwd: project, windowsHide: true, timeout: 20000, maxBuffer: 8192, env, signal});
 const result = JSON.parse(stdout);
 if (result.available === false) return {state: 'current'};
 if (result.available !== true || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(result.version)) {
  throw Error('Invalid signed feed result.');
 }
 return {state: 'available', version: result.version};
}

export function startDesktopUpdateMonitor(check, intervalMs = 6 * 60 * 60 * 1000) {
 const controller = new AbortController();
 let status = {state: 'checking'};
 async function refresh() {
  try {
   const result = await check(controller.signal);
   if (!controller.signal.aborted) status = result;
  } catch {
   if (!controller.signal.aborted) status = {state: 'unavailable'};
  }
  if (!controller.signal.aborted) {
   timer = setTimeout(refresh, intervalMs);
   timer.unref();
  }
 }
 let timer = setTimeout(refresh, 0);
 timer.unref();
 return {
  status: () => status,
  stop: () => { controller.abort(); clearTimeout(timer); }
 };
}
