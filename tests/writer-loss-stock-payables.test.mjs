import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeStockPayables,inspectRecoveryStockPayables,stockPayablesSql} from '../scripts/writer-loss-stock-payables.mjs';
test('matching estimates still require independent review',()=>{
 const r=summarizeStockPayables([{kind:'inventory',status:'estimate-matches',exceptions:'0'},{kind:'supplierPayables',status:'incomplete-estimate',exceptions:'1'}]);
 assert.equal(r.state,'estimates-review-required');
 assert.equal(r.counts['estimate-matches'],1);
 assert.equal(r.recoveryAllowed,false);
 assert.equal(r.accountingVerified,false);
 assert.equal(summarizeStockPayables([]).state,'no-coverage');
 assert.throws(()=>summarizeStockPayables([{kind:'inventory',status:'matched',exceptions:'0'}]));
});
test('inspection uses trusted read-only snapshot and rolls back',async()=>{
 const expected={database:'hardware_pos_ci',systemIdentifier:'123',databaseOid:'456'};
 for(const invalid of [false,true]){
 const calls=[];
 const c={query:async sql=>{calls.push(sql);if(sql.includes('pg_control_system()'))return {rows:[{database:expected.database,system_identifier:invalid?'999':'123',database_oid:'456',read_only:true,snapshot:true}]};if(sql===stockPayablesSql)return {rows:[{kind:'inventory',status:'estimate-matches',exceptions:'0'}]};return {rows:[]};}};
 const r=await inspectRecoveryStockPayables(c,expected);
 assert.equal(r.state,invalid?'estimate-inspection-unavailable':'estimates-review-required');
 assert.equal(calls.at(-1),'ROLLBACK');
 assert.equal(r.recoveryAllowed,false);
 }
});
