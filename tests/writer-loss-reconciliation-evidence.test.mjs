import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeEvidence,matchesReconciliationEvidence,recordReconciliationEvidence} from '../scripts/writer-loss-reconciliation-evidence.mjs';
const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,continuousExclusionVerified:false};
const sections=Object.fromEntries(['business','financial','stockPayables','partnerPayroll','partner','imports','payroll','inventory'].map(k=>[k,'selected-checks-match']));
test('retained evidence never grants recovery and stale request is rejected',()=>{
 const b={incidentDigest:'a'.repeat(64),requestDigest:'b'.repeat(64)};
 const r={schema:1,kind:'reconciliation-snapshot-evidence',recordedAt:new Date().toISOString(),...b,sections,allSectionsAvailable:true,consistentAcrossSections:true,observationOnly:true,...blocked};
 assert.equal(matchesReconciliationEvidence(r,b),true);
 assert.equal(matchesReconciliationEvidence(r,{...b,requestDigest:'c'.repeat(64)}),false);
 assert.equal(matchesReconciliationEvidence({...r,recoveryAllowed:true},b),false);
});
test('partial results remain explicit and inconsistent snapshots are rejected',async()=>{
 const r={...blocked,checks:{databaseIdentityMatched:true},reconciliation:{...blocked,consistentAcrossSections:true,sections:{...sections,inventory:'unavailable'}}};
 assert.equal(summarizeEvidence(r).allSectionsAvailable,false);
 assert.throws(()=>summarizeEvidence({...r,reconciliation:{...r.reconciliation,consistentAcrossSections:false}}));
 await assert.rejects(recordReconciliationEvidence('/not-used',{},'yes'),/Explicit/);
});
