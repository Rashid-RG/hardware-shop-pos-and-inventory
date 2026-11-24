import type {PoolClient} from 'pg';
import {moneyCents} from './generalLedger';

/** Caller must hold invoice lock for the entire return transaction.
 * This verifies original totals only; invoice-specific receivable allocation
 * and historical discount distribution must be reconciled separately. */
export async function reconcileOriginalSale(c:PoolClient,shopId:string,invoiceId:string,date:string){
 const invoice=(await c.query(`SELECT *,total::text AS total_text,tax::text AS tax_text,(date AT TIME ZONE 'Asia/Colombo')::date::text AS day FROM sales_transactions WHERE shop_id=$1 AND id=$2 FOR UPDATE`,[shopId,invoiceId])).rows[0];
 if(!invoice||invoice.status!=='Completed'||invoice.day>date||!invoice.customer_id||invoice.customer_id==='cust-walkin')throw Error('Completed named-customer invoice required.');
 const journal=(await c.query("SELECT id,posting_date::text AS day FROM ars_gl_journals WHERE shop_id=$1 AND source_kind='Sale' AND source_id=$2",[shopId,invoiceId])).rows[0];
 if(!journal||journal.day!==invoice.day)throw Error('Original invoice journal requires reconciliation.');
 const items=(await c.query('SELECT *,cost_price::text AS cost_text FROM sales_transaction_items WHERE transaction_id=$1 ORDER BY id FOR SHARE',[invoiceId])).rows;
 if(!items.length)throw Error('Original invoice lines required.');
 let cost=0n;
 for(const item of items){
 const qty=Number(item.quantity),factor=Number(item.base_units_per_sale_unit??1);
 if(!Number.isSafeInteger(qty)||qty<=0||!Number.isSafeInteger(factor)||factor<=0||!Number.isSafeInteger(qty*factor))throw Error('Invalid original sale quantity.');
 if((item.selling_unit_id||item.base_units_per_sale_unit!=null)&&(!item.selling_unit_id||!item.base_units_per_sale_unit||item.variant_id))throw Error('Incomplete original packaging snapshot.');
 cost+=moneyCents(item.cost_text)*BigInt(qty);
 }
 const total=moneyCents(invoice.total_text),tax=moneyCents(invoice.tax_text);
 if(total<=0n||tax>total||cost<=0n)throw Error('Original invoice values require reconciliation.');
 const mappings=(await c.query("SELECT m.mapping_kind,a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.source_id='control' AND a.active",[shopId])).rows;
 const lines=(await c.query('SELECT account_code,debit::text,credit::text FROM ars_gl_lines WHERE shop_id=$1 AND journal_id=$2',[shopId,journal.id])).rows;
 const net=(kind:string)=>{const m=mappings.find(x=>x.mapping_kind===kind);if(!m)throw Error('Missing original sale mapping: '+kind);return lines.filter(x=>x.account_code===m.code).reduce((n,x)=>n+moneyCents(x.debit)-moneyCents(x.credit),0n);};
 if(net('sales')!==-(total-tax)||net('inventory')!==-cost||net('costOfGoods')!==cost||(tax>0n&&net('tax')!==-tax))throw Error('Original invoice totals do not match posted journal.');
 return {invoice,journalId:journal.id,items,total,tax,cost,netRevenue:total-tax};
}
