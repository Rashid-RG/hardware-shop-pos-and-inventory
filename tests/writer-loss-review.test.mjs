import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordWriterLossReview,inspectWriterLossReview} from '../scripts/writer-loss-review.mjs';
test('incident review is exclusive, incident-bound and never authorizes startup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ars-review-'));
 const marker=join(root,'.ars-writer-loss.json');
 const evidence=Object.fromEntries(['databaseIdentity','previousSession','recoverableBackup','invoices','payments','inventory','accounting'].map(k=>[k,'a'.repeat(64)]));
 try{
  await assert.rejects(recordWriterLossReview(root,evidence,'RECORD INCIDENT REVIEW'),/Valid incident/);
  const incident={schema:1,reason:'writer-lease-lost',pid:123,recordedAt:'2026-01-01T00:00:00Z',reconciliationRequired:true};
  const original=JSON.stringify(incident);
  await writeFile(marker,original);
  assert.equal((await inspectWriterLossReview(root)).state,'review-not-recorded');
  await assert.rejects(recordWriterLossReview(root,{},'RECORD INCIDENT REVIEW'));
  await assert.rejects(recordWriterLossReview(root,evidence,''));
  const result=await recordWriterLossReview(root,evidence,'RECORD INCIDENT REVIEW');
  assert.equal(result.startupAllowed,false);
  assert.equal(result.incidentRetained,true);
  await assert.rejects(recordWriterLossReview(root,evidence,'RECORD INCIDENT REVIEW'),{code:'EEXIST'});
  assert.equal((await inspectWriterLossReview(root)).state,'review-recorded');
  assert.equal(await readFile(marker,'utf8'),original);
  await writeFile(marker,JSON.stringify({...incident,pid:124}));
  assert.equal((await inspectWriterLossReview(root)).state,'unreadable-or-mismatched');
 }finally{await rm(root,{recursive:true,force:true});}
});
