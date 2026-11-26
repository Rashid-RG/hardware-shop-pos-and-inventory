import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsRecoveryEligible, recoverWindowsPreviousBootLock } from '../scripts/drive-backup-previous-boot.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const old={schema:1,hostDigest:'a'.repeat(64),bootUtc:'2026-11-25T08:00:00Z',eventUtc:'2026-11-25T08:00:10Z',eventRecord:'100'};
const current={...old,bootUtc:'2026-11-26T08:00:00Z',eventUtc:'2026-11-26T08:00:10Z',eventRecord:'200'};
const lock={schema:1,pid:123,startedAt:'2026-11-25T09:00:00Z',bootId:null,windowsBoot:old};
test('Windows recovery requires host-bound corroborated boot and a valid Windows lock',()=>{
 assert.equal(windowsRecoveryEligible(lock,current),true);
 for(const record of [{...lock,pid:0},{...lock,bootId:undefined},{...lock,windowsBoot:null},{...lock,schema:2}]) assert.equal(windowsRecoveryEligible(record,current),false);
 assert.equal(windowsRecoveryEligible(lock,old),false);
 assert.equal(windowsRecoveryEligible(lock,{...current,eventRecord:'99'}),false);
});
test('unconfirmed Windows recovery leaves original evidence untouched',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-win-recovery-'));
 try {
  const file=join(dir,'.ars-drive-backup.lock');
  await writeFile(file,JSON.stringify(lock));
  await assert.rejects(recoverWindowsPreviousBootLock(dir,'no'),/confirmation/);
  if(process.platform!=='win32') await assert.rejects(recoverWindowsPreviousBootLock(dir,'RECOVER WINDOWS PREVIOUS BOOT'),/Windows host/);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),lock);
 } finally {await rm(dir,{recursive:true,force:true});}
});
