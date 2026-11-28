import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectInterruptedDriveBackup } from '../scripts/drive-backup-recovery.mjs';
test('interrupted backup inspection retains evidence and never authorizes recovery',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-recovery-'));
 try {
  const lock=JSON.stringify({schema:1,pid:123,startedAt:'2026-11-26T12:00:00Z'});
  const state={attemptId:'12345678-1234-1234-1234-123456789abc',attemptedAt:'2026-11-26T12:00:00Z',phase:'upload',archive:'../secret.dump',verifiedAt:null};
  await writeFile(join(dir,'.ars-drive-backup.lock'),lock);
  await writeFile(join(dir,'drive-status.json'),JSON.stringify(state));
  await mkdir(join(dir,'drive-history'));
  await writeFile(join(dir,'drive-history',state.attemptId+'.json'),JSON.stringify(state));
  const result=await inspectInterruptedDriveBackup(dir);
  assert.equal(result.health,'running-or-interrupted');
  assert.equal(result.lockRecordValid,true);
  assert.equal(result.historyMatches,true);
  assert.equal(result.archiveState,'invalid-or-unverified');
  for(const key of ['lockRemovalAllowed','retryAllowed','restoreAllowed','uploadAllowed']) assert.equal(result[key],false);
  assert.equal(await readFile(join(dir,'.ars-drive-backup.lock'),'utf8'),lock);
  assert.ok(!JSON.stringify(result).includes('secret'));
 } finally {await rm(dir,{recursive:true,force:true})}
});
test('missing and malformed evidence never becomes a successful recovery',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-recovery-'));
 try {
  assert.equal((await inspectInterruptedDriveBackup(dir)).historyMatches,false);
  await writeFile(join(dir,'.ars-drive-backup.lock'),'{');
  const result=await inspectInterruptedDriveBackup(dir);
  assert.equal(result.lockPresent,true);
  assert.equal(result.lockRecordValid,false);
  assert.equal(result.requiresOperatorReview,true);
 } finally {await rm(dir,{recursive:true,force:true})}
});
