import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const salary={mapping_count:1,account_code:'SAL-PAY',ledger_balance:'29999.99',accruals:[{id:'p1',employee_id:'e1',employee_name:'Synthetic employee',period_key:'2026-11',journal_id:'j1',base_salary:'50000.01',gross_amount:'50000.01',detailed:false,bound:false,accrued:'50000.01',paid:'20000.02',issues:[]}],unattributed:[]};
const advances={mapping_count:1,ledger_balance:'12500.00',subledger_balance:'12500.00',advances:[{id:'a1',employeeName:'Synthetic employee',journalId:'j2',issued:'25000.00',recovered:'12500.00',issues:[]}],recoveries:[],unattributed:[]};
const statutory={controls:[{fund:'EPF',accountCode:'EPF-PAY',ledgerBalance:'3000.00',subledgerBalance:'3000.00',difference:'0.00',exceptionCount:0,controlMatched:true},{fund:'ETF',accountCode:'ETF-PAY',ledgerBalance:'600.00',subledgerBalance:'600.00',difference:'0.00',exceptionCount:0,controlMatched:true}],exceptions:[],unattributed:[]};
function fixture(overrides={}){
 const calls=[];let released=0,connected=0,index=0;
 const values=[overrides.salary??salary,overrides.advances??advances,overrides.statutory??statutory];
 const client={query:async(sql,args)=>{
 calls.push(sql);
 if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
 assert.deepEqual(args,['shop-test']);
 const expected=['salaryPayable','employeeAdvances','epfPayable'][index];
 assert.ok(sql.includes(expected),'Unexpected control query');
 const value=values[index++];if(value instanceof Error)throw value;
 return {rows:[value]};
 },release:()=>{released++;}};
 return {db:{connect:async()=>{connected++;return client;},query:async()=>{throw Error('Must use the same transaction client');}},calls,released:()=>released,connected:()=>connected};
}
test('combined payroll controls use a single read-only snapshot',async t=>{
 const dir=await mkdtemp(join(process.cwd(),'.payroll-overview-test-'));
 try{
 const output=join(dir,'overview.mjs');
 await build({entryPoints:['backend/payrollAccountingOverview.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'});
 const {payrollAccountingOverview}=await import(pathToFileURL(output).href);
 const run=f=>payrollAccountingOverview(f.db,'shop-test');
 await t.test('four matched controls preserve classification and exact balances',async()=>{
 const f=fixture(),r=await run(f);
 assert.equal(r.checksPassed,true);assert.equal(r.postingEnabled,false);
 assert.deepEqual(r.controls.map(x=>x.id),['salary','advances','epf','etf']);
 assert.deepEqual(r.controls.map(x=>x.classification),['Liability','Asset','Liability','Liability']);
 assert.equal(r.controls[0].recordedBalance,'29999.99');assert.equal(r.controls[1].recordedBalance,'12500.00');
 assert.equal(f.connected(),1);assert.equal(f.released(),1);assert.equal(f.calls.length,5);
 assert.equal(f.calls[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(f.calls.at(-1),'COMMIT');
 assert.ok(!JSON.stringify(r).includes('Synthetic employee'),'Overview must not expose employee-level data');
 });
 await t.test('salary exceptions withhold incomplete balance',async()=>{
 const r=await run(fixture({salary:{...salary,accruals:[{...salary.accruals[0],paid:'50000.02'}]}}));
 assert.equal(r.checksPassed,false);assert.equal(r.controls[0].recordedBalance,null);assert.equal(r.controls[0].difference,null);assert.equal(r.controls[0].exceptionCount,1);
 });
 await t.test('advance control mismatch blocks overall result',async()=>{
 const r=await run(fixture({advances:{...advances,ledger_balance:'12500.01'}}));assert.equal(r.checksPassed,false);assert.equal(r.controls[1].matched,false);
 });
 await t.test('shared statutory unmatched records prevent both fund checks',async()=>{
 const r=await run(fixture({statutory:{...statutory,unattributed:[{id:'orphan',issue:'ORPHAN_STATUTORY_MOVEMENT'}]}}));
 assert.equal(r.checksPassed,false);assert.equal(r.statutoryUnmatchedCount,1);assert.equal(r.controls[2].checksPassed,false);assert.equal(r.controls[3].checksPassed,false);assert.equal(r.controls[2].unmatchedCount,null);
 });
 await t.test('missing or duplicated fund rolls back',async()=>{
 for(const controls of [[statutory.controls[0]],[statutory.controls[0],statutory.controls[0]]]){
 const f=fixture({statutory:{...statutory,controls}});await assert.rejects(run(f),/Incomplete payroll controls/);assert.equal(f.calls.at(-1),'ROLLBACK');assert.equal(f.released(),1);
 }
 });
 await t.test('database failure rolls back and releases',async()=>{
 const f=fixture({advances:new Error('database unavailable')});await assert.rejects(run(f),/database unavailable/);assert.equal(f.calls.at(-1),'ROLLBACK');assert.equal(f.released(),1);
 });
 await t.test('invalid shop rejected before connection',async()=>{
 await assert.rejects(payrollAccountingOverview({connect:async()=>{throw Error('must not connect');}},''),/shop/);
 });
 }finally{await rm(dir,{recursive:true,force:true});}
});
