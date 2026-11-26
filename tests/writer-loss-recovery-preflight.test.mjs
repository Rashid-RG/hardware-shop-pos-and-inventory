import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRecoveryPreflight,inspectRecoveryPreflight} from '../scripts/writer-loss-recovery-preflight.mjs';
const valid={incident:{state:'reconciliation-required'},artifacts:{state:'artifact-integrity-matched'},restore:{state:'restore-receipt-matched'},database:{state:'no-activity-observed',identityMatched:true,otherSessions:0,preparedTransactions:0,applicationLocks:0}};
test('matching observations never authorize recovery',()=>{
 const result=summarizeRecoveryPreflight(valid);
 assert.equal(result.state,'preflight-matched-review-required');
 assert.equal(result.startupAllowed,false);
 assert.equal(result.recoveryAllowed,false);
 assert.equal(result.accountingVerified,false);
 assert.equal(result.continuousExclusionVerified,false);
 assert.equal(result.blockers.length,3);
});
test('any absent or failed observation blocks preflight',()=>{
 for(const key of Object.keys(valid)){
  const result=summarizeRecoveryPreflight({...valid,[key]:null});
  assert.equal(result.state,'preflight-blocked');
  assert.equal(result.startupAllowed,false);
 }
 assert.equal(summarizeRecoveryPreflight({...valid,database:{...valid.database,otherSessions:1}}).state,'preflight-blocked');
});
test('unavailable inspection fails closed',async()=>{
 const result=await inspectRecoveryPreflight('/nonexistent-ars-test-runtime',null,{});
 assert.equal(result.recoveryAllowed,false);
 assert.equal(result.startupAllowed,false);
});
