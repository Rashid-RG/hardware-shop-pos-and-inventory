import type {PoolClient} from 'pg';
import {moneyCents,type JournalLine} from './generalLedger';

export const decimal=(n:bigint)=>(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');
export function allocateSupplierPayment(amount:bigint,payable:bigint){
 if(amount<=0n||payable<0n)throw Error('Invalid supplier payment allocation.');
 const applied=amount<payable?amount:payable;
 return {applied,advance:amount-applied};
}
export function allocateSupplierReceipt(amount:bigint,advance:bigint){
 if(amount<=0n||advance<0n)throw Error('Invalid supplier receipt allocation.');
 const applied=amount<advance?amount:advance;
 return {applied,payable:amount-applied};
}
export async function supplierControl(client:PoolClient,shopId:string,kind:'supplierAdvances'|'supplierPayables'){
 const r=(await client.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id='control' AND a.active AND a.kind=$3 FOR SHARE OF a",[shopId,kind,kind==='supplierAdvances'?'Asset':'Liability'])).rows[0];
 if(!r)throw Error('Missing supplier accounting mapping: '+kind);
 return r.code as string;
}
/** Caller holds the purchase order row lock. Historical or unmatched payments are not silently backfilled. */
export async function supplierOrderBalances(client:PoolClient,shopId:string,poId:string,excludePayment?:string){
 const po=(await client.query('SELECT id FROM purchase_orders WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,poId])).rows[0];
 if(!po)throw Error('Supplier order not found.');
 const missing=await client.query("SELECT 1 FROM supplier_payments p WHERE p.shop_id=$1 AND p.purchase_order_id=$2 AND ($3::text IS NULL OR p.id<>$3) AND NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=p.shop_id AND j.source_kind='SupplierPayment' AND j.source_id=p.id) LIMIT 1",[shopId,poId,excludePayment??null]);
 if(missing.rowCount)throw Error('Historical supplier payments require reconciliation.');
 const a=await supplierControl(client,shopId,'supplierAdvances'),p=await supplierControl(client,shopId,'supplierPayables');
 const rows=(await client.query(`SELECT l.account_code,COALESCE(SUM(l.debit-l.credit),0)::numeric(24,2)::text AS net
 FROM ars_gl_journals j JOIN ars_gl_lines l ON l.shop_id=j.shop_id AND l.journal_id=j.id
 WHERE j.shop_id=$1 AND l.account_code=ANY($3::text[]) AND (
 (j.source_kind='SupplierPayment' AND EXISTS(SELECT 1 FROM supplier_payments s WHERE s.shop_id=$1 AND s.id=j.source_id AND s.purchase_order_id=$2))
 OR (j.source_kind='PurchaseReceipt' AND j.source_id=$2)
 OR (j.source_kind='SupplierReturnRefund' AND EXISTS(SELECT 1 FROM ars_gl_supplier_refunds f JOIN ars_gl_purchase_returns h ON h.shop_id=f.shop_id AND h.id=f.return_id WHERE f.shop_id=$1 AND f.id=j.source_id AND h.purchase_order_id=$2))
 OR (j.source_kind='PurchaseReturn' AND EXISTS(SELECT 1 FROM ars_gl_purchase_returns h WHERE h.shop_id=$1 AND h.id=j.source_id AND h.purchase_order_id=$2))
 OR (j.source_kind='ReceiptBatch' AND EXISTS(SELECT 1 FROM ars_receipt_batches b WHERE b.shop_id=$1 AND b.id=j.source_id AND b.purchase_order_id=$2)))
 GROUP BY l.account_code`,[shopId,poId,[a,p]])).rows;
 const signed=(s:string)=>BigInt(s.replace('.',''));
 const advance=signed(rows.find(r=>r.account_code===a)?.net||'0.00'),payable=-signed(rows.find(r=>r.account_code===p)?.net||'0.00');
 if(advance<0n||payable<0n||(advance>0n&&payable>0n))throw Error('Supplier balances require reconciliation.');
 return {advance,payable,advanceAccount:a,payableAccount:p};
}
export async function supplierReceiptCredits(client:PoolClient,shopId:string,poId:string,amount:bigint):Promise<JournalLine[]>{
 const b=await supplierOrderBalances(client,shopId,poId);
 const allocation=allocateSupplierReceipt(amount,b.advance);
 return [...(allocation.applied>0n?[{accountCode:b.advanceAccount,debit:'0.00',credit:decimal(allocation.applied)}]:[]),...(allocation.payable>0n?[{accountCode:b.payableAccount,debit:'0.00',credit:decimal(allocation.payable)}]:[])];
}
