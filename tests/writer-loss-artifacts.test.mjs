import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectWriterLoss} from '../scripts/writer-loss-inspection.mjs';
import {recordWriterLossReview} from '../scripts/writer-loss-review.mjs';
import {verifyWriterLossArtifacts} from '../scripts/writer-loss-artifacts.mjs';
test('artifact integrity requires all seven incident-bound documents and never authorizes recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ars-artifacts-'));
 try{
  await writeFile(join(root,'.ars-writer-loss.json'),JSON.stringify({schema:1,reason:'writer-lease-lost',pid:123,recordedAt:'2026-01-01T00:00:00Z',reconciliationRequired:true}));
  const {incidentDigest}=await inspectWriterLoss(root);
  const folder=join(root,'writer-loss-evidence',incidentDigest);
  await mkdir(folder,{recursive:true});
  const evidence={};
  for(const category of ['databaseIdentity','previousSession','recoverableBackup','invoices','payments','inventory','accounting']){
   const raw=JSON.stringify({schema:1,incidentDigest,category});
   evidence[category]=createHash('sha256').update(raw).digest('hex');
   await writeFile(join(folder,category+'.json'),raw);
  }
  await recordWriterLossReview(root,evidence,'RECORD INCIDENT REVIEW');
  const result=await verifyWriterLossArtifacts(root);
  assert.equal(result.state,'artifact-integrity-matched');
  assert.equal(result.checks.length,7);
  assert.equal(result.accountingVerified,false);
  assert.equal(result.startupAllowed,false);
  assert.equal(result.recoveryAllowed,false);
  await writeFile(join(folder,'invoices.json'),'{}');
  assert.equal((await verifyWriterLossArtifacts(root)).state,'artifact-mismatch');
  await rm(join(folder,'payments.json'));
  assert.equal((await verifyWriterLossArtifacts(root)).checks.find(x=>x.category==='payments').matched,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
