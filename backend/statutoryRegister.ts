import type {Pool} from 'pg';

const valid=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=200;

/** Read-only monthly register. Amounts remain exact decimal strings.
 * Missing mappings, snapshot differences, reversed journals and unmatched bank movements
 * are surfaced for reconciliation rather than treated as settled obligations. */
export async function listMonthlyStatutoryLiabilities(db:Pool,shopId:string,period:string){
 if(!valid(shopId)||typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Valid shop and payroll month required.');
 const result=await db.query(`
 WITH funds(fund,mapping_kind) AS (VALUES ('EPF','epfPayable'),('ETF','etfPayable')),
 accruals AS (
  SELECT a.*,d.results,s.proposal_id AS statutory_snapshot
  FROM ars_gl_payroll_accruals a
  LEFT JOIN ars_gl_payroll_details d ON d.shop_id=a.shop_id AND d.proposal_id=a.id
  LEFT JOIN ars_gl_payroll_statutory_snapshots s ON s.shop_id=a.shop_id AND s.proposal_id=a.id
  WHERE a.shop_id=$1 AND a.period_key=$2
 ), amounts AS (
  SELECT a.id AS accrual_id,a.employee_id,a.employee_name,a.period_key,a.posting_date,a.journal_id,f.fund,
   a.statutory_snapshot IS NOT NULL AS has_snapshot,
   g.code IS NOT NULL AS has_mapping,
   COALESCE(parts.employee,0) AS employee_contribution,COALESCE(parts.employer,0) AS employer_contribution,
   COALESCE(parts.count,0) AS component_count,
   COALESCE(l.amount,0) AS liability,COALESCE(p.amount,0) AS settled,
   COALESCE(p.reconciliation_required,FALSE) OR EXISTS(
    SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=a.shop_id AND j.source_kind='Reversal' AND j.source_id=a.journal_id
   ) AS reversed_or_unmatched
  FROM accruals a CROSS JOIN funds f
  LEFT JOIN ars_gl_account_mappings m ON m.shop_id=a.shop_id AND m.mapping_kind=f.mapping_kind AND m.source_id='control'
  LEFT JOIN ars_gl_accounts g ON g.shop_id=m.shop_id AND g.code=m.account_code AND g.kind='Liability' AND g.active
  LEFT JOIN LATERAL (
   SELECT SUM(CASE WHEN x->>'id'='statutory-employee-epf' AND x->>'party'='Employee' THEN (x->>'amount')::numeric ELSE 0 END) AS employee,
    SUM(CASE WHEN x->>'party'='Employer' THEN (x->>'amount')::numeric ELSE 0 END) AS employer,COUNT(*) AS count
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.results->'contributions')='array' THEN a.results->'contributions' ELSE '[]'::jsonb END) x
   WHERE (f.fund='EPF' AND ((x->>'id'='statutory-employee-epf' AND x->>'party'='Employee') OR (x->>'id'='statutory-employer-epf' AND x->>'party'='Employer')))
    OR (f.fund='ETF' AND x->>'id'='statutory-employer-etf' AND x->>'party'='Employer')
  ) parts ON TRUE
  LEFT JOIN LATERAL (
   SELECT SUM(credit-debit) AS amount FROM ars_gl_lines WHERE shop_id=a.shop_id AND journal_id=a.journal_id AND account_code=g.code
  ) l ON TRUE
  LEFT JOIN LATERAL (
   SELECT SUM(s.amount) AS amount,BOOL_OR(
    NOT EXISTS(SELECT 1 FROM ars_financial_movements v WHERE v.shop_id=s.shop_id AND v.id=s.journal_id AND v.source_id=s.id AND v.account_id=s.financial_account_id AND v.movement_kind='Statutory Settlement' AND v.amount=-s.amount AND v.effective_date=s.posting_date AND v.recorded_by=s.recorded_by)
    OR EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=s.shop_id AND j.source_kind='Reversal' AND j.source_id=s.journal_id)
   ) AS reconciliation_required
   FROM ars_gl_statutory_settlements s WHERE s.shop_id=a.shop_id AND s.accrual_id=a.id AND s.fund=f.fund
  ) p ON TRUE
 ), checked AS (
  SELECT *,NOT has_snapshot OR NOT has_mapping OR component_count<>CASE WHEN fund='EPF' THEN 2 ELSE 1 END
   OR employee_contribution<0 OR employer_contribution<0 OR liability<>employee_contribution+employer_contribution
   OR settled>liability OR liability<0 OR reversed_or_unmatched AS reconciliation_required
  FROM amounts
 ), summaries AS (
  SELECT f.fund,COUNT(c.accrual_id) AS employee_count,COUNT(*) FILTER(WHERE c.reconciliation_required) AS exception_count,
   CASE WHEN COALESCE(BOOL_OR(c.reconciliation_required),FALSE) THEN NULL ELSE COALESCE(SUM(c.employee_contribution),0)::text END AS employee_contribution,
   CASE WHEN COALESCE(BOOL_OR(c.reconciliation_required),FALSE) THEN NULL ELSE COALESCE(SUM(c.employer_contribution),0)::text END AS employer_contribution,
   CASE WHEN COALESCE(BOOL_OR(c.reconciliation_required),FALSE) THEN NULL ELSE COALESCE(SUM(c.liability),0)::text END AS liability,
   CASE WHEN COALESCE(BOOL_OR(c.reconciliation_required),FALSE) THEN NULL ELSE COALESCE(SUM(c.settled),0)::text END AS settled,
   CASE WHEN COALESCE(BOOL_OR(c.reconciliation_required),FALSE) THEN NULL ELSE COALESCE(SUM(c.liability-c.settled),0)::text END AS outstanding
  FROM funds f LEFT JOIN checked c ON c.fund=f.fund GROUP BY f.fund
 )
 SELECT (SELECT jsonb_agg(s ORDER BY s.fund) FROM summaries s) AS summary,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('accrualId',accrual_id,'employeeId',employee_id,'employeeName',employee_name,
 'period',period_key,'postingDate',posting_date::text,'journalId',journal_id,'fund',fund,
 'employeeContribution',employee_contribution::text,'employerContribution',employer_contribution::text,
 'liability',liability::text,'settled',settled::text,'outstanding',CASE WHEN reconciliation_required THEN NULL ELSE (liability-settled)::text END,
 'reconciliationRequired',reconciliation_required) ORDER BY employee_name,accrual_id,fund) FROM checked),'[]'::jsonb) AS allocations
 `,[shopId,period]);
 return {period,summary:result.rows[0].summary,allocations:result.rows[0].allocations,postingEnabled:false as const};
}

/** Immutable allocation history, including receipt and bank evidence. */
export async function listStatutorySettlementHistory(db:Pool,shopId:string,period:string){
 if(!valid(shopId)||typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Valid shop and payroll month required.');
 return (await db.query(`SELECT s.id,s.accrual_id,a.employee_id,a.employee_name,a.period_key,s.fund,
 s.financial_account_id,b.name AS bank_name,s.amount::text,s.posting_date::text,s.journal_id,s.receipt_reference,s.evidence,s.recorded_by,s.recorded_at,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=s.shop_id AND j.source_kind='Reversal' AND j.source_id IN (s.journal_id,a.journal_id))
 OR NOT EXISTS(SELECT 1 FROM ars_financial_movements m WHERE m.shop_id=s.shop_id AND m.id=s.journal_id AND m.source_id=s.id AND m.account_id=s.financial_account_id AND m.movement_kind='Statutory Settlement' AND m.amount=-s.amount AND m.effective_date=s.posting_date AND m.recorded_by=s.recorded_by) AS reconciliation_required
 FROM ars_gl_statutory_settlements s JOIN ars_gl_payroll_accruals a ON a.shop_id=s.shop_id AND a.id=s.accrual_id
 LEFT JOIN ars_financial_accounts b ON b.shop_id=s.shop_id AND b.id=s.financial_account_id
 WHERE s.shop_id=$1 AND a.period_key=$2 ORDER BY s.posting_date DESC,s.recorded_at DESC,s.id`,[shopId,period])).rows;
}
