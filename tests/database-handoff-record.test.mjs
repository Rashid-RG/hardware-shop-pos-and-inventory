import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareHandoffRecord,inspectHandoffRecord} from '../scripts/database-handoff-record.mjs';
const binding={releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64)};
test('handoff preparation is exclusive and retained across separate inspection',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-handoff-'));
 try{
  assert.equal((await inspectHandoffRecord(dir)).state,'absent');
  await assert.rejects(prepareHandoffRecord(dir,binding,''));
  const r=await prepareHandoffRecord(dir,binding,'PREPARE HANDOFF');
  assert.equal(r.activationAllowed,false);
  const before=await readFile(join(dir,'handoff-pending.json'),'utf8');
  await assert.rejects(prepareHandoffRecord(dir,binding,'PREPARE HANDOFF'),{code:'EEXIST'});
  assert.equal(await readFile(join(dir,'handoff-pending.json'),'utf8'),before);
  const inspected=await inspectHandoffRecord(dir);
  assert.equal(inspected.id,r.id);
  assert.equal(inspected.recoveryAllowed,false);
  await writeFile(join(dir,'handoff-pending.json'),'{');
  assert.equal((await inspectHandoffRecord(dir)).state,'unreadable-or-invalid');
 }finally{await rm(dir,{recursive:true,force:true});}
});
