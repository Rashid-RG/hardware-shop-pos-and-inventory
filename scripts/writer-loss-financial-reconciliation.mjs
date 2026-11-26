// Read-only internal control comparison; not external statement reconciliation.
export const controlComparisonSql = "WITH shops AS (\n SELECT shop_id FROM customers UNION SELECT shop_id FROM ars_financial_accounts UNION SELECT shop_id FROM ars_gl_cutover UNION SELECT shop_id FROM ars_gl_accounts\n), operational AS (\n SELECT s.shop_id,'receivables'::text AS kind,'control'::text AS source,'Asset'::text AS classification,coalesce(sum(greatest(c.credit_balance,0)),0) AS balance\n FROM shops s LEFT JOIN customers c ON c.shop_id IS NOT DISTINCT FROM s.shop_id GROUP BY s.shop_id\n UNION ALL\n SELECT s.shop_id,'customerCredits','control','Liability',coalesce(sum(least(c.credit_balance,0)),0) FROM shops s LEFT JOIN customers c ON c.shop_id IS NOT DISTINCT FROM s.shop_id GROUP BY s.shop_id\n UNION ALL\n SELECT a.shop_id,'financialAccount',a.id,'Asset',coalesce(sum(m.amount),0)\n FROM ars_financial_accounts a LEFT JOIN ars_financial_movements m ON m.shop_id=a.shop_id AND m.account_id=a.id\n WHERE a.kind IN ('Office Cash','Bank','Representative Cash') GROUP BY a.shop_id,a.id\n), ledger AS (\n SELECT shop_id,account_code,sum(debit-credit) AS balance FROM ars_gl_lines GROUP BY shop_id,account_code\n), comparisons AS (\n SELECT o.*,m.account_code,a.kind AS actual_kind,a.active,c.posting_enabled,coalesce(l.balance,0) AS ledger_balance,\n (SELECT count(*) FROM ars_gl_account_mappings x WHERE x.shop_id=m.shop_id AND x.account_code=m.account_code) AS mapping_count\n FROM operational o LEFT JOIN ars_gl_account_mappings m ON m.shop_id=o.shop_id AND m.mapping_kind=o.kind AND m.source_id=o.source\n LEFT JOIN ars_gl_accounts a ON a.shop_id=o.shop_id AND a.code=m.account_code\n LEFT JOIN ars_gl_cutover c ON c.shop_id=o.shop_id\n LEFT JOIN ledger l ON l.shop_id=o.shop_id AND l.account_code=m.account_code\n)\nSELECT shop_id,kind,source,account_code,balance::text AS operational_balance,\n CASE WHEN account_code IS NOT NULL THEN ledger_balance::text END AS ledger_balance,\n CASE WHEN posting_enabled IS NOT TRUE THEN 'posting-disabled'\n WHEN account_code IS NULL THEN 'unmapped'\n WHEN active IS NOT TRUE OR actual_kind IS DISTINCT FROM classification OR mapping_count<>1 THEN 'mapping-review'\n WHEN balance<>ledger_balance THEN 'mismatch' ELSE 'matched' END AS status\nFROM comparisons ORDER BY shop_id,kind,source LIMIT 10001";

const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,externalDocumentsReconciled:false,continuousExclusionVerified:false};
export function summarizeControlComparison(rows){
 if(!Array.isArray(rows)||rows.length>10000||rows.some(r=>!['matched','mismatch','unmapped','mapping-review','posting-disabled'].includes(r.status)))throw Error('Invalid or oversized control results.');
 const counts={matched:0,mismatch:0,unmapped:0,'mapping-review':0,'posting-disabled':0};
 for(const r of rows)counts[r.status]++;
 return {state:!rows.length?'no-coverage':counts.matched===rows.length?'selected-controls-matched':'control-review-required',counts,compared:rows.length,excludedControls:['supplierPayables','inventory','partnerCapital','settlementAccounts','payroll','tax'],...blocked};
}
export async function inspectRecoveryFinancialControls(client,expected,sharedSnapshot=false){
 let begun=false;
 try{
  if(!['hardware_pos','hardware_pos_ars','hardware_pos_ci'].includes(expected?.database)||!/^[0-9]{1,20}$/.test(expected?.systemIdentifier??'')||!/^[0-9]{1,10}$/.test(expected?.databaseOid??''))throw Error('Trusted identity required.');
  if(!sharedSnapshot){await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;}
  await client.query("SET LOCAL statement_timeout='10000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'");
  const result=await client.query("SELECT current_database() AS database, system_identifier::text AS system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('transaction_read_only')='on' AS read_only,current_setting('transaction_isolation')='repeatable read' AS snapshot FROM pg_control_system()");
  const a=result.rows[0];
  if(result.rows.length!==1||a.database!==expected.database||a.system_identifier!==expected.systemIdentifier||a.database_oid!==expected.databaseOid||a.read_only!==true||a.snapshot!==true)throw Error('Database identity mismatch.');
  const report=summarizeControlComparison((await client.query(controlComparisonSql)).rows);
  if(!sharedSnapshot){await client.query('ROLLBACK');begun=false;}
  return report;
 }catch(error){if(sharedSnapshot)throw error;return {state:'control-inspection-unavailable',...blocked};}
 finally{if(begun)await client.query('ROLLBACK').catch(()=>{});}
}
