import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareHandoffRecord} from '../scripts/database-handoff-record.mjs';
import {appendHandoffStage,recordHandoffClosure,inspectHandoffClosure} from '../scripts/database-handoff-lifecycle.mjs';
const binding={releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64)};
test('closure requires terminal journal and retains startup block',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-closure-'));
 try{
  await prepareHandoffRecord(dir,binding,'PREPARE HANDOFF');
  const marker=await readFile(join(dir,'handoff-pending.json'),'utf8');
  assert.equal((await inspectHandoffClosure(dir)).state,'incomplete');
  await assert.rejects(recordHandoffClosure(dir,'RECORD REHEARSAL CLOSURE'),/not terminal/);
  await appendHandoffStage(dir,'aborted','d'.repeat(64),'RECORD REHEARSAL STAGE');
  assert.equal((await inspectHandoffClosure(dir)).state,'closure-not-recorded');
  await assert.rejects(recordHandoffClosure(dir,''));
  const result=await recordHandoffClosure(dir,'RECORD REHEARSAL CLOSURE');
  assert.equal(result.maintenanceRetained,true);
  assert.equal(result.startupAllowed,false);
  await assert.rejects(recordHandoffClosure(dir,'RECORD REHEARSAL CLOSURE'),{code:'EEXIST'});
  assert.equal((await inspectHandoffClosure(dir)).state,'closure-matched');
  assert.equal(await readFile(join(dir,'handoff-pending.json'),'utf8'),marker);
  const stage=join(dir,'handoff-stage-0001.json');
  const changed=JSON.parse(await readFile(stage,'utf8'));changed.evidenceDigest='e'.repeat(64);
  await writeFile(stage,JSON.stringify(changed));
  assert.equal((await inspectHandoffClosure(dir)).state,'unreadable-or-invalid');
 }finally{await rm(dir,{recursive:true,force:true});}
});
