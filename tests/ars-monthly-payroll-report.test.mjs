import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';

const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const base=(i=1)=>({id:'accrual-'+i,employee_id:'employee-'+i,employee_name:'Sample Employee '+i,day:'2026-11-25',base_salary:'50000.01',gross_amount:'50000.01',journal_id:'journal-'+i,inputs:null,statutory_bound:false,paid:'20000.02',requires_review:false,has_journal:true});
const mock=rows=>({query:async(sql,args)=>{assert.deepEqual(args,['shop-test','2026-11']);assert.match(sql,/WHERE a\.shop_id=\$1 AND a\.period_key=\$2/);return {rows};}});
function pageTexts(pdf){
 return Array.from(pdf.toString('latin1').matchAll(/\bstream\r?\n([\s\S]*?)\r?\nendstream/g),m=>{
  let s;try{s=inflateSync(Buffer.from(m[1],'latin1')).toString('latin1');}catch{return null;}
  if(!/\bBT\b/.test(s)||!/\bTJ\b/.test(s))return null;
  return Array.from(s.matchAll(/\[([^\]]*)\]\s*TJ/g),row=>Array.from(row[1].matchAll(/<([\da-f]+)>/gi),x=>Buffer.from(x[1],'hex').toString('latin1')).join('')).join(' ');
 }).filter(v=>v!==null);
}
test('monthly payroll report and branded PDF preserve exact amounts and exclude exceptions',async t=>{
 const dir=await mkdtemp(join(process.cwd(),'.monthly-payroll-test-'));
 try{
 await build({entryPoints:['backend/monthlyPayrollReport.ts','backend/monthlyPayrollPdf.ts','backend/payrollCalculation.ts'],outdir:dir,outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',packages:'external'});
 const {monthlyPayrollReport}=await import(pathToFileURL(join(dir,'monthlyPayrollReport.mjs')).href);
 const {renderMonthlyPayrollPdf}=await import(pathToFileURL(join(dir,'monthlyPayrollPdf.mjs')).href);
 const {calculatePayroll}=await import(pathToFileURL(join(dir,'payrollCalculation.mjs')).href);
 await t.test('base salary balances and exception coverage',async()=>{
  const rows=[base(),{...base(2),requires_review:true},{...base(3),paid:'50000.02'},{...base(4),has_journal:false}];
  const r=await monthlyPayrollReport(mock(rows),'shop-test','2026-11');
  assert.equal(r.recordCount,4);assert.equal(r.exceptionCount,3);assert.equal(r.totalsComplete,false);assert.equal(r.postingEnabled,false);
  assert.equal(r.verifiedTotals.netSalary,'50000.01');assert.equal(r.verifiedTotals.paid,'20000.02');assert.equal(r.verifiedTotals.outstanding,'29999.99');
  assert.ok(r.rows.slice(1).every(x=>x.amounts===null&&x.issue));
  await assert.rejects(monthlyPayrollReport(mock([]),'shop-test','2026-13'),/month/);
 });
 await t.test('detailed statutory snapshot and tampering',async()=>{
  const inputs={baseSalary:'50000.00',earnings:[{id:'ot',kind:'Overtime',amount:'10000.00',evidence:'Approved OT'}],deductions:[{id:'adv',kind:'AdvanceRecovery',amount:'5000.00',evidence:'Advance'}],contributions:[{id:'statutory-employee-epf',party:'Employee',basis:'60000.00',rateBasisPoints:800,evidence:'Policy'},{id:'statutory-employer-epf',party:'Employer',basis:'60000.00',rateBasisPoints:1200,evidence:'Policy'},{id:'statutory-employer-etf',party:'Employer',basis:'60000.00',rateBasisPoints:300,evidence:'Policy'}],policyReference:'statutory-policy:test'};
  const results=calculatePayroll(inputs),snapshot_hash=createHash('sha256').update(canonical({version:1,inputs,results})).digest('hex');
  const detail={...base(),base_salary:'50000.00',gross_amount:'60000.00',statutory_bound:true,inputs,results,snapshot_hash,calculation_version:1,gross_salary:results.grossSalary,net_salary:results.netSalary,total_deductions:results.totalDeductions,employer_contributions:results.employerContributions,employer_cost:results.employerCost,paid:'10000.00'};
  const r=await monthlyPayrollReport(mock([detail,{...detail,id:'tampered',snapshot_hash:'invalid'}]),'shop-test','2026-11');
  assert.equal(r.exceptionCount,1);assert.equal(r.verifiedTotals.employeeEpf,'4800.00');assert.equal(r.verifiedTotals.employerEpf,'7200.00');assert.equal(r.verifiedTotals.employerEtf,'1800.00');assert.equal(r.verifiedTotals.netSalary,'50200.00');assert.equal(r.verifiedTotals.employerCost,'69000.00');assert.equal(r.verifiedTotals.outstanding,'40200.00');
 });
 await t.test('A4 multipage footer, exceptions and every employee',async()=>{
  const rows=Array.from({length:9},(_,i)=>base(i+1));rows[8].requires_review=true;
  const r=await monthlyPayrollReport(mock(rows),'shop-test','2026-11');
  const pdf=await renderMonthlyPayrollPdf(r,{name:'ARS Distributor',address:'Galgamuwa',phone:'0770000000'});
  const source=pdf.toString('latin1'),pages=pageTexts(pdf);
  assert.equal(source.slice(0,5),'%PDF-');assert.match(source,/%%EOF/);assert.match(source,/\/Subtype \/Image/);
  assert.equal((source.match(/\/Type \/Page\b/g)||[]).length,pages.length);assert.ok(pages.length>1);
  pages.forEach((p,i)=>{assert.ok(p.includes('Page '+(i+1)+' of '+pages.length));assert.match(p,/Powered by RS Nextward/);assert.match(p,/PARTIAL TOTALS/);assert.doesNotMatch(p,/Smart systems for business/);});
  for(let i=1;i<=9;i++)assert.match(pages.join(' '),new RegExp('Sample Employee '+i+'\\b'));
  assert.match(pages.join(' '),/REVIEW REQUIRED/);
 });
 }finally{await rm(dir,{recursive:true,force:true});}
});
