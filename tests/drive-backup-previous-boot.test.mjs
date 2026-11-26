import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryEligible, recoverPreviousBootLock, currentLinuxBootId } from '../scripts/drive-backup-previous-boot.mjs';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const old='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const record={schema:1,bootId:old,pid:123,startedAt:'2026-11-26T12:00:00Z'};
test('recovery eligibility requires a distinct known boot',()=>{
 assert.equal(recoveryEligible(record,old),false);
 assert.equal(recoveryEligible({...record,bootId:null},old),false);
 assert.equal(recoveryEligible(record,null),false);
 assert.equal(recoveryEligible(record,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),true);
});
test('Linux previous-boot recovery retains original lock and never starts retry',async t=>{
 const boot=await currentLinuxBootId();
 if(!boot){t.skip('Linux boot identity unavailable');return;}
 const dir=await mkdtemp(join(tmpdir(),'ars-boot-recovery-'));
 try {
  const file=join(dir,'.ars-drive-backup.lock');
  const prior={...record,bootId:boot===old?'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb':old};
  await writeFile(file,JSON.stringify(prior));
  await assert.rejects(recoverPreviousBootLock(dir,'no'),/confirmation/);
  const result=await recoverPreviousBootLock(dir,'RECOVER PREVIOUS BOOT');
  assert.equal(result.retryStarted,false);
  const names=await readdir(dir);
  assert.equal(names.length,1);
  assert.deepEqual(JSON.parse(await readFile(join(dir,names[0],'previous-boot.lock'),'utf8')),prior);
  await writeFile(file,JSON.stringify({...record,bootId:boot}));
  await assert.rejects(recoverPreviousBootLock(dir,'RECOVER PREVIOUS BOOT'),/previous boot/);
  assert.equal(JSON.parse(await readFile(file,'utf8')).bootId,boot);
 } finally {await rm(dir,{recursive:true,force:true});}
});
