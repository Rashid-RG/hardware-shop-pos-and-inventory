import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {startDesktopUpdateMonitor} from '../scripts/desktop-update-monitor.mjs';

test('desktop feed check recovers from offline status and stops with the POS', {timeout: 3000}, async () => {
 let calls = 0;
 let latestSignal;
 const monitor = startDesktopUpdateMonitor(async signal => {
  latestSignal = signal;
  if (++calls === 1) throw Error('Offline');
  return {state: 'available', version: '1.1.0'};
 }, 40);
 try {
  assert.deepEqual(monitor.status(), {state: 'checking'});
  while (monitor.status().state === 'checking') await delay(5);
  assert.deepEqual(monitor.status(), {state: 'unavailable'});
  while (monitor.status().state === 'unavailable') await delay(5);
  assert.deepEqual(monitor.status(), {state: 'available', version: '1.1.0'});
 } finally {
  monitor.stop();
 }
 assert.equal(latestSignal.aborted, true);
 const before = calls;
 await delay(60);
 assert.equal(calls, before);
});
