import type {Pool} from 'pg';
import {calculatePayroll} from './payrollCalculation';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {createHash} from 'node:crypto';
const canonical=(v:unknown):string=>{
 if(v===null||['string','boolean','number'].includes(typeof v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&typeof v==='object'){const o=v as Record<string,unknown>;return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';}
 throw Error('Invalid snapshot.');
};
const signed=(n:bigint)=>n<0n?'-'+decimal(-n):decimal(n);
/** Shop-wide recorded salary payable. One SQL snapshot, exact decimal arithmetic, no posting. */
export async function reconcileSalaryPayable(db:Pool,shopId:string){
 if(typeof shopId!=='string'||!shopId.trim()||shopId.length>200)throw Error('Valid payroll shop required.');
 const result=await db.query(`
 WITH mapping AS (
 SELECT m.account_code FROM ars_gl_account_mappings m JOIN ars_gl_accounts g ON g.shop_id=m.shop_id AND g.code=m.account_code AND g.kind='Liability'
 WHERE m.shop_id=$1 AND m.mapping_kind='salaryPayable' AND m.source_id='control'
 ), accruals AS (
 SELECT a.id,a.employee_id,a.employee_name,a.period_key,a.journal_id,a.base_salary::text,a.gross_amount::text,
 d.inputs,d.results,d.snapshot_hash,d.calculation_version,d.net_salary::text,d.proposal_id IS NOT NULL AS detailed,s.proposal_id IS NOT NULL AS bound,
 COALESCE(l.amount,0)::text AS accrued,COALESCE(p.amount,0)::text AS paid,
 ARRAY_REMOVE(ARRAY[
 CASE WHEN j.id IS NULL OR j.source_kind<>'PayrollAccrual' OR j.source_id<>a.id OR j.posting_date<>a.posting_date OR j.recorded_by<>a.recorded_by THEN 'ACCRUAL_JOURNAL_IDENTITY' END,
 CASE WHEN EXISTS(SELECT 1 FROM ars_gl_journals r WHERE r.shop_id=a.shop_id AND r.source_kind='Reversal' AND r.source_id=a.journal_id) THEN 'ACCRUAL_REVERSAL' END,
 CASE WHEN COALESCE(p.invalid,FALSE) THEN 'SALARY_PAYMENT_EVIDENCE' END
 ],NULL) AS issues
 FROM ars_gl_payroll_accruals a
 LEFT JOIN ars_gl_payroll_details d ON d.shop_id=a.shop_id AND d.proposal_id=a.id
 LEFT JOIN ars_gl_payroll_statutory_snapshots s ON s.shop_id=a.shop_id AND s.proposal_id=a.id
 LEFT JOIN ars_gl_journals j ON j.shop_id=a.shop_id AND j.id=a.journal_id
 LEFT JOIN LATERAL(SELECT SUM(credit-debit) AS amount FROM ars_gl_lines WHERE shop_id=a.shop_id AND journal_id=a.journal_id AND account_code IN(SELECT account_code FROM mapping)) l ON TRUE
 LEFT JOIN LATERAL(
 SELECT SUM(v.amount) AS amount,BOOL_OR(v.amount<=0 OR v.posting_date<a.posting_date OR
 NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=v.shop_id AND j.id=v.journal_id AND j.source_kind='SalaryPayment' AND j.source_id=v.id AND j.posting_date=v.posting_date AND j.recorded_by=v.recorded_by) OR
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=v.shop_id AND j.source_kind='Reversal' AND j.source_id=v.journal_id) OR
 (SELECT COUNT(*) FROM ars_financial_movements m WHERE m.shop_id=v.shop_id AND m.movement_kind='Salary Payment' AND (m.id=v.journal_id OR m.source_id=v.id))<>1 OR
 NOT EXISTS(SELECT 1 FROM ars_financial_movements m WHERE m.shop_id=v.shop_id AND m.id=v.journal_id AND m.source_id=v.id AND m.account_id=v.financial_account_id AND m.amount=-v.amount AND m.movement_kind='Salary Payment' AND m.effective_date=v.posting_date AND m.recorded_by=v.recorded_by) OR
 NOT EXISTS(SELECT 1 FROM mapping p JOIN ars_gl_account_mappings b ON b.shop_id=v.shop_id AND b.mapping_kind='financialAccount' AND b.source_id=v.financial_account_id JOIN ars_gl_accounts g ON g.shop_id=b.shop_id AND g.code=b.account_code AND g.kind='Asset' JOIN ars_financial_accounts f ON f.shop_id=b.shop_id AND f.id=b.source_id AND f.kind IN ('Office Cash','Bank')
 WHERE p.account_code<>b.account_code AND (SELECT COUNT(*) FROM ars_gl_lines WHERE shop_id=v.shop_id AND journal_id=v.journal_id)=2
 AND EXISTS(SELECT 1 FROM ars_gl_lines WHERE shop_id=v.shop_id AND journal_id=v.journal_id AND account_code=p.account_code AND debit=v.amount AND credit=0)
 AND EXISTS(SELECT 1 FROM ars_gl_lines WHERE shop_id=v.shop_id AND journal_id=v.journal_id AND account_code=b.account_code AND credit=v.amount AND debit=0))) AS invalid
 FROM ars_gl_salary_payments v WHERE v.shop_id=a.shop_id AND v.accrual_id=a.id) p ON TRUE
 WHERE a.shop_id=$1
 ), orphan AS (
 SELECT j.id,'ORPHAN_PAYROLL_JOURNAL' AS issue FROM ars_gl_journals j WHERE j.shop_id=$1 AND j.source_kind='PayrollAccrual' AND NOT EXISTS(SELECT 1 FROM ars_gl_payroll_accruals a WHERE a.shop_id=j.shop_id AND a.journal_id=j.id)
 UNION ALL SELECT j.id,'ORPHAN_SALARY_JOURNAL' FROM ars_gl_journals j WHERE j.shop_id=$1 AND j.source_kind='SalaryPayment' AND NOT EXISTS(SELECT 1 FROM ars_gl_salary_payments v WHERE v.shop_id=j.shop_id AND v.journal_id=j.id)
 UNION ALL SELECT m.id,'ORPHAN_SALARY_MOVEMENT' FROM ars_financial_movements m WHERE m.shop_id=$1 AND m.movement_kind='Salary Payment' AND NOT EXISTS(SELECT 1 FROM ars_gl_salary_payments v WHERE v.shop_id=m.shop_id AND v.journal_id=m.id AND v.id=m.source_id)
 )
 SELECT (SELECT COUNT(*) FROM mapping)::integer AS mapping_count,(SELECT MIN(account_code) FROM mapping) AS account_code,
 COALESCE((SELECT SUM(credit-debit) FROM ars_gl_lines WHERE shop_id=$1 AND account_code IN(SELECT account_code FROM mapping)),0)::text AS ledger_balance,
 COALESCE((SELECT jsonb_agg(a ORDER BY period_key,id) FROM (SELECT * FROM accruals ORDER BY period_key,id LIMIT 10001) a),'[]'::jsonb) AS accruals,
 COALESCE((SELECT jsonb_agg(o ORDER BY issue,id) FROM orphan o),'[]'::jsonb) AS unattributed
 `,[shopId]);
 const r=result.rows[0];if(r.accruals.length>10000)throw Error('Salary reconciliation capacity exceeded.');
 let net=0n,paid=0n;
 const rows=r.accruals.map((a:any)=>{
 const issues:string[]=[...a.issues];
 let amounts:null|{netSalary:string;paid:string;outstanding:string}=null;
 try{
 const input=a.detailed?a.inputs:{baseSalary:a.base_salary,earnings:[],deductions:[],contributions:[],policyReference:'Base salary only'};
 const calc=calculatePayroll(input);
 if(a.detailed){
 const hash=createHash('sha256').update(canonical({version:1,inputs:input,results:calc})).digest('hex');
 if(!a.bound||a.calculation_version!==1||hash!==a.snapshot_hash||canonical(calc)!==canonical(a.results)||moneyCents(a.net_salary)!==moneyCents(calc.netSalary))throw Error('Snapshot mismatch');
 }else if(a.bound)throw Error('Missing detail');
 const n=moneyCents(calc.netSalary),p=moneyCents(a.paid);
 if(moneyCents(calc.baseSalary)!==moneyCents(a.base_salary)||moneyCents(calc.grossSalary)!==moneyCents(a.gross_amount)||moneyCents(a.accrued)!==n)issues.push('SALARY_ACCRUAL_AMOUNT');
 if(p>n)issues.push('SALARY_OVERPAYMENT');
 if(!issues.length){net+=n;paid+=p;amounts={netSalary:decimal(n),paid:decimal(p),outstanding:decimal(n-p)};}
 }catch{issues.push('PAYROLL_SNAPSHOT_OR_AMOUNT');}
 return {id:a.id,employeeId:a.employee_id,employeeName:a.employee_name,period:a.period_key,journalId:a.journal_id,amounts,issues};
 });
 const parse=(v:string)=>{if(!/^-?\d+(?:\.\d{1,2})?$/.test(v))throw Error('Invalid salary control balance');const neg=v.startsWith('-'),[w,f='']=(neg?v.slice(1):v).split('.');const n=BigInt(w)*100n+BigInt(f.padEnd(2,'0'));return neg?-n:n;};
 const ledger=parse(r.ledger_balance),outstanding=net-paid,exceptionCount=rows.filter((a:{issues:string[]})=>a.issues.length).length;
 const totalsComplete=exceptionCount===0,controlMatched=totalsComplete&&r.mapping_count===1&&ledger===outstanding;
 return {scope:'Shop-wide, all recorded payroll periods; payments to date',accountCode:r.account_code,ledgerBalance:signed(ledger),verifiedNetSalary:decimal(net),verifiedPaid:decimal(paid),verifiedOutstanding:decimal(outstanding),difference:totalsComplete?signed(ledger-outstanding):null,totalsComplete,controlMatched,exceptionCount,rows,unattributed:r.unattributed,checksPassed:controlMatched&&!r.unattributed.length,postingEnabled:false as const};
}
