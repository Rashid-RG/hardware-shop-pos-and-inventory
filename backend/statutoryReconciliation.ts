import type {Pool} from 'pg';

/** Read-only reconciliation across all posted statutory journals and bank movements.
 * Unattributed entries are shop-wide exceptions because their payroll month cannot be established. */
export async function reconcileStatutoryContributions(db:Pool,shopId:string,period:string){
 if(typeof shopId!=='string'||!shopId.trim()||shopId.length>200||typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Valid shop and payroll month required.');
 const result=await db.query(`
 WITH selected AS (
  SELECT s.*,a.period_key,a.employee_name,a.journal_id AS accrual_journal
  FROM ars_gl_statutory_settlements s JOIN ars_gl_payroll_accruals a ON a.shop_id=s.shop_id AND a.id=s.accrual_id
  WHERE s.shop_id=$1 AND a.period_key=$2
 ), checks AS (
  SELECT s.id,s.fund,s.employee_name,s.receipt_reference,s.amount,s.journal_id,
   ARRAY_REMOVE(ARRAY[
    CASE WHEN j.id IS NULL OR j.source_kind<>'StatutorySettlement' OR j.source_id<>s.id OR j.posting_date<>s.posting_date OR j.recorded_by<>s.recorded_by THEN 'JOURNAL_IDENTITY' END,
    CASE WHEN p.account_code IS NULL OR pc.code IS NULL THEN 'LIABILITY_MAPPING' END,
    CASE WHEN b.account_code IS NULL OR bc.code IS NULL OR fa.id IS NULL THEN 'BANK_MAPPING' END,
    CASE WHEN COALESCE(l.line_count,0)<>2 OR COALESCE(l.liability_debit,0)<>s.amount OR COALESCE(l.bank_credit,0)<>s.amount THEN 'JOURNAL_LINES' END,
    CASE WHEN COALESCE(m.match_count,0)<>1 OR COALESCE(m.total_count,0)<>1 THEN 'BANK_MOVEMENT' END,
    CASE WHEN EXISTS(SELECT 1 FROM ars_gl_journals r WHERE r.shop_id=s.shop_id AND r.source_kind='Reversal' AND r.source_id IN(s.journal_id,s.accrual_journal)) THEN 'REVERSAL' END
   ],NULL) AS issues
  FROM selected s
  LEFT JOIN ars_gl_journals j ON j.shop_id=s.shop_id AND j.id=s.journal_id
  LEFT JOIN ars_gl_account_mappings p ON p.shop_id=s.shop_id AND p.source_id='control' AND p.mapping_kind=CASE WHEN s.fund='EPF' THEN 'epfPayable' ELSE 'etfPayable' END
  LEFT JOIN ars_gl_accounts pc ON pc.shop_id=p.shop_id AND pc.code=p.account_code AND pc.kind='Liability'
  LEFT JOIN ars_gl_account_mappings b ON b.shop_id=s.shop_id AND b.source_id=s.financial_account_id AND b.mapping_kind='financialAccount'
  LEFT JOIN ars_gl_accounts bc ON bc.shop_id=b.shop_id AND bc.code=b.account_code AND bc.kind='Asset'
  LEFT JOIN ars_financial_accounts fa ON fa.shop_id=s.shop_id AND fa.id=s.financial_account_id AND fa.kind='Bank'
  LEFT JOIN LATERAL(SELECT COUNT(*) AS line_count,SUM(debit) FILTER(WHERE account_code=p.account_code AND credit=0) AS liability_debit,SUM(credit) FILTER(WHERE account_code=b.account_code AND debit=0) AS bank_credit FROM ars_gl_lines WHERE shop_id=s.shop_id AND journal_id=s.journal_id) l ON TRUE
  LEFT JOIN LATERAL(SELECT COUNT(*) AS total_count,COUNT(*) FILTER(WHERE v.id=s.journal_id AND v.source_id=s.id AND v.account_id=s.financial_account_id AND v.amount=-s.amount AND v.effective_date=s.posting_date AND v.recorded_by=s.recorded_by) AS match_count FROM ars_financial_movements v WHERE v.shop_id=s.shop_id AND v.movement_kind='Statutory Settlement' AND (v.source_id=s.id OR v.id=s.journal_id)) m ON TRUE
 ), orphan AS (
  SELECT 'UNMATCHED_JOURNAL' AS issue,j.id FROM ars_gl_journals j WHERE j.shop_id=$1 AND j.source_kind='StatutorySettlement' AND NOT EXISTS(SELECT 1 FROM ars_gl_statutory_settlements s WHERE s.shop_id=j.shop_id AND s.journal_id=j.id)
  UNION ALL
  SELECT 'UNMATCHED_BANK_MOVEMENT',m.id FROM ars_financial_movements m WHERE m.shop_id=$1 AND m.movement_kind='Statutory Settlement' AND NOT EXISTS(SELECT 1 FROM ars_gl_statutory_settlements s WHERE s.shop_id=m.shop_id AND s.id=m.source_id AND s.journal_id=m.id)
 )
 SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'fund',fund,'employeeName',employee_name,'receiptReference',receipt_reference,'amount',amount::text,'journalId',journal_id,'issues',issues) ORDER BY id) FROM checks),'[]'::jsonb) AS settlements,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('issue',issue,'id',id) ORDER BY issue,id) FROM orphan),'[]'::jsonb) AS unattributed
 `,[shopId,period]);
 const {settlements,unattributed}=result.rows[0];
 return {period,settlements,unattributed,settlementChecksPassed:unattributed.length===0&&settlements.every((s:{issues:string[]})=>s.issues.length===0),postingEnabled:false as const};
}
