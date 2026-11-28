import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const mappings=[['salary','control','EXP','Expense'],['salaryPayable','control','PAY','Liability'],['financialAccount','bank-1','BANK','Asset']].map(([mapping_kind,source_id,account_code,kind])=>({mapping_kind,source_id,account_code,kind}));
const payroll={id:'p1',employee_id:'e1',employee_name:'Test employee',day:'2026-11-25',base_salary:'50000.01',gross_amount:'50000.01',journal_id:'j1',inputs:null,statutory_bound:false,paid:'20000.02',requires_review:false,has_journal:true};
const accrual={...payroll,journal_identity:true,lines:[{code:'EXP',debit:'50000.01',credit:'0.00'},{code:'PAY',debit:'0.00',credit:'50000.01'}],recoveries:[]};
const payment={id:'payment1',accrual_id:'p1',journal_id:'j2',financial_account_id:'bank-1',employee_name:'Test employee',amount:'20000.02',journal_identity:true,account_valid:true,reversed:false,movement_count:1,match_count:1,lines:[{code:'PAY',debit:'20000.02',credit:'0.00'},{code:'BANK',debit:'0.00',credit:'20000.02'}]};
function fixture(overrides={}){
 const calls=[];let released=0;
 const answers=[[payroll],[accrual],mappings,[payment],[],[{settlements:[],unattributed:[]}]];
 for(const [k,v] of Object.entries(overrides))answers[Number(k)]=v;
 let i=0;
 const client={query:async(sql,params)=>{
 calls.push(sql);if(/^BEGIN|^COMMIT|^ROLLBACK/.test(sql))return {rows:[]};
 assert.equal(params[0],'shop-test');if(params.length===2)assert.equal(params[1],'2026-11');
 const rows=answers[i++];if(rows instanceof Error)throw rows;
 assert.ok(Array.isArray(rows),'Unexpected query: '+sql);return {rows};
 },release:()=>{released++;}};
 return {db:{connect:async()=>client},calls,released:()=>released};
}
test('payroll reconciliation checks accounting evidence and stays read-only',async t=>{
 const dir=await mkdtemp(join(process.cwd(),'.payroll-reconciliation-test-'));
 try{
 const output=join(dir,'reconciliation.mjs');
 await build({entryPoints:['backend/payrollReconciliation.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'});
 const {reconcilePayroll}=await import(pathToFileURL(output).href);
 const run=f=>reconcilePayroll(f.db,'shop-test','2026-11');
 await t.test('matching journals and salary movement',async()=>{
 const f=fixture(),r=await run(f);
 assert.equal(r.checksPassed,true);assert.equal(r.postingEnabled,false);assert.deepEqual(r.accruals[0].issues,[]);assert.deepEqual(r.salaryPayments[0].issues,[]);
 assert.equal(f.calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(f.calls.at(-1),'COMMIT');assert.equal(f.released(),1);
 });
 await t.test('wrong amount and extra accrual line',async()=>{
 const f=fixture({1:[{...accrual,lines:[...accrual.lines,{code:'OTHER',debit:'0.01',credit:'0.00'}]}]});
 const r=await run(f);assert.equal(r.checksPassed,false);assert.ok(r.accruals[0].issues.includes('ACCRUAL_JOURNAL_LINES_OR_MAPPING'));
 });
 await t.test('duplicate salary movement and reversal',async()=>{
 const r=await run(fixture({3:[{...payment,movement_count:2,reversed:true}]}));
 assert.equal(r.checksPassed,false);assert.ok(r.salaryPayments[0].issues.includes('PAYMENT_MOVEMENT'));assert.ok(r.salaryPayments[0].issues.includes('REVERSAL'));
 });
 await t.test('unplanned payroll recovery',async()=>{
 const r=await run(fixture({1:[{...accrual,recoveries:[{id:'unexpected',disbursementId:'advance-1',amount:'100.00',valid:true}]}]}));
 assert.equal(r.checksPassed,false);assert.ok(r.accruals[0].issues.includes('ADVANCE_RECOVERY_RECORDS'));
 });
 await t.test('orphan records and statutory exceptions block passing result',async()=>{
 const r=await run(fixture({4:[{id:'orphan',issue:'ORPHAN_SALARY_MOVEMENT'}],5:[{settlements:[{id:'s1',issues:['BANK_MOVEMENT']}],unattributed:[]}]}));
 assert.equal(r.checksPassed,false);assert.equal(r.statutory.settlementChecksPassed,false);assert.equal(r.unattributed.length,1);
 });
 await t.test('query failure rolls back and releases connection',async()=>{
 const f=fixture({2:new Error('database unavailable')});await assert.rejects(run(f),/database unavailable/);assert.equal(f.calls.at(-1),'ROLLBACK');assert.equal(f.released(),1);
 });
 await t.test('invalid month rejected before connecting',async()=>{
 await assert.rejects(reconcilePayroll({connect:async()=>{throw Error('must not connect');}},'shop-test','2026-13'),/month/);
 });
 }finally{await rm(dir,{recursive:true,force:true});}
});
