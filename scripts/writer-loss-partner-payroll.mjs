export const partnerPayrollSql="SELECT\n (SELECT count(*)::text FROM ars_partner_capital_entries e WHERE NOT EXISTS(SELECT 1 FROM ars_business_partners p WHERE p.shop_id=e.shop_id AND p.id=e.partner_id) OR e.amount_lkr<=0 OR e.entry_type NOT IN ('Contribution','Drawing')) AS invalid_capital,\n (SELECT count(*)::text FROM ars_partner_capital_entries e WHERE NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=e.shop_id AND j.source_kind='PartnerCapital' AND j.source_id=e.id)) AS capital_without_journal,\n (SELECT count(*)::text FROM ars_partner_profit_allocations a WHERE (SELECT coalesce(sum(s.allocated_lkr),0) FROM ars_partner_profit_shares s WHERE s.allocation_id=a.id)<>a.approved_profit_lkr OR (SELECT coalesce(sum(s.ownership_basis_points),0) FROM ars_partner_profit_shares s WHERE s.allocation_id=a.id)<>10000 OR EXISTS(SELECT 1 FROM ars_partner_profit_shares s WHERE s.allocation_id=a.id AND NOT EXISTS(SELECT 1 FROM ars_business_partners p WHERE p.shop_id=a.shop_id AND p.id=s.partner_id))) AS profit_allocation_exceptions,\n (SELECT count(*)::text FROM ars_gl_salary_payments p WHERE p.amount<=0 OR NOT EXISTS(SELECT 1 FROM ars_gl_payroll_accruals a WHERE a.shop_id=p.shop_id AND a.id=p.accrual_id) OR NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=p.shop_id AND j.id=p.journal_id AND j.source_kind='SalaryPayment' AND j.source_id=p.id)) AS salary_payment_exceptions,\n (SELECT count(*)::text FROM ars_gl_employee_advance_recoveries r WHERE r.amount<=0 OR NOT EXISTS(SELECT 1 FROM ars_gl_employee_advance_disbursements d WHERE d.shop_id=r.shop_id AND d.id=r.disbursement_id AND d.employee_id=r.employee_id)) AS advance_recovery_exceptions,\n (SELECT count(*)::text FROM ars_gl_statutory_settlements t WHERE t.amount<=0 OR t.fund NOT IN ('EPF','ETF') OR NOT EXISTS(SELECT 1 FROM ars_gl_payroll_accruals a WHERE a.shop_id=t.shop_id AND a.id=t.accrual_id) OR NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=t.shop_id AND j.id=t.journal_id AND j.source_kind='StatutorySettlement' AND j.source_id=t.id)) AS statutory_settlement_exceptions";

const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,externalDocumentsReconciled:false};
const keys=['invalid_capital','capital_without_journal','profit_allocation_exceptions','salary_payment_exceptions','advance_recovery_exceptions','statutory_settlement_exceptions'];
export function summarizePartnerPayroll(row){
 if(!row||!keys.every(k=>typeof row[k]==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(row[k])))throw Error('Invalid reconciliation counts.');
 const checks=Object.fromEntries(keys.map(k=>[k,row[k]]));
 return {state:Object.values(checks).every(n=>n==='0')?'selected-links-matched':'partner-payroll-review-required',checks,...blocked};
}
export async function inspectRecoveryPartnerPayroll(client,expected){
 let begun=false;
 try{
  if(!['hardware_pos','hardware_pos_ars','hardware_pos_ci'].includes(expected?.database)||!/^[0-9]{1,20}$/.test(expected?.systemIdentifier??'')||!/^[0-9]{1,10}$/.test(expected?.databaseOid??''))throw Error('Trusted identity required.');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  await client.query("SET LOCAL statement_timeout='10000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'");
  const r=await client.query("SELECT current_database() AS database,system_identifier::text AS system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('transaction_read_only')='on' AS read_only,current_setting('transaction_isolation')='repeatable read' AS snapshot FROM pg_control_system()");
  const a=r.rows[0];
  if(r.rows.length!==1||a.database!==expected.database||a.system_identifier!==expected.systemIdentifier||a.database_oid!==expected.databaseOid||a.read_only!==true||a.snapshot!==true)throw Error('Identity mismatch.');
  const result=await client.query(partnerPayrollSql);
  if(result.rows.length!==1)throw Error('Unexpected result.');
  const report=summarizePartnerPayroll(result.rows[0]);
  await client.query('ROLLBACK');begun=false;
  return report;
 }catch{return {state:'partner-payroll-inspection-unavailable',...blocked};}
 finally{if(begun)await client.query('ROLLBACK').catch(()=>{});}
}
