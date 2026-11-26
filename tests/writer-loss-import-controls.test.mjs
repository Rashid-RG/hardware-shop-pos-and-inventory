import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeImportControls} from '../scripts/writer-loss-import-controls.mjs';
test('import balances cannot authorize recovery',()=>{
 const row={status:'selected-balances-match',obligation_issues:'0',allocation_issues:'0',settlement_issues:'0'};
 assert.equal(summarizeImportControls([row]).state,'selected-import-balances-matched');
 const r=summarizeImportControls([row,{...row,status:'evidence-review',settlement_issues:'1'}]);
 assert.equal(r.state,'import-control-review-required');assert.equal(r.recoveryAllowed,false);
 assert.equal(summarizeImportControls([]).state,'no-coverage');
 assert.throws(()=>summarizeImportControls([{...row,allocation_issues:null}]));
});
