import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const row={id:'a1',employee_id:'e1',employee_name:'Sample employee',period_key:'2026-11',journal_id:'j1',base_salary:'50000.01',gross_amount:'50000.01',detailed:false,bound:false,accrued:'50000.01',paid:'20000.02',issues:[]};
const fixture={mapping_count:1,account_code:'SALARY-PAY',ledger_balance:'29999.99',accruals:[row],unattributed:[]};
const mock=r=>({query:async(sql,args)=>{assert.deepEqual(args,['shop-test']);assert.match(sql,/WHERE a\.shop_id=\$1/);assert.match(sql,/WHERE shop_id=\$1/);return {rows:[r]};}});
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
test('salary payable reconciliation exact amounts and exception handling',async t=>{
 const dir=await mkdtemp(join(process.cwd(),'.salary-control-test-'));
 try{
 const output=join(dir,'salary.mjs'),calcOutput=join(dir,'calc.mjs');
 await build({entryPoints:['backend/salaryPayableReconciliation.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'});
 await build({entryPoints:['backend/payrollCalculation.ts'],outfile:calcOutput,bundle:true,platform:'node',format:'esm',packages:'external'});
 const {reconcileSalaryPayable}=await import(pathToFileURL(output).href);
 const {calculatePayroll}=await import(pathToFileURL(calcOutput).href);
 const run=(changes={})=>reconcileSalaryPayable(mock({...fixture,...changes}),'shop-test');
 await t.test('partial payment exact balance and read-only result',async()=>{
 const r=await run();assert.equal(r.checksPassed,true);assert.equal(r.postingEnabled,false);assert.equal(r.difference,'0.00');assert.deepEqual(r.rows[0].amounts,{netSalary:'50000.01',paid:'20000.02',outstanding:'29999.99'});
 });
 await t.test('fully paid record',async()=>{
 const r=await run({accruals:[{...row,paid:'50000.01'}],ledger_balance:'0'});assert.equal(r.checksPassed,true);assert.equal(r.verifiedOutstanding,'0.00');
 });
 await t.test('overpayment and incorrect accrual are excluded',async()=>{
 const r=await run({accruals:[{...row,paid:'50000.02'},{...row,id:'a2',accrued:'50000.00'}]});assert.equal(r.checksPassed,false);assert.equal(r.totalsComplete,false);assert.equal(r.difference,null);assert.equal(r.verifiedOutstanding,'0.00');assert.equal(r.exceptionCount,2);assert.ok(r.rows[0].issues.includes('SALARY_OVERPAYMENT'));assert.ok(r.rows[1].issues.includes('SALARY_ACCRUAL_AMOUNT'));assert.equal(r.rows[0].amounts,null);
 });
 await t.test('signed control differences and missing mapping',async()=>{
 assert.equal((await run({ledger_balance:'29999.98'})).difference,'-0.01');
 assert.equal((await run({mapping_count:0,account_code:null})).controlMatched,false);
 assert.equal((await run({ledger_balance:'-1.00'})).checksPassed,false);
 });
 await t.test('invalid payment evidence and orphan movements fail closed',async()=>{
 const r=await run({accruals:[{...row,issues:['SALARY_PAYMENT_EVIDENCE']}],unattributed:[{id:'x',issue:'ORPHAN_SALARY_MOVEMENT'}]});assert.equal(r.checksPassed,false);assert.equal(r.rows[0].amounts,null);
 assert.equal((await run({unattributed:[{id:'x',issue:'ORPHAN_SALARY_MOVEMENT'}]})).checksPassed,false);
 });
 await t.test('detailed snapshot accepts canonical hash, rejects tampering',async()=>{
 const inputs={baseSalary:'50000.01',earnings:[],deductions:[],contributions:[],policyReference:'Test policy'};
 const results=calculatePayroll(inputs);
 const snapshot_hash=createHash('sha256').update(canonical({version:1,inputs,results})).digest('hex');
 const detailed={...row,detailed:true,bound:true,inputs,results,snapshot_hash,calculation_version:1,net_salary:results.netSalary};
 assert.equal((await run({accruals:[detailed]})).checksPassed,true);
 const r=await run({accruals:[{...detailed,snapshot_hash:'invalid'}]});assert.equal(r.rows[0].amounts,null);assert.ok(r.rows[0].issues.includes('PAYROLL_SNAPSHOT_OR_AMOUNT'));
 });
 await t.test('invalid shop and malformed balance rejected',async()=>{
 await assert.rejects(reconcileSalaryPayable({query:async()=>{throw Error('must not query');}},''),/shop/);
 await assert.rejects(run({ledger_balance:'NaN'}),/Invalid salary control balance/);
 });
 }finally{await rm(dir,{recursive:true,force:true});}
});
