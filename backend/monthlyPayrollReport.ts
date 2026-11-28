import type {Pool} from 'pg';
import {calculatePayroll} from './payrollCalculation';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {createHash} from 'node:crypto';

const canonical=(v:unknown):string=>{
 if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&typeof v==='object'){const o=v as Record<string,unknown>;return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';}
 throw Error('Invalid snapshot.');
};
const metrics=['baseSalary','overtime','bonus','allowances','grossSalary','advanceRecovery','otherDeductions','employeeEpf','employerEpf','employerEtf','totalDeductions','netSalary','employerCost','paid','outstanding'] as const;
type Metric=typeof metrics[number];
type Amounts=Record<Metric,string>;
/** Payroll month cohort, not cash movements during the calendar month. One consistent SQL snapshot. */
export async function monthlyPayrollReport(db:Pool,shopId:string,period:string){
 if(typeof shopId!=='string'||!shopId.trim()||shopId.length>200||typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Valid payroll month required.');
 const result=await db.query(`SELECT a.id,a.employee_id,a.employee_name,a.posting_date::text AS day,a.base_salary::text,a.gross_amount::text,a.journal_id,
 d.inputs,d.results,d.snapshot_hash,d.calculation_version,d.gross_salary::text,d.net_salary::text,d.total_deductions::text,d.employer_contributions::text,d.employer_cost::text,
 s.proposal_id IS NOT NULL AS statutory_bound,COALESCE(p.paid,0)::text AS paid,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=a.shop_id AND j.source_kind='Reversal' AND (j.source_id=a.journal_id OR EXISTS(SELECT 1 FROM ars_gl_salary_payments v WHERE v.shop_id=a.shop_id AND v.accrual_id=a.id AND v.journal_id=j.source_id))) OR COALESCE(p.unmatched,FALSE) AS requires_review,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=a.shop_id AND j.id=a.journal_id AND j.source_kind='PayrollAccrual' AND j.source_id=a.id AND j.posting_date=a.posting_date) AS has_journal
 FROM ars_gl_payroll_accruals a LEFT JOIN ars_gl_payroll_details d ON d.shop_id=a.shop_id AND d.proposal_id=a.id
 LEFT JOIN ars_gl_payroll_statutory_snapshots s ON s.shop_id=a.shop_id AND s.proposal_id=a.id
 LEFT JOIN LATERAL(SELECT SUM(v.amount) AS paid,BOOL_OR(NOT EXISTS(SELECT 1 FROM ars_financial_movements m WHERE m.shop_id=v.shop_id AND m.id=v.journal_id AND m.source_id=v.id AND m.account_id=v.financial_account_id AND m.amount=-v.amount AND m.movement_kind='Salary Payment' AND m.effective_date=v.posting_date AND m.recorded_by=v.recorded_by)) AS unmatched FROM ars_gl_salary_payments v WHERE v.shop_id=a.shop_id AND v.accrual_id=a.id) p ON TRUE
 WHERE a.shop_id=$1 AND a.period_key=$2 ORDER BY a.employee_name,a.id LIMIT 2501`,[shopId,period]);
 if(result.rows.length>2500)throw Error('Payroll month exceeds report capacity.');
 const totals=Object.fromEntries(metrics.map(k=>[k,0n])) as Record<Metric,bigint>;
 const rows=result.rows.map(r=>{
  const identity={id:String(r.id),employeeId:String(r.employee_id),employeeName:String(r.employee_name),postingDate:String(r.day),journalId:String(r.journal_id),statutoryBound:!!r.statutory_bound};
  try{
   if(r.requires_review||!r.has_journal)throw Error('Journal or payment requires review.');
   const input=r.inputs||{baseSalary:r.base_salary,earnings:[],deductions:[],contributions:[],policyReference:'Base salary only'};
   const calc=calculatePayroll(input);
   if(r.inputs){
    const hash=createHash('sha256').update(canonical({version:1,inputs:input,results:calc})).digest('hex');
    if(!r.statutory_bound||r.calculation_version!==1||hash!==r.snapshot_hash||canonical(calc)!==canonical(r.results)||[['grossSalary','gross_salary'],['netSalary','net_salary'],['totalDeductions','total_deductions'],['employerContributions','employer_contributions'],['employerCost','employer_cost']].some(([k,col])=>moneyCents(String(calc[k as keyof typeof calc]))!==moneyCents(r[col])))throw Error('Payroll snapshot requires review.');
   }else if(r.statutory_bound||r.snapshot_hash)throw Error('Missing payroll detail.');
   if(moneyCents(calc.baseSalary)!==moneyCents(r.base_salary)||moneyCents(calc.grossSalary)!==moneyCents(r.gross_amount))throw Error('Accrual amounts require review.');
   const sum=(items:{kind:string;amount:string}[],k:string)=>decimal(items.filter(x=>x.kind===k).reduce((n,x)=>n+moneyCents(x.amount),0n));
   const contribution=(id:string)=>decimal(calc.contributions.filter(x=>x.id===id).reduce((n,x)=>n+moneyCents(x.amount),0n));
   const paid=moneyCents(r.paid),net=moneyCents(calc.netSalary);
   if(paid>net)throw Error('Salary payment exceeds liability.');
   const amounts:Amounts={baseSalary:calc.baseSalary,overtime:sum(input.earnings,'Overtime'),bonus:sum(input.earnings,'Bonus'),allowances:sum(input.earnings,'Allowance'),grossSalary:calc.grossSalary,advanceRecovery:sum(input.deductions,'AdvanceRecovery'),otherDeductions:decimal(moneyCents(calc.ordinaryDeductions)-moneyCents(sum(input.deductions,'AdvanceRecovery'))),employeeEpf:contribution('statutory-employee-epf'),employerEpf:contribution('statutory-employer-epf'),employerEtf:contribution('statutory-employer-etf'),totalDeductions:calc.totalDeductions,netSalary:calc.netSalary,employerCost:calc.employerCost,paid:decimal(paid),outstanding:decimal(net-paid)};
   for(const k of metrics)totals[k]+=moneyCents(amounts[k]);
   return {...identity,amounts,issue:null};
  }catch(e){return {...identity,amounts:null,issue:e instanceof Error?e.message:'Payroll requires review.'};}
 });
 const exceptions=rows.filter(r=>r.issue!==null).length;
 return {period,scope:'Posted payroll cohort; recorded payments to date',rows,recordCount:rows.length,exceptionCount:exceptions,baseSalaryOnlyCount:rows.filter(r=>!r.statutoryBound).length,verifiedTotals:Object.fromEntries(metrics.map(k=>[k,decimal(totals[k])])) as Amounts,totalsComplete:exceptions===0,postingEnabled:false as const};
}
