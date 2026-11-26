import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDriveBackupLock } from '../scripts/drive-backup-lock.mjs';

test('overlapping encrypted backup executions cannot enter the work section', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-lock-'));
 try {
  let release, entered;
  const ready=new Promise(r=>{entered=r});
  const gate=new Promise(r=>{release=r});
  const first=withDriveBackupLock(dir,async()=>{entered();await gate;return 7});
  await ready;
  try {
   await assert.rejects(withDriveBackupLock(dir,()=>assert.fail('overlap entered')), /already running or interrupted/);
  } finally {release();await first;}
  assert.equal(await withDriveBackupLock(dir,()=>8),8);
 } finally {await rm(dir,{recursive:true,force:true})}
});
test('normal failure releases lock but retained crash lock is never automatically removed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-lock-'));
 try {
  await assert.rejects(withDriveBackupLock(dir,()=>{throw new Error('simulated failure')}),/simulated failure/);
  const lock=join(dir,'.ars-drive-backup.lock');
  await assert.rejects(access(lock),{code:'ENOENT'});
  await writeFile(lock,'retained crash evidence');
  await assert.rejects(withDriveBackupLock(dir,()=>assert.fail('stale lock bypassed')), /already running or interrupted/);
  assert.equal(await readFile(lock,'utf8'),'retained crash evidence');
 } finally {await rm(dir,{recursive:true,force:true})}
});
