import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesReviewDecision,recordReviewDecision} from '../scripts/writer-loss-review-decision.mjs';
const sections=Object.fromEntries(['business','financial','stockPayables','partnerPayroll','partner','imports','payroll','inventory'].map(k=>[k,'selected-checks-match']));
const e={state:'evidence-matched',evidenceDigest:'a'.repeat(64),allSectionsAvailable:true,sections};
const r={schema:1,kind:'recovery-review-decision',evidenceDigest:e.evidenceDigest,reviewer:'Reviewer',reference:'Review document 1',decision:'Review accepted',recordedAt:new Date().toISOString(),attestationOnly:true,startupAllowed:false,recoveryAllowed:false,accountingVerified:false,continuousExclusionVerified:false,reviewerIdentityVerified:false,independenceVerified:false};
test('review acceptance remains an attestation and rejects stale evidence',()=>{
 assert.equal(matchesReviewDecision(r,e),true);
 assert.equal(matchesReviewDecision(r,{...e,evidenceDigest:'b'.repeat(64)}),false);
 assert.equal(matchesReviewDecision({...r,recoveryAllowed:true},e),false);
 assert.equal(matchesReviewDecision({...r,independenceVerified:true},e),false);
});
test('unavailable or unresolved sections block acceptance but allow investigation record',async()=>{
 const bad={...e,allSectionsAvailable:false,sections:{...sections,payroll:'unavailable'}};
 assert.equal(matchesReviewDecision(r,bad),false);
 assert.equal(matchesReviewDecision({...r,decision:'Further investigation required'},bad),true);
 assert.equal(matchesReviewDecision(r,{...e,sections:{...sections,partner:'review-required'}}),false);
 await assert.rejects(recordReviewDecision('/not-used',{},'yes'),/Explicit/);
});
