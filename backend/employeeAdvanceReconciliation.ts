import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';

/** Shop-wide, all-time advance reconciliation. Uses one SQL snapshot; never posts. */
export async function reconcileEmployeeAdvances(db:Pool,shopId:string){
 if(typeof shopId!=='string'||!shopId.trim()||shopId.length>200)throw Error('Valid payroll shop required.');
 const result=await db.query(`
 WITH advance_map AS (
 SELECT m.account_code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code AND a.kind='Asset'
 WHERE m.shop_id=$1 AND m.mapping_kind='employeeAdvances' AND m.source_id='control'
 ), disbursements AS (
 SELECT d.*,q.employee_name,
 ARRAY_REMOVE(ARRAY[
 CASE WHEN q.id IS NULL OR q.employee_id<>d.employee_id OR q.amount<>d.amount OR q.requested_date>d.posting_date OR v.decision IS DISTINCT FROM 'Approved' OR lower(trim(q.submitted_by))=lower(trim(v.reviewed_by)) THEN 'ADVANCE_APPROVAL' END,
 CASE WHEN j.id IS NULL OR j.source_kind<>'EmployeeAdvanceDisbursement' OR j.source_id<>d.id OR j.posting_date<>d.posting_date OR j.recorded_by<>d.recorded_by THEN 'ADVANCE_JOURNAL_IDENTITY' END,
 CASE WHEN a.account_code IS NULL OR b.account_code IS NULL OR a.account_code=b.account_code OR fa.id IS NULL OR bc.code IS NULL OR l.n<>2 OR COALESCE(l.advance_debit,0)<>d.amount OR COALESCE(l.cash_credit,0)<>d.amount THEN 'ADVANCE_JOURNAL_LINES' END,
 CASE WHEN m.n<>1 OR m.matched<>1 THEN 'ADVANCE_MOVEMENT' END,
 CASE WHEN EXISTS(SELECT 1 FROM ars_gl_journals x WHERE x.shop_id=d.shop_id AND x.source_kind='Reversal' AND x.source_id=d.journal_id) THEN 'ADVANCE_REVERSAL' END
 ],NULL) AS issues
 FROM ars_gl_employee_advance_disbursements d
 LEFT JOIN ars_gl_employee_advance_requests q ON q.shop_id=d.shop_id AND q.id=d.request_id
 LEFT JOIN ars_gl_employee_advance_reviews v ON v.shop_id=q.shop_id AND v.request_id=q.id
 LEFT JOIN ars_gl_journals j ON j.shop_id=d.shop_id AND j.id=d.journal_id
 LEFT JOIN advance_map a ON TRUE
 LEFT JOIN ars_gl_account_mappings b ON b.shop_id=d.shop_id AND b.mapping_kind='financialAccount' AND b.source_id=d.financial_account_id
 LEFT JOIN ars_gl_accounts bc ON bc.shop_id=b.shop_id AND bc.code=b.account_code AND bc.kind='Asset'
 LEFT JOIN ars_financial_accounts fa ON fa.shop_id=d.shop_id AND fa.id=d.financial_account_id AND fa.kind IN ('Office Cash','Bank')
 LEFT JOIN LATERAL(SELECT COUNT(*) AS n,SUM(debit) FILTER(WHERE account_code=a.account_code AND credit=0) AS advance_debit,SUM(credit) FILTER(WHERE account_code=b.account_code AND debit=0) AS cash_credit FROM ars_gl_lines WHERE shop_id=d.shop_id AND journal_id=d.journal_id) l ON TRUE
 LEFT JOIN LATERAL(SELECT COUNT(*) AS n,COUNT(*) FILTER(WHERE id=d.journal_id AND source_id=d.id AND account_id=d.financial_account_id AND amount=-d.amount AND effective_date=d.posting_date AND recorded_by=d.recorded_by) AS matched FROM ars_financial_movements WHERE shop_id=d.shop_id AND movement_kind='Employee Advance' AND (id=d.journal_id OR source_id=d.id)) m ON TRUE
 WHERE d.shop_id=$1
 ), recoveries AS (
 SELECT r.*,d.employee_name,
 ARRAY_REMOVE(ARRAY[
 CASE WHEN d.id IS NULL OR d.employee_id<>r.employee_id OR r.posting_date<d.posting_date OR r.amount<=0 THEN 'RECOVERY_SOURCE' END,
 CASE WHEN r.recovery_kind='DirectRepayment' AND (j.id IS NULL OR j.source_kind<>'EmployeeAdvanceRepayment' OR j.source_id<>r.id OR j.posting_date<>r.posting_date OR j.recorded_by<>r.recorded_by) THEN 'REPAYMENT_JOURNAL_IDENTITY' END,
 CASE WHEN r.recovery_kind='DirectRepayment' AND (a.account_code IS NULL OR b.account_code IS NULL OR a.account_code=b.account_code OR bc.code IS NULL OR fa.id IS NULL OR l.n<>2 OR COALESCE(l.advance_credit,0)<>r.amount OR COALESCE(l.cash_debit,0)<>r.amount) THEN 'REPAYMENT_JOURNAL_LINES' END,
 CASE WHEN r.recovery_kind='DirectRepayment' AND (m.n<>1 OR m.matched<>1) THEN 'REPAYMENT_MOVEMENT' END,
 CASE WHEN r.recovery_kind='PayrollRecovery' AND (p.id IS NULL OR p.employee_id<>r.employee_id OR p.journal_id<>r.journal_id OR p.posting_date<>r.posting_date OR p.recorded_by<>r.recorded_by OR j.id IS NULL OR j.source_kind<>'PayrollAccrual' OR j.source_id<>p.id OR j.posting_date<>r.posting_date OR j.recorded_by<>r.recorded_by OR a.account_code IS NULL OR COALESCE(l.advance_credit,0)<>(SELECT COALESCE(SUM(x.amount),0) FROM ars_gl_employee_advance_recoveries x WHERE x.shop_id=r.shop_id AND x.payroll_proposal_id=r.payroll_proposal_id AND x.recovery_kind='PayrollRecovery') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pd.inputs->'deductions')='array' THEN pd.inputs->'deductions' ELSE '[]'::jsonb END) x WHERE x->>'kind'='AdvanceRecovery' AND x->>'id'='advance:'||r.disbursement_id AND CASE WHEN x->>'amount'~'^[0-9]{1,14}(\\.[0-9]{1,2})?$' THEN (x->>'amount')::numeric=r.amount ELSE FALSE END)) THEN 'PAYROLL_RECOVERY_LINK' END,
 CASE WHEN r.recovery_kind NOT IN ('DirectRepayment','PayrollRecovery') THEN 'RECOVERY_KIND' END,
 CASE WHEN EXISTS(SELECT 1 FROM ars_gl_journals x WHERE x.shop_id=r.shop_id AND x.source_kind='Reversal' AND x.source_id IN(r.journal_id,d.journal_id)) THEN 'RECOVERY_REVERSAL' END
 ],NULL) AS issues
 FROM ars_gl_employee_advance_recoveries r
 LEFT JOIN disbursements d ON d.shop_id=r.shop_id AND d.id=r.disbursement_id
 LEFT JOIN ars_gl_journals j ON j.shop_id=r.shop_id AND j.id=r.journal_id
 LEFT JOIN ars_gl_payroll_accruals p ON p.shop_id=r.shop_id AND p.id=r.payroll_proposal_id
 LEFT JOIN ars_gl_payroll_details pd ON pd.shop_id=p.shop_id AND pd.proposal_id=p.id
 LEFT JOIN advance_map a ON TRUE
 LEFT JOIN ars_gl_account_mappings b ON b.shop_id=r.shop_id AND b.mapping_kind='financialAccount' AND b.source_id=r.financial_account_id
 LEFT JOIN ars_gl_accounts bc ON bc.shop_id=b.shop_id AND bc.code=b.account_code AND bc.kind='Asset'
 LEFT JOIN ars_financial_accounts fa ON fa.shop_id=r.shop_id AND fa.id=r.financial_account_id AND fa.kind IN ('Office Cash','Bank')
 LEFT JOIN LATERAL(SELECT COUNT(*) AS n,SUM(credit) FILTER(WHERE account_code=a.account_code AND debit=0) AS advance_credit,SUM(debit) FILTER(WHERE account_code=b.account_code AND credit=0) AS cash_debit FROM ars_gl_lines WHERE shop_id=r.shop_id AND journal_id=r.journal_id) l ON TRUE
 LEFT JOIN LATERAL(SELECT COUNT(*) AS n,COUNT(*) FILTER(WHERE id=r.journal_id AND source_id=r.journal_id AND account_id=r.financial_account_id AND amount=r.amount AND effective_date=r.posting_date AND recorded_by=r.recorded_by) AS matched FROM ars_financial_movements WHERE shop_id=r.shop_id AND movement_kind='Employee Advance' AND (id=r.journal_id OR source_id=r.journal_id)) m ON TRUE
 WHERE r.shop_id=$1
 ), balances AS (
 SELECT d.id,d.employee_name,d.journal_id,d.amount,COALESCE(SUM(r.amount),0) AS recovered,
 d.issues||ARRAY_REMOVE(ARRAY[CASE WHEN COALESCE(SUM(r.amount),0)>d.amount THEN 'ADVANCE_OVER_RECOVERY' END,CASE WHEN BOOL_OR(cardinality(r.issues)>0) THEN 'ADVANCE_RECOVERY_EXCEPTION' END],NULL) AS issues
 FROM disbursements d LEFT JOIN recoveries r ON r.shop_id=d.shop_id AND r.disbursement_id=d.id GROUP BY d.id,d.employee_name,d.journal_id,d.amount,d.issues
 ), orphan AS (
 SELECT 'ORPHAN_ADVANCE_JOURNAL' AS issue,j.id FROM ars_gl_journals j WHERE j.shop_id=$1 AND ((j.source_kind='EmployeeAdvanceDisbursement' AND NOT EXISTS(SELECT 1 FROM disbursements d WHERE d.journal_id=j.id)) OR (j.source_kind='EmployeeAdvanceRepayment' AND NOT EXISTS(SELECT 1 FROM recoveries r WHERE r.journal_id=j.id AND r.recovery_kind='DirectRepayment')))
 UNION ALL SELECT 'ORPHAN_ADVANCE_MOVEMENT',m.id FROM ars_financial_movements m WHERE m.shop_id=$1 AND m.movement_kind='Employee Advance' AND NOT EXISTS(SELECT 1 FROM disbursements d WHERE d.journal_id=m.id AND d.id=m.source_id) AND NOT EXISTS(SELECT 1 FROM recoveries r WHERE r.recovery_kind='DirectRepayment' AND r.journal_id=m.id AND r.journal_id=m.source_id)
 ), ledger AS (
 SELECT (SELECT COUNT(*) FROM advance_map)::integer AS mapping_count,COALESCE((SELECT SUM(l.debit-l.credit) FROM ars_gl_lines l JOIN advance_map a ON a.account_code=l.account_code WHERE l.shop_id=$1),0) AS balance,
 COALESCE((SELECT SUM(amount-recovered) FROM balances),0) AS subledger
 )
 SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'employeeName',COALESCE(employee_name,'Unknown employee'),'journalId',journal_id,'issued',amount::text,'recovered',recovered::text,'issues',issues) ORDER BY id) FROM balances),'[]'::jsonb) AS advances,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'employeeName',COALESCE(employee_name,'Unknown employee'),'journalId',journal_id,'disbursementId',disbursement_id,'kind',recovery_kind,'amount',amount::text,'issues',issues) ORDER BY id) FROM recoveries),'[]'::jsonb) AS recoveries,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'issue',issue)) FROM orphan),'[]'::jsonb) AS unattributed,
 ledger.mapping_count,ledger.balance::text AS ledger_balance,ledger.subledger::text AS subledger_balance FROM ledger
 `,[shopId]);
 const row=result.rows[0];
 const advances=row.advances.map((a:{issued:string;recovered:string;issues:string[]})=>({...a,outstanding:a.issues.length?null:decimal(moneyCents(a.issued)-moneyCents(a.recovered))}));
 // Compare signed decimal values exactly, independent of PostgreSQL display scale.
 const signedCents=(v:string)=>{if(typeof v!=='string'||! /^-?\d+(?:\.\d{1,2})?$/.test(v))throw Error('Invalid advance control balance.');const negative=v.startsWith('-'),[whole,fraction='']=(negative?v.slice(1):v).split('.');const n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));return negative?-n:n;};
 const ledger=signedCents(row.ledger_balance),subledger=signedCents(row.subledger_balance);
 const controlMatched=row.mapping_count===1&&subledger>=0n&&ledger===subledger;
 return {scope:'Shop-wide; all recorded disbursements and recoveries',advances,recoveries:row.recoveries,unattributed:row.unattributed,ledgerBalance:row.ledger_balance,subledgerBalance:row.subledger_balance,controlMatched,checksPassed:controlMatched&&advances.every((a:{issues:string[]})=>!a.issues.length)&&row.recoveries.every((r:{issues:string[]})=>!r.issues.length)&&!row.unattributed.length,postingEnabled:false as const};
}
