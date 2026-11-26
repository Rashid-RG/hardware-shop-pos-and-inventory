import test from 'node:test';
import assert from 'node:assert/strict';
import { compareWindowsBoot, windowsBootEvidence } from '../scripts/drive-backup-windows-boot.mjs';
const prior={schema:1,hostDigest:'a'.repeat(64),bootUtc:'2026-11-25T08:00:00.000Z'};
const started='2026-11-25T09:00:00.000Z';
test('Windows boot evidence is conservative and host-bound',()=>{
 assert.equal(compareWindowsBoot(prior,prior,started),'same-boot');
 assert.equal(compareWindowsBoot(prior,{...prior,bootUtc:'2026-11-26T08:00:00Z'},started),'later-boot-observed');
 assert.equal(compareWindowsBoot(prior,{...prior,hostDigest:'b'.repeat(64)},started),'different-host');
 assert.equal(compareWindowsBoot(prior,{...prior,bootUtc:'2026-11-25T08:30:00Z'},started),'inconsistent');
 assert.equal(compareWindowsBoot(null,prior,started),'unavailable');
});
test('native boot probe returns bounded evidence or fails closed',async()=>{
 const evidence=await windowsBootEvidence();
 if(process.platform!=='win32') assert.equal(evidence,null);
 if(evidence){
  assert.match(evidence.hostDigest,/^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(evidence.bootUtc)));
  assert.equal(compareWindowsBoot(evidence,evidence,new Date().toISOString()),'same-boot');
 }
});
