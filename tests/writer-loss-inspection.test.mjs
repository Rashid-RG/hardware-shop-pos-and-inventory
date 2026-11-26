import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectWriterLoss} from '../scripts/writer-loss-inspection.mjs';
test('read-only writer incident inspection retains original evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ars-incident-'));
 const marker=join(root,'.ars-writer-loss.json');
 try{
  assert.equal((await inspectWriterLoss(root)).state,'absent');
  const raw=JSON.stringify({schema:1,reason:'writer-lease-lost',pid:123,recordedAt:'2026-01-01T00:00:00Z',reconciliationRequired:true});
  await writeFile(marker,raw);
  const result=await inspectWriterLoss(root);
  assert.equal(result.state,'reconciliation-required');
  assert.match(result.incidentDigest,/^[a-f0-9]{64}$/);
  assert.equal(result.startupAllowed,false);
  assert.equal(result.recoveryAllowed,false);
  assert.equal(await readFile(marker,'utf8'),raw);
  await writeFile(marker,'{');
  assert.equal((await inspectWriterLoss(root)).state,'unreadable-or-invalid');
  await rm(marker);await mkdir(marker);
  assert.equal((await inspectWriterLoss(root)).state,'unreadable-or-invalid');
 }finally{await rm(root,{recursive:true,force:true});}
});
