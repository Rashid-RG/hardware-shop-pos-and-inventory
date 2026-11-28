import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectWriterLoss} from '../scripts/writer-loss-inspection.mjs';
import {recordWriterLossReview} from '../scripts/writer-loss-review.mjs';
import {verifyIncidentBackup} from '../scripts/writer-loss-backup.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
test('incident archive verification matches actual bytes but never claims restore success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ars-incident-backup-'));
 try{
  await writeFile(join(root,'.ars-writer-loss.json'),JSON.stringify({schema:1,reason:'writer-lease-lost',pid:123,recordedAt:'2026-01-01T00:00:00Z',reconciliationRequired:true}));
  const {incidentDigest}=await inspectWriterLoss(root);
  const folder=join(root,'writer-loss-evidence',incidentDigest);
  await mkdir(folder,{recursive:true});await mkdir(join(root,'backups'));
  const archive='ars-test-database-only.dump',raw='fixture archive, not a real database dump';
  const path=join(root,'backups',archive);
  await writeFile(path,raw);await writeFile(path+'.sha256',hash(raw)+'  '+archive);
  const evidence={};
  for(const category of ['databaseIdentity','previousSession','recoverableBackup','invoices','payments','inventory','accounting']){
   const data=JSON.stringify({schema:1,incidentDigest,category,...(category==='recoverableBackup'?{archive,archiveSha256:hash(raw)}:{})});
   evidence[category]=hash(data);await writeFile(join(folder,category+'.json'),data);
  }
  await recordWriterLossReview(root,evidence,'RECORD INCIDENT REVIEW');
  const result=await verifyIncidentBackup(root);
  assert.equal(result.state,'archive-integrity-matched');
  assert.equal(result.restoreTestPassed,false);
  assert.equal(result.startupAllowed,false);
  assert.equal(result.recoveryAllowed,false);
  await writeFile(path,'changed');
  assert.equal((await verifyIncidentBackup(root)).state,'archive-unverified');
 }finally{await rm(root,{recursive:true,force:true});}
});
