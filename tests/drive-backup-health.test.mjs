import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDriveBackupHealth } from '../scripts/drive-backup-health.mjs';
test('health preserves last success and prioritizes interrupted or overlapping runs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-health-'));
 const now=Date.parse('2026-11-26T12:00:00Z');
 const verifiedAt='2026-11-25T12:00:00Z';
 const file=join(dir,'drive-status.json');
 try {
  assert.equal((await inspectDriveBackupHealth(dir,now)).health,'never-run');
  await writeFile(file,JSON.stringify({phase:'verified',verifiedAt}));
  assert.equal((await inspectDriveBackupHealth(dir,now)).health,'verified');
  assert.equal((await inspectDriveBackupHealth(dir,now+86400000)).health,'verification-overdue');
  await writeFile(file,JSON.stringify({phase:'upload-failed',verifiedAt,error:'secret'}));
  const failed=await inspectDriveBackupHealth(dir,now);
  assert.equal(failed.health,'upload-failed');
  assert.equal(failed.lastVerifiedAt,verifiedAt);
  assert.ok(!JSON.stringify(failed).includes('secret'));
  await writeFile(file,JSON.stringify({phase:'local',verifiedAt}));
  assert.equal((await inspectDriveBackupHealth(dir,now)).health,'interrupted-or-unconfirmed');
  await writeFile(join(dir,'.ars-drive-backup.lock'),'retained evidence');
  assert.equal((await inspectDriveBackupHealth(dir,now)).health,'running-or-interrupted');
 } finally {await rm(dir,{recursive:true,force:true})}
});
test('corrupt status is not treated as success',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-health-'));
 try {
  await writeFile(join(dir,'drive-status.json'),'{');
  const result=await inspectDriveBackupHealth(dir);
  assert.equal(result.health,'status-unreadable');
  assert.equal(result.requiresReview,true);
  assert.equal(result.uploadAllowed,false);
 } finally {await rm(dir,{recursive:true,force:true})}
});
