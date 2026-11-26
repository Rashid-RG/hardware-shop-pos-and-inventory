import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeControlComparison,inspectRecoveryFinancialControls,controlComparisonSql} from '../scripts/writer-loss-financial-reconciliation.mjs';
test('selected controls never certify accounting, including empty coverage',()=>{
 assert.equal(summarizeControlComparison([]).state,'no-coverage');
 assert.equal(summarizeControlComparison([{status:'matched'}]).state,'selected-controls-matched');
 const r=summarizeControlComparison(['matched','mismatch','unmapped','mapping-review','posting-disabled'].map(status=>({status})));
 assert.equal(r.state,'control-review-required');
 assert.equal(r.counts.mismatch,1);
 assert.equal(r.accountingVerified,false);
 assert.equal(r.recoveryAllowed,false);
 assert.throws(()=>summarizeControlComparison([{status:'unknown'}]));
});
test('read-only identity-bound control inspection',async()=>{
 const expected={database:'hardware_pos_ci',systemIdentifier:'123',databaseOid:'456'};
 for(const mismatch of [false,true]){
  const calls=[];
  const client={query:async sql=>{calls.push(sql);if(sql.includes('pg_control_system()'))return {rows:[{database:expected.database,system_identifier:mismatch?'999':'123',database_oid:'456',read_only:true,snapshot:true}]};if(sql===controlComparisonSql)return {rows:[{status:'matched'}]};return {rows:[]};}};
  const r=await inspectRecoveryFinancialControls(client,expected);
  assert.equal(r.state,mismatch?'control-inspection-unavailable':'selected-controls-matched');
  assert.equal(calls.at(-1),'ROLLBACK');
  assert.equal(r.startupAllowed,false);
 }
});
