import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
test('posted payslip renders PDF and rejects unreconciled payroll',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.payslip-test-'));
 try{
  const output=join(dir,'payslip.mjs');
  await build({entryPoints:['backend/payslip.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external'});
  const {readPostedPayslip,renderPostedPayslip}=await import(pathToFileURL(output).href);
  const row={id:'accrual-1',employee_id:'staff-1',employee_name:'Sample Employee',period_key:'2026-11',day:'2026-11-25',base_salary:'50000.00',gross_amount:'50000.00',journal_id:'journal-1',inputs:null,statutory_bound:false,paid:'20000.00',requires_review:false};
  const db={query:async(sql,args)=>{assert.deepEqual(args,['shop-test','accrual-1']);return {rows:[row]};}};
  const slip=await readPostedPayslip(db,'shop-test','accrual-1');
  assert.equal(slip.outstanding,'30000.00');
  assert.equal(slip.calculated.netSalary,'50000.00');
  const pdf=await renderPostedPayslip(slip,'ARS Distributor');
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.ok(pdf.length>1000);
  assert.match(pdf.toString('latin1'),/%%EOF/);
  row.requires_review=true;
  await assert.rejects(readPostedPayslip(db,'shop-test','accrual-1'),/reconciliation/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
