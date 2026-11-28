import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePartnerPayroll,inspectRecoveryPartnerPayroll,partnerPayrollSql} from '../scripts/writer-loss-partner-payroll.mjs';
const zero={invalid_capital:'0',capital_without_journal:'0',profit_allocation_exceptions:'0',salary_payment_exceptions:'0',advance_recovery_exceptions:'0',statutory_settlement_exceptions:'0'};
test('partner payroll checks never authorize recovery',()=>{
 assert.equal(summarizePartnerPayroll(zero).state,'selected-links-matched');
 const r=summarizePartnerPayroll({...zero,capital_without_journal:'1'});
 assert.equal(r.state,'partner-payroll-review-required');
 assert.equal(r.accountingVerified,false);assert.equal(r.recoveryAllowed,false);
 assert.throws(()=>summarizePartnerPayroll({...zero,invalid_capital:null}));
});
test('identity mismatch prevents inspection',async()=>{
 const calls=[];
 const c={query:async sql=>{calls.push(sql);if(sql.includes('pg_control_system()'))return {rows:[{database:'hardware_pos_ci',system_identifier:'9',database_oid:'2',read_only:true,snapshot:true}]};return {rows:[]};}};
 assert.equal((await inspectRecoveryPartnerPayroll(c,{database:'hardware_pos_ci',systemIdentifier:'1',databaseOid:'2'})).state,'partner-payroll-inspection-unavailable');
 assert.ok(!calls.includes(partnerPayrollSql));assert.equal(calls.at(-1),'ROLLBACK');
});
