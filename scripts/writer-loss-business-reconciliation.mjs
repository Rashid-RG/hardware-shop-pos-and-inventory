// First independent structural reconciliation pass. Read-only, no repair or clearance.
export const recoveryChecks=Object.freeze({
 emptyCompletedInvoices:"SELECT count(*)::text AS n FROM sales_transactions t WHERE t.status='Completed' AND NOT EXISTS(SELECT 1 FROM sales_transaction_items i WHERE i.transaction_id=t.id)",
 invalidInvoiceLines:"SELECT count(*)::text AS n FROM sales_transaction_items WHERE quantity<=0 OR selling_price<0 OR discount_amount<0",
 negativeInvoiceAmounts:"SELECT count(*)::text AS n FROM sales_transactions WHERE subtotal<0 OR tax<0 OR discount_amount<0 OR total<0",
 customerPaymentReferences:"SELECT count(*)::text AS n FROM customer_credit_payments p WHERE p.amount<=0 OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=p.customer_id AND c.shop_id IS NOT DISTINCT FROM p.shop_id) OR (p.invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sales_transactions t WHERE t.id=p.invoice_id AND t.shop_id IS NOT DISTINCT FROM p.shop_id AND t.customer_id=p.customer_id))",
 supplierPaymentReferences:"SELECT count(*)::text AS n FROM supplier_payments p WHERE p.amount<=0 OR NOT EXISTS(SELECT 1 FROM suppliers s WHERE s.id=p.supplier_id AND s.shop_id IS NOT DISTINCT FROM p.shop_id) OR (p.purchase_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_orders o WHERE o.id=p.purchase_order_id AND o.shop_id IS NOT DISTINCT FROM p.shop_id AND o.supplier_id=p.supplier_id))",
 negativeProductStock:"SELECT count(*)::text AS n FROM products WHERE quantity<0",
 stockLogReferences:"SELECT count(*)::text AS n FROM stock_logs l WHERE NOT EXISTS(SELECT 1 FROM products p WHERE p.id=l.product_id AND p.shop_id IS NOT DISTINCT FROM l.shop_id)",
 unbalancedJournals:"SELECT count(*)::text AS n FROM (SELECT j.shop_id,j.id FROM ars_gl_journals j LEFT JOIN ars_gl_lines l ON l.shop_id=j.shop_id AND l.journal_id=j.id GROUP BY j.shop_id,j.id HAVING count(l.line_no)<2 OR count(l.line_no)>500 OR coalesce(sum(l.debit),0)<=0 OR coalesce(sum(l.debit),0)<>coalesce(sum(l.credit),0)) invalid",
 invalidJournalLines:"SELECT count(*)::text AS n FROM ars_gl_lines l WHERE l.debit IS NULL OR l.credit IS NULL OR NOT ((l.debit>0 AND l.credit=0) OR (l.credit>0 AND l.debit=0)) OR NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=l.shop_id AND j.id=l.journal_id) OR NOT EXISTS(SELECT 1 FROM ars_gl_accounts a WHERE a.shop_id=l.shop_id AND a.code=l.account_code)"
});
const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,externalDocumentsReconciled:false,continuousExclusionVerified:false};
export async function inspectRecoveryBusinessRecords(client,expected){
 let begun=false;
 try{
  if(!['hardware_pos','hardware_pos_ars','hardware_pos_ci'].includes(expected?.database)||!/^[0-9]{1,20}$/.test(expected?.systemIdentifier??'')||!/^[0-9]{1,10}$/.test(expected?.databaseOid??''))throw Error('Trusted identity required.');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  await client.query("SET LOCAL statement_timeout='10000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'");
  const identity=await client.query("SELECT current_database() AS database, system_identifier::text AS system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('transaction_read_only')='on' AS read_only,current_setting('transaction_isolation')='repeatable read' AS snapshot FROM pg_control_system()");
  const a=identity.rows[0];
  if(identity.rows.length!==1||a.database!==expected.database||a.system_identifier!==expected.systemIdentifier||a.database_oid!==expected.databaseOid||a.read_only!==true||a.snapshot!==true)throw Error('Database identity or snapshot mismatch.');
  const checks={};
  for(const [key,sql] of Object.entries(recoveryChecks)){
   const result=await client.query(sql);
   const n=result.rows[0]?.n;
   if(result.rows.length!==1||typeof n!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(n))throw Error('Invalid reconciliation count.');
   checks[key]=n;
  }
  await client.query('ROLLBACK');begun=false;
  return {state:Object.values(checks).every(n=>n==='0')?'structural-checks-matched':'exceptions-detected',checks,...blocked};
 }catch{return {state:'reconciliation-unavailable',...blocked};}
 finally{if(begun)await client.query('ROLLBACK').catch(()=>{});}
}
