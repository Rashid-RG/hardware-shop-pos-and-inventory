import type {Pool} from 'pg';
import {planDetailedPayrollJournal} from './payrollJournalPlan';
import {moneyCents} from './generalLedger';
import {monthlyPayrollReport} from './monthlyPayrollReport';
import {reconcileStatutoryContributions} from './statutoryReconciliation';

/** Read-only, consistent snapshot of posted payroll, mapped ledger lines and settlements. */
export async function reconcilePayroll(db:Pool,shopId:string,period:string){
 if(typeof shopId!=='string'||!shopId.trim()||shopId.length>200||typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Valid payroll month required.');
 const c=await db.connect();
 try{
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const report=await monthlyPayrollReport(c as unknown as Pool,shopId,period);
 const data=(await c.query(`SELECT a.id,a.employee_id,a.employee_name,a.recorded_by,a.posting_date::text AS day,a.journal_id,a.base_salary::text,d.inputs,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('code',l.account_code,'debit',l.debit::text,'credit',l.credit::text)) FROM ars_gl_lines l WHERE l.shop_id=a.shop_id AND l.journal_id=a.journal_id),'[]'::jsonb) AS lines,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=a.shop_id AND j.id=a.journal_id AND j.source_kind='PayrollAccrual' AND j.source_id=a.id AND j.posting_date=a.posting_date AND j.recorded_by=a.recorded_by) AS journal_identity,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'disbursementId',r.disbursement_id,'amount',r.amount::text,'valid',r.employee_id=a.employee_id AND r.recovery_kind='PayrollRecovery' AND r.journal_id=a.journal_id AND r.posting_date=a.posting_date AND r.recorded_by=a.recorded_by AND EXISTS(SELECT 1 FROM ars_gl_employee_advance_disbursements v WHERE v.shop_id=r.shop_id AND v.id=r.disbursement_id AND v.employee_id=a.employee_id AND v.posting_date<=a.posting_date AND NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=v.shop_id AND j.source_kind='Reversal' AND j.source_id=v.journal_id)))) FROM ars_gl_employee_advance_recoveries r WHERE r.shop_id=a.shop_id AND r.payroll_proposal_id=a.id),'[]'::jsonb) AS recoveries
 FROM ars_gl_payroll_accruals a LEFT JOIN ars_gl_payroll_details d ON d.shop_id=a.shop_id AND d.proposal_id=a.id WHERE a.shop_id=$1 AND a.period_key=$2 ORDER BY a.id`,[shopId,period])).rows;
 const mappings=(await c.query(`SELECT m.mapping_kind,m.source_id,m.account_code,a.kind FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1`,[shopId])).rows;
 const code=(kind:string,source:string,classification:string)=>mappings.find(m=>m.mapping_kind===kind&&m.source_id===source&&m.kind===classification)?.account_code;
 const match=(actual:{code:string;debit:string;credit:string}[],expected:{code:string;debit:string;credit:string}[])=>actual.length===expected.length&&new Set(expected.map(l=>l.code)).size===expected.length&&expected.every(e=>!!e.code&&actual.filter(a=>a.code===e.code&&moneyCents(a.debit)===moneyCents(e.debit)&&moneyCents(a.credit)===moneyCents(e.credit)).length===1);
 const rows=data.map(a=>{
 const issues:string[]=[];
 const r=report.rows.find(r=>r.id===a.id);
 if(!r||r.issue)issues.push('PAYROLL_SNAPSHOT_OR_BALANCE');
 if(!a.journal_identity)issues.push('ACCRUAL_JOURNAL_IDENTITY');
 try{
 const plan=a.inputs?planDetailedPayrollJournal(a.inputs):{lines:[{control:'salary',debit:a.base_salary,credit:'0.00'},{control:'salaryPayable',debit:'0.00',credit:a.base_salary}],recoveries:[]};
 const expected=plan.lines.map(l=>({code:code(l.control,'control',l.control==='salary'||l.control==='employerContributions'?'Expense':l.control==='employeeAdvances'?'Asset':'Liability'),debit:l.debit,credit:l.credit}));
 if(!match(a.lines,expected))issues.push('ACCRUAL_JOURNAL_LINES_OR_MAPPING');
 if(a.recoveries.length!==plan.recoveries.length||plan.recoveries.some(r=>a.recoveries.filter((v:{valid:boolean;disbursementId:string;amount:string})=>v.valid&&v.disbursementId===r.disbursementId&&moneyCents(v.amount)===moneyCents(r.amount)).length!==1))issues.push('ADVANCE_RECOVERY_RECORDS');
 }catch{issues.push('ACCRUAL_PLAN_INVALID');}
 return {id:a.id,employeeName:a.employee_name,journalId:a.journal_id,issues};
 });
 const payments=(await c.query(`SELECT p.id,p.accrual_id,p.journal_id,p.financial_account_id,p.amount::text,a.employee_name,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=p.shop_id AND j.id=p.journal_id AND j.source_kind='SalaryPayment' AND j.source_id=p.id AND j.posting_date=p.posting_date AND j.recorded_by=p.recorded_by) AS journal_identity,
 EXISTS(SELECT 1 FROM ars_financial_accounts f WHERE f.shop_id=p.shop_id AND f.id=p.financial_account_id AND f.kind IN ('Office Cash','Bank')) AS account_valid,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=p.shop_id AND j.source_kind='Reversal' AND j.source_id IN(p.journal_id,a.journal_id)) AS reversed,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('code',l.account_code,'debit',l.debit::text,'credit',l.credit::text)) FROM ars_gl_lines l WHERE l.shop_id=p.shop_id AND l.journal_id=p.journal_id),'[]'::jsonb) AS lines,
 (SELECT COUNT(*) FROM ars_financial_movements m WHERE m.shop_id=p.shop_id AND m.movement_kind='Salary Payment' AND (m.id=p.journal_id OR m.source_id=p.id))::integer AS movement_count,
 (SELECT COUNT(*) FROM ars_financial_movements m WHERE m.shop_id=p.shop_id AND m.movement_kind='Salary Payment' AND m.id=p.journal_id AND m.source_id=p.id AND m.account_id=p.financial_account_id AND m.amount=-p.amount AND m.effective_date=p.posting_date AND m.recorded_by=p.recorded_by)::integer AS match_count
 FROM ars_gl_salary_payments p JOIN ars_gl_payroll_accruals a ON a.shop_id=p.shop_id AND a.id=p.accrual_id WHERE p.shop_id=$1 AND a.period_key=$2 ORDER BY p.id`,[shopId,period])).rows.map(p=>{
 const issues:string[]=[];
 if(!p.journal_identity)issues.push('PAYMENT_JOURNAL_IDENTITY');
 if(!p.account_valid||!match(p.lines,[{code:code('salaryPayable','control','Liability'),debit:p.amount,credit:'0.00'},{code:code('financialAccount',p.financial_account_id,'Asset'),debit:'0.00',credit:p.amount}]))issues.push('PAYMENT_JOURNAL_LINES_OR_MAPPING');
 if(p.movement_count!==1||p.match_count!==1)issues.push('PAYMENT_MOVEMENT');
 if(p.reversed)issues.push('REVERSAL');
 return {id:p.id,accrualId:p.accrual_id,journalId:p.journal_id,employeeName:p.employee_name,issues};
 });
 const unattributed=(await c.query(`SELECT 'ORPHAN_PAYROLL_JOURNAL' AS issue,j.id FROM ars_gl_journals j WHERE j.shop_id=$1 AND j.source_kind='PayrollAccrual' AND NOT EXISTS(SELECT 1 FROM ars_gl_payroll_accruals a WHERE a.shop_id=j.shop_id AND a.journal_id=j.id)
 UNION ALL SELECT 'ORPHAN_SALARY_JOURNAL',j.id FROM ars_gl_journals j WHERE j.shop_id=$1 AND j.source_kind='SalaryPayment' AND NOT EXISTS(SELECT 1 FROM ars_gl_salary_payments p WHERE p.shop_id=j.shop_id AND p.journal_id=j.id)
 UNION ALL SELECT 'ORPHAN_SALARY_MOVEMENT',m.id FROM ars_financial_movements m WHERE m.shop_id=$1 AND m.movement_kind='Salary Payment' AND NOT EXISTS(SELECT 1 FROM ars_gl_salary_payments p WHERE p.shop_id=m.shop_id AND p.id=m.source_id AND p.journal_id=m.id)
 UNION ALL SELECT 'ORPHAN_PAYROLL_RECOVERY',r.id FROM ars_gl_employee_advance_recoveries r WHERE r.shop_id=$1 AND r.recovery_kind='PayrollRecovery' AND NOT EXISTS(SELECT 1 FROM ars_gl_payroll_accruals a WHERE a.shop_id=r.shop_id AND a.id=r.payroll_proposal_id AND a.journal_id=r.journal_id)
 ORDER BY issue,id`,[shopId])).rows;
 const statutory=await reconcileStatutoryContributions(c as unknown as Pool,shopId,period);
 await c.query('COMMIT');
 return {period,accruals:rows,salaryPayments:payments,unattributed,statutory,checksPassed:report.totalsComplete&&rows.every(r=>!r.issues.length)&&payments.every(p=>!p.issues.length)&&!unattributed.length&&statutory.settlementChecksPassed,postingEnabled:false as const};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
