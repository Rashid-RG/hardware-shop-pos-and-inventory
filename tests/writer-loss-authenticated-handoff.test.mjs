import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesProtectedObservation,observeAuthenticatedHandoff} from '../scripts/writer-loss-authenticated-handoff.mjs';
const sections=Object.fromEntries(['business','financial','stockPayables','partnerPayroll','partner','imports','payroll','inventory'].map(k=>[k,k==='inventory'?'estimate-review':'selected-checks-match']));
const review={state:'credential-bound-review-matched',reviewDigest:'a'.repeat(64),recoveryAllowed:false};
const evidence={state:'evidence-matched',evidenceDigest:'b'.repeat(64),allSectionsAvailable:true,sections};
const current={consistentAcrossSections:true,allSectionsAvailable:true,recoveryAllowed:false,sections};
test('protected observation requires fresh matching review and all section statuses',async()=>{
 assert.equal(matchesProtectedObservation(review,evidence,current),true);
 assert.equal(matchesProtectedObservation(review,evidence,{...current,sections:{...sections,inventory:'review-required'}}),false);
 assert.equal(matchesProtectedObservation({...review,recoveryAllowed:true},evidence,current),false);
 assert.equal(matchesProtectedObservation(review,evidence,{...current,allSectionsAvailable:false}),false);
 await assert.rejects(observeAuthenticatedHandoff('/unused',{}, {},{},'yes'),/Explicit/);
});
