import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {matchesRecoveryRequest,recordRecoveryRequest,inspectRecoveryRequest} from '../scripts/writer-loss-recovery-request.mjs';
test('request binds evidence and never authorizes live recovery',()=>{
 const evidence={incidentDigest:'a'.repeat(64),reviewDigest:'b'.repeat(64),restoreReceiptDigest:'c'.repeat(64),archiveSha256:'d'.repeat(64)};
 const record={schema:1,kind:'recovery-review-request',id:'12345678-1234-1234-1234-123456789abc',requestedAt:'2026-11-27T00:00:00Z',...evidence,operatorAttestationOnly:true,startupAllowed:false,recoveryAllowed:false,accountingVerified:false,continuousExclusionVerified:false};
 assert.equal(matchesRecoveryRequest(record,evidence),true);
 for(const key of Object.keys(evidence))assert.equal(matchesRecoveryRequest({...record,[key]:'e'.repeat(64)},evidence),false);
 for(const key of ['startupAllowed','recoveryAllowed','accountingVerified','continuousExclusionVerified'])assert.equal(matchesRecoveryRequest({...record,[key]:true},evidence),false);
});
test('no request can be created without incident evidence or confirmation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ars-request-'));
 try{
  assert.equal((await inspectRecoveryRequest(root)).state,'request-missing');
  await assert.rejects(recordRecoveryRequest(root,'yes'),/confirmation/);
  await assert.rejects(recordRecoveryRequest(root,'REQUEST RECOVERY REVIEW'),/incident/);
  await writeFile(join(root,'.ars-recovery-request.json'),'{}');
  assert.equal((await inspectRecoveryRequest(root)).state,'request-invalid-or-stale');
 }finally{await rm(root,{recursive:true,force:true});}
});
