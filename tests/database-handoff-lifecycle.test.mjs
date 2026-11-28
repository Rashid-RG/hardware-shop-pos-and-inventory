import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareHandoffRecord} from '../scripts/database-handoff-record.mjs';
import {appendHandoffStage,inspectHandoffLifecycle} from '../scripts/database-handoff-lifecycle.mjs';
const binding={releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64)};
const evidence='d'.repeat(64);
test('append-only rehearsal stages preserve preparation and reject skipped stages',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-lifecycle-'));
 try{
  await prepareHandoffRecord(dir,binding,'PREPARE HANDOFF');
  const before=await readFile(join(dir,'handoff-pending.json'),'utf8');
  const append=phase=>appendHandoffStage(dir,phase,evidence,'RECORD REHEARSAL STAGE');
  await assert.rejects(append('completed-rehearsal'));
  await append('verified');
  await append('switch-rehearsed');
  await append('rollback-rehearsed');
  await append('completed-rehearsal');
  await assert.rejects(append('verified'));
  assert.equal(await readFile(join(dir,'handoff-pending.json'),'utf8'),before);
  const state=await inspectHandoffLifecycle(dir);
  assert.equal(state.state,'completed-rehearsal');
  assert.equal(state.activationAllowed,false);
  assert.equal(state.recoveryAllowed,false);
  await writeFile(join(dir,'handoff-stage-0002.json'),'{');
  assert.equal((await inspectHandoffLifecycle(dir)).state,'unreadable-or-invalid');
 }finally{await rm(dir,{recursive:true,force:true});}
});
