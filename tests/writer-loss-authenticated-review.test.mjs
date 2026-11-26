import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesAuthenticatedReview,recordAuthenticatedReview} from '../scripts/writer-loss-authenticated-review.mjs';
const decision={state:'review-decision-matched',decision:'Review accepted',decisionDigest:'a'.repeat(64)};
const pair={state:'distinct-admin-credentials-verified',credentialsVerified:true,distinctAccountsVerified:true,recoveryAllowed:false,operator:{id:'a',revisionDigest:'b'.repeat(64)},reviewer:{id:'b',revisionDigest:'c'.repeat(64)}};
const record={schema:1,kind:'credential-bound-review',decisionDigest:decision.decisionDigest,operator:pair.operator,reviewer:pair.reviewer,recordedAt:new Date().toISOString(),observationOnly:true,startupAllowed:false,recoveryAllowed:false,accountingVerified:false,independenceVerified:false};
test('credential-bound review rejects changed account revisions and decision',async()=>{
 assert.equal(matchesAuthenticatedReview(record,decision,pair),true);
 assert.equal(matchesAuthenticatedReview(record,decision,{...pair,reviewer:{...pair.reviewer,revisionDigest:'d'.repeat(64)}}),false);
 assert.equal(matchesAuthenticatedReview(record,{...decision,decisionDigest:'e'.repeat(64)},pair),false);
 assert.equal(matchesAuthenticatedReview({...record,recoveryAllowed:true},decision,pair),false);
 await assert.rejects(recordAuthenticatedReview('/unused',{}, {},'yes'),/Explicit/);
});
