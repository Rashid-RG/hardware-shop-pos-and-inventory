import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareHandoffRecord} from '../scripts/database-handoff-record.mjs';
import {appendHandoffStage} from '../scripts/database-handoff-lifecycle.mjs';
import {rehearseControlledStartup} from '../scripts/database-controlled-startup.mjs';
const binding={releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64)};
const owner={pid:123,started:'2026-01-01T00:00:00Z'};
test('controlled startup rehearsal requires journal and database ownership before and after private proof',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ars-controlled-'));
 try{
  let calls=0, lose=false;
  const observer={query:async()=>({rows:[{owned:++calls===1||!lose}]})};
  const args={directory,observer,owner,binding};
  await prepareHandoffRecord(directory,binding,'PREPARE HANDOFF');
  await assert.rejects(rehearseControlledStartup(args),/Verified rehearsal journal/);
  await appendHandoffStage(directory,'verified','d'.repeat(64),'RECORD REHEARSAL STAGE');
  await assert.rejects(rehearseControlledStartup({...args,binding:{...binding,releaseDigest:'e'.repeat(64)}}),/binding mismatch/);
  assert.deepEqual(await rehearseControlledStartup(args),{authorizationVerified:true,ownershipObservedBeforeAndAfter:true,maintenanceRetained:true,liveStartupAllowed:false});
  assert.equal(calls,2);
  calls=0;lose=true;
  await assert.rejects(rehearseControlledStartup(args),/ownership not verified/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
