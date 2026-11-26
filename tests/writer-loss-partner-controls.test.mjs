import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePartnerControls} from '../scripts/writer-loss-partner-controls.mjs';
test('partner capital and drawings remain separate and cannot authorize recovery',()=>{
 const r=summarizePartnerControls([{kind:'partnerCapital',status:'selected-balance-matches'},{kind:'partnerDrawings',status:'balance-difference'}]);
 assert.equal(r.state,'partner-control-review-required');
 assert.equal(r.counts['balance-difference'],1);
 assert.equal(r.recoveryAllowed,false);
 assert.equal(r.accountingVerified,false);
 assert.equal(summarizePartnerControls([]).state,'no-coverage');
 assert.throws(()=>summarizePartnerControls([{kind:'other',status:'selected-balance-matches'}]));
});
