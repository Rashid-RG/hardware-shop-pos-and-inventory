import type {Pool} from 'pg';

export async function supplierReconciliation(db:Pool,shopId:string,poId:string){
 if(!shopId||!poId||poId.length>200)throw Error('Valid purchase order required.');
 const client=await db.connect();
 try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const order=(await client.query('SELECT id,po_number,supplier_name,status,total::text FROM purchase_orders WHERE shop_id=$1 AND id=$2',[shopId,poId])).rows[0];
 if(!order)throw Error('Purchase order not found.');
 const config=(await client.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1',[shopId])).rows[0];
 const mapping=(await client.query("SELECT m.mapping_kind,a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.source_id='control' AND a.active AND ((m.mapping_kind='supplierAdvances' AND a.kind='Asset') OR (m.mapping_kind='supplierPayables' AND a.kind='Liability'))",[shopId])).rows;
 const a=mapping.find(r=>r.mapping_kind==='supplierAdvances')?.code,p=mapping.find(r=>r.mapping_kind==='supplierPayables')?.code;
 const coverage=(await client.query(`SELECT
 (SELECT count(*)::int FROM supplier_payments s WHERE s.shop_id=$1 AND s.purchase_order_id=$2 AND NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=s.shop_id AND j.source_kind='SupplierPayment' AND j.source_id=s.id)) AS "unpostedPayments",
 (SELECT COALESCE(sum(amount),0)::numeric(24,2)::text FROM supplier_payments WHERE shop_id=$1 AND purchase_order_id=$2) AS "recordedPayments",
 (SELECT count(*)::int FROM ars_receipt_batches b WHERE b.shop_id=$1 AND b.purchase_order_id=$2 AND NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=b.shop_id AND j.source_kind='ReceiptBatch' AND j.source_id=b.id)) AS "unpostedBatches",
 EXISTS(SELECT 1 FROM ars_gl_journals WHERE shop_id=$1 AND source_kind='PurchaseReceipt' AND source_id=$2) AS "fullReceiptPosted",
 (SELECT count(*)::int FROM ars_receipt_batches WHERE shop_id=$1 AND purchase_order_id=$2) AS "receiptBatches"`,[shopId,poId])).rows[0];
 const warnings:string[]=[];
 if(!config?.posting_enabled)warnings.push('Accounting posting is disabled.');
 if(!a||!p||a===p)warnings.push('Distinct active supplier control mappings required.');
 if(coverage.unpostedPayments)warnings.push('Supplier payments exist without linked journals.');
 if(coverage.unpostedBatches)warnings.push('Warehouse receipts exist without linked journals.');
 if(order.status==='Received'&&!coverage.receiptBatches&&!coverage.fullReceiptPosted)warnings.push('Full purchase receipt journal missing.');
 if(coverage.receiptBatches&&coverage.fullReceiptPosted)warnings.push('Mixed full and partial receipt history requires review.');
 let advance:string|null=null,payable:string|null=null;
 if(a&&p&&a!==p){
 const rows=(await client.query(`SELECT COALESCE(sum(l.debit-l.credit) FILTER(WHERE l.account_code=$3),0)::numeric(24,2)::text AS advance,
 COALESCE(sum(l.credit-l.debit) FILTER(WHERE l.account_code=$4),0)::numeric(24,2)::text AS payable
 FROM ars_gl_journals j JOIN ars_gl_lines l ON l.shop_id=j.shop_id AND l.journal_id=j.id
 WHERE j.shop_id=$1 AND ((j.source_kind='SupplierPayment' AND EXISTS(SELECT 1 FROM supplier_payments s WHERE s.shop_id=$1 AND s.id=j.source_id AND s.purchase_order_id=$2))
 OR (j.source_kind='PurchaseReceipt' AND j.source_id=$2) OR (j.source_kind='ReceiptBatch' AND EXISTS(SELECT 1 FROM ars_receipt_batches b WHERE b.shop_id=$1 AND b.id=j.source_id AND b.purchase_order_id=$2)))`,[shopId,poId,a,p])).rows[0];
 advance=rows.advance;payable=rows.payable;
 if(Number(advance)<0||Number(payable)<0||(Number(advance)>0&&Number(payable)>0))warnings.push('Unexpected control balances require investigation.');
 }
 await client.query('COMMIT');
 return {order,coverage,advance,payable,postingEnabled:!!config?.posting_enabled,cutoverDate:config?.day??null,warnings,complete:false,operationallyReconciled:false,note:'Order-linked journal balances only. Opening balances, supplier statements, returns and landed charges are not independently reconciled.'};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
