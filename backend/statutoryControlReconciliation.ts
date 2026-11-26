import type {Pool} from 'pg';

/** All-time recorded statutory liabilities, independent of the monthly remittance view.
 * Opening balances and unrelated postings are deliberately reported as differences. */
export async function reconcileStatutoryControls(db:Pool,shopId:string){
 if(typeof shopId!=='string'||!shopId.trim()||shopId.length>200)throw Error('Valid payroll shop required.');
 const result=await db.query(`
 WITH funds(fund,mapping_kind) AS (VALUES ('EPF','epfPayable'),('ETF','etfPayable')),
 mappings AS (
 SELECT f.fund,m.account_code,g.code IS NOT NULL AS valid
 FROM funds f LEFT JOIN ars_gl_account_mappings m ON m.shop_id=$1 AND m.mapping_kind=f.mapping_kind AND m.source_id='control'
 LEFT JOIN ars_gl_accounts g ON g.shop_id=m.shop_id AND g.code=m.account_code AND g.kind='Liability'
 ), contributions AS (
 SELECT a.id,a.employee_name,a.period_key,a.journal_id,f.fund,a.shop_id,s.proposal_id IS NOT NULL AS bound,
 d.proposal_id IS NOT NULL AS detailed,m.account_code,m.valid AS mapped,
 COALESCE(p.employee,0) AS employee,COALESCE(p.employer,0) AS employer,
 COALESCE(p.employee_count,0) AS employee_count,COALESCE(p.employer_count,0) AS employer_count,
 COALESCE(p.invalid_count,0) AS invalid_count,
 COALESCE(l.amount,0) AS accrued,COALESCE(t.amount,0) AS settled,
 COALESCE(t.invalid,FALSE) AS settlement_invalid,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=a.shop_id AND j.id=a.journal_id AND j.source_kind='PayrollAccrual' AND j.source_id=a.id AND j.posting_date=a.posting_date AND j.recorded_by=a.recorded_by) AS journal_valid,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=a.shop_id AND j.source_kind='Reversal' AND j.source_id=a.journal_id) AS reversed
 FROM ars_gl_payroll_accruals a CROSS JOIN funds f
 JOIN mappings m ON m.fund=f.fund
 LEFT JOIN ars_gl_payroll_details d ON d.shop_id=a.shop_id AND d.proposal_id=a.id
 LEFT JOIN ars_gl_payroll_statutory_snapshots s ON s.shop_id=a.shop_id AND s.proposal_id=a.id
 LEFT JOIN LATERAL(
 SELECT SUM(CASE WHEN x->>'party'='Employee' AND x->>'amount'~'^[0-9]{1,14}([.][0-9]{1,2})?$' THEN (x->>'amount')::numeric ELSE 0 END) AS employee,
 SUM(CASE WHEN x->>'party'='Employer' AND x->>'amount'~'^[0-9]{1,14}([.][0-9]{1,2})?$' THEN (x->>'amount')::numeric ELSE 0 END) AS employer,
 COUNT(*) FILTER(WHERE x->>'party'='Employee') AS employee_count,COUNT(*) FILTER(WHERE x->>'party'='Employer') AS employer_count,
 COUNT(*) FILTER(WHERE NOT COALESCE(x->>'amount'~'^[0-9]{1,14}([.][0-9]{1,2})?$',FALSE)) AS invalid_count
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.results->'contributions')='array' THEN d.results->'contributions' ELSE '[]'::jsonb END) x
 WHERE (f.fund='EPF' AND ((x->>'id'='statutory-employee-epf' AND x->>'party'='Employee') OR (x->>'id'='statutory-employer-epf' AND x->>'party'='Employer'))) OR (f.fund='ETF' AND x->>'id'='statutory-employer-etf' AND x->>'party'='Employer')
 ) p ON TRUE
 LEFT JOIN LATERAL(SELECT SUM(credit-debit) AS amount FROM ars_gl_lines WHERE shop_id=a.shop_id AND journal_id=a.journal_id AND account_code=m.account_code) l ON TRUE
 LEFT JOIN LATERAL(SELECT SUM(t.amount) AS amount,BOOL_OR(t.amount<=0 OR t.posting_date<a.posting_date OR NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=t.shop_id AND j.id=t.journal_id AND j.source_kind='StatutorySettlement' AND j.source_id=t.id AND j.posting_date=t.posting_date AND j.recorded_by=t.recorded_by) OR EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=t.shop_id AND j.source_kind='Reversal' AND j.source_id=t.journal_id) OR (SELECT COUNT(*) FROM ars_financial_movements v WHERE v.shop_id=t.shop_id AND v.movement_kind='Statutory Settlement' AND (v.id=t.journal_id OR v.source_id=t.id))<>1 OR NOT EXISTS(SELECT 1 FROM ars_financial_movements v WHERE v.shop_id=t.shop_id AND v.id=t.journal_id AND v.source_id=t.id AND v.account_id=t.financial_account_id AND v.amount=-t.amount AND v.movement_kind='Statutory Settlement' AND v.effective_date=t.posting_date AND v.recorded_by=t.recorded_by) OR NOT EXISTS(SELECT 1 FROM ars_gl_account_mappings b JOIN ars_gl_accounts g ON g.shop_id=b.shop_id AND g.code=b.account_code AND g.kind='Asset' JOIN ars_financial_accounts fa ON fa.shop_id=b.shop_id AND fa.id=b.source_id AND fa.kind='Bank' WHERE b.shop_id=t.shop_id AND b.mapping_kind='financialAccount' AND b.source_id=t.financial_account_id AND b.account_code<>m.account_code AND (SELECT COUNT(*) FROM ars_gl_lines l WHERE l.shop_id=t.shop_id AND l.journal_id=t.journal_id)=2 AND EXISTS(SELECT 1 FROM ars_gl_lines l WHERE l.shop_id=t.shop_id AND l.journal_id=t.journal_id AND l.account_code=m.account_code AND l.debit=t.amount AND l.credit=0) AND EXISTS(SELECT 1 FROM ars_gl_lines l WHERE l.shop_id=t.shop_id AND l.journal_id=t.journal_id AND l.account_code=b.account_code AND l.credit=t.amount AND l.debit=0))) AS invalid FROM ars_gl_statutory_settlements t WHERE t.shop_id=a.shop_id AND t.accrual_id=a.id AND t.fund=f.fund) t ON TRUE
 WHERE a.shop_id=$1
 ), checked AS (
 SELECT *,ARRAY_REMOVE(ARRAY[
 CASE WHEN NOT mapped THEN 'CONTROL_MAPPING' END,
 CASE WHEN NOT journal_valid OR reversed THEN 'ACCRUAL_JOURNAL' END,
 CASE WHEN NOT bound OR NOT detailed THEN 'STATUTORY_COVERAGE_UNVERIFIED' END,
 CASE WHEN employee_count<>CASE WHEN fund='EPF' THEN 1 ELSE 0 END OR employer_count<>1 OR invalid_count<>0 THEN 'CONTRIBUTION_COMPONENTS' END,
 CASE WHEN accrued<>employee+employer OR accrued<0 THEN 'ACCRUAL_AMOUNT' END,
 CASE WHEN settled>accrued OR settled<0 OR settlement_invalid THEN 'SETTLEMENT_AMOUNT_OR_EVIDENCE' END
 ],NULL) AS issues FROM contributions
 ), controls AS (
 SELECT m.fund,m.account_code,m.valid,
 COALESCE((SELECT SUM(l.credit-l.debit) FROM ars_gl_lines l WHERE l.shop_id=$1 AND l.account_code=m.account_code),0) AS ledger,
 COALESCE((SELECT SUM(c.employee+c.employer-c.settled) FROM checked c WHERE c.fund=m.fund),0) AS subledger,
 COALESCE((SELECT SUM(c.employee) FROM checked c WHERE c.fund=m.fund),0) AS employee,
 COALESCE((SELECT SUM(c.employer) FROM checked c WHERE c.fund=m.fund),0) AS employer,
 COALESCE((SELECT SUM(c.settled) FROM checked c WHERE c.fund=m.fund),0) AS settled,
 (SELECT COUNT(*) FROM checked c WHERE c.fund=m.fund AND cardinality(c.issues)>0)::integer AS exceptions
 FROM mappings m
 ), orphan AS (
 SELECT j.id,'ORPHAN_STATUTORY_JOURNAL' AS issue FROM ars_gl_journals j WHERE j.shop_id=$1 AND j.source_kind='StatutorySettlement' AND NOT EXISTS(SELECT 1 FROM ars_gl_statutory_settlements s WHERE s.shop_id=j.shop_id AND s.journal_id=j.id)
 UNION ALL SELECT v.id,'ORPHAN_STATUTORY_MOVEMENT' FROM ars_financial_movements v WHERE v.shop_id=$1 AND v.movement_kind='Statutory Settlement' AND NOT EXISTS(SELECT 1 FROM ars_gl_statutory_settlements s WHERE s.shop_id=v.shop_id AND s.journal_id=v.id AND s.id=v.source_id)
 )
 SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('fund',fund,'accountCode',account_code,'employee',employee::text,'employer',employer::text,'settled',settled::text,'ledgerBalance',ledger::text,'subledgerBalance',subledger::text,'difference',(ledger-subledger)::text,'exceptionCount',exceptions,'controlMatched',valid AND ledger=subledger AND subledger>=0 AND account_code IS NOT NULL AND (SELECT COUNT(*) FROM mappings other WHERE other.account_code=controls.account_code)=1) ORDER BY fund) FROM controls),'[]'::jsonb) AS controls,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'employeeName',employee_name,'period',period_key,'fund',fund,'journalId',journal_id,'issues',issues) ORDER BY period_key,id,fund) FROM checked WHERE cardinality(issues)>0),'[]'::jsonb) AS exceptions,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'issue',issue)) FROM orphan),'[]'::jsonb) AS unattributed
 `,[shopId]);
 const r=result.rows[0];
 return {scope:'Shop-wide, all recorded statutory obligations and settlements',controls:r.controls,exceptions:r.exceptions,unattributed:r.unattributed,checksPassed:r.controls.length===2&&r.controls.every((c:{controlMatched:boolean;exceptionCount:number})=>c.controlMatched===true&&c.exceptionCount===0)&&!r.exceptions.length&&!r.unattributed.length,postingEnabled:false as const};
}
