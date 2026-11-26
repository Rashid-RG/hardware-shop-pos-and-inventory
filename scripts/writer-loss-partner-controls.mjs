export const partnerControlSql="WITH partners AS (\n SELECT shop_id,id AS partner_id FROM ars_business_partners\n UNION SELECT shop_id,partner_id FROM ars_partner_capital_entries\n UNION SELECT shop_id,source_id FROM ars_gl_account_mappings WHERE mapping_kind IN ('partnerCapital','partnerDrawings')\n), kinds(kind,entry_type,sign) AS (VALUES ('partnerCapital','Contribution',-1),('partnerDrawings','Drawing',1)),\n controls AS (\n SELECT p.shop_id,p.partner_id,k.kind,\n EXISTS(SELECT 1 FROM ars_business_partners b WHERE b.shop_id=p.shop_id AND b.id=p.partner_id) AS known_partner,\n (SELECT coalesce(sum(e.amount_lkr*k.sign),0) FROM ars_partner_capital_entries e WHERE e.shop_id=p.shop_id AND e.partner_id=p.partner_id AND e.entry_type=k.entry_type) AS expected,\n (SELECT count(*) FROM ars_partner_capital_entries e WHERE e.shop_id=p.shop_id AND e.partner_id=p.partner_id AND e.entry_type=k.entry_type AND (e.amount_lkr<=0 OR NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=e.shop_id AND j.source_kind='PartnerCapital' AND j.source_id=e.id AND j.posting_date=e.entry_date AND j.recorded_by=e.created_by AND NOT EXISTS(SELECT 1 FROM ars_gl_journals r WHERE r.shop_id=j.shop_id AND r.source_kind='Reversal' AND r.source_id=j.id)))) AS exceptions\n FROM partners p CROSS JOIN kinds k\n)\nSELECT c.kind,\n CASE WHEN NOT c.known_partner THEN 'unknown-partner'\n WHEN g.posting_enabled IS NOT TRUE THEN 'posting-disabled'\n WHEN m.account_code IS NULL THEN 'unmapped'\n WHEN a.active IS NOT TRUE OR a.kind IS DISTINCT FROM 'Equity' OR (SELECT count(*) FROM ars_gl_account_mappings x WHERE x.shop_id=m.shop_id AND x.account_code=m.account_code)<>1 THEN 'mapping-review'\n WHEN c.exceptions>0 THEN 'entry-review'\n WHEN c.expected<>coalesce((SELECT sum(l.debit-l.credit) FROM ars_gl_lines l WHERE l.shop_id=c.shop_id AND l.account_code=m.account_code),0) THEN 'balance-difference'\n ELSE 'selected-balance-matches' END AS status\nFROM controls c LEFT JOIN ars_gl_cutover g ON g.shop_id=c.shop_id\nLEFT JOIN ars_gl_account_mappings m ON m.shop_id=c.shop_id AND m.mapping_kind=c.kind AND m.source_id=c.partner_id\nLEFT JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code\nORDER BY c.shop_id,c.partner_id,c.kind LIMIT 10001";

const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,externalDocumentsReconciled:false,continuousExclusionVerified:false};
export function summarizePartnerControls(rows){
 const statuses=['unknown-partner','posting-disabled','unmapped','mapping-review','entry-review','balance-difference','selected-balance-matches'];
 if(!Array.isArray(rows)||rows.length>10000||rows.some(r=>!statuses.includes(r.status)||!['partnerCapital','partnerDrawings'].includes(r.kind)))throw Error('Invalid partner control results.');
 const counts=Object.fromEntries(statuses.map(s=>[s,0]));
 for(const r of rows)counts[r.status]++;
 return {state:!rows.length?'no-coverage':counts['selected-balance-matches']===rows.length?'selected-partner-balances-matched':'partner-control-review-required',counts,compared:rows.length,...blocked};
}
export async function inspectRecoveryPartnerControls(client,expected,sharedSnapshot=false){
 let begun=false;
 try{
  if(!['hardware_pos','hardware_pos_ars','hardware_pos_ci'].includes(expected?.database)||!/^[0-9]{1,20}$/.test(expected?.systemIdentifier??'')||!/^[0-9]{1,10}$/.test(expected?.databaseOid??''))throw Error('Trusted identity required.');
  if(!sharedSnapshot){await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;}
  await client.query("SET LOCAL statement_timeout='10000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'");
  const r=await client.query("SELECT current_database() AS database,system_identifier::text AS system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('transaction_read_only')='on' AS read_only,current_setting('transaction_isolation')='repeatable read' AS snapshot FROM pg_control_system()");
  const a=r.rows[0];
  if(r.rows.length!==1||a.database!==expected.database||a.system_identifier!==expected.systemIdentifier||a.database_oid!==expected.databaseOid||a.read_only!==true||a.snapshot!==true)throw Error('Identity mismatch.');
  const report=summarizePartnerControls((await client.query(partnerControlSql)).rows);
  if(!sharedSnapshot){await client.query('ROLLBACK');begun=false;}
  return report;
 }catch(error){if(sharedSnapshot)throw error;return {state:'partner-control-inspection-unavailable',...blocked};}
 finally{if(begun)await client.query('ROLLBACK').catch(()=>{});}
}
