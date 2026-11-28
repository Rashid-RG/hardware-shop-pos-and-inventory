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

/** Reconcile the original receivable debit, linked posted collections and prior
 * return reductions. Caller must hold the invoice lock, then customer lock,
 * matching collection lock ordering. Unallocated payments require review. */
export async function reconcileReturnReceivable(c:PoolClient,shopId:string,invoiceId:string,date:string){
 const original=await reconcileOriginalSale(c,shopId,invoiceId,date);
 const customerId=original.invoice.customer_id;
 const customer=(await c.query('SELECT credit_balance::text AS balance FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,customerId])).rows[0];
 if(!customer)throw Error('Customer account requires reconciliation.');
 const mapping=(await c.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind='receivables' AND m.source_id='control' AND a.active AND a.kind='Asset' FOR SHARE OF a",[shopId])).rows[0];
 if(!mapping)throw Error('Active receivables mapping required.');
 const net=(async(journalId:string)=>{
 const rows=(await c.query('SELECT debit::text,credit::text FROM ars_gl_lines WHERE shop_id=$1 AND journal_id=$2 AND account_code=$3',[shopId,journalId,mapping.code])).rows;
 return rows.reduce((n,r)=>n+moneyCents(r.debit)-moneyCents(r.credit),0n);
 });
 const initial=await net(original.journalId);
 if(initial<0n||initial>original.total||(original.invoice.payment_method!=='Credit Account'&&initial!==0n))throw Error('Original invoice receivable requires reconciliation.');
 const unallocated=(await c.query('SELECT 1 FROM customer_credit_payments WHERE shop_id=$1 AND customer_id=$2 AND invoice_id IS NULL LIMIT 1',[shopId,customerId])).rowCount;
 if(unallocated)throw Error('Historical unallocated payments require reconciliation.');
 const payments=(await c.query(`SELECT p.customer_id,p.amount::text AS amount,p.date::text AS day,j.id AS journal_id,j.posting_date::text AS posted_day FROM customer_credit_payments p LEFT JOIN ars_gl_journals j ON j.shop_id=p.shop_id AND j.source_kind='CustomerCollection' AND j.source_id=p.id WHERE p.shop_id=$1 AND p.invoice_id=$2`,[shopId,invoiceId])).rows;
 let paid=0n;
 for(const p of payments){
 const amount=moneyCents(p.amount);
 if(p.customer_id!==customerId||!p.journal_id||p.day<original.invoice.day||p.day>date||p.posted_day!==p.day||amount<=0n||await net(p.journal_id)!==-amount)throw Error('Invoice payment history requires reconciliation.');
 paid+=amount;
 }
 const returns=(await c.query(`SELECT r.customer_id,r.return_date::text AS day,r.receivable_reduction::text AS reduction,r.original_journal_id,j.id AS journal_id,j.posting_date::text AS posted_day FROM ars_gl_sales_returns r LEFT JOIN ars_gl_journals j ON j.shop_id=r.shop_id AND j.id=r.journal_id AND j.source_kind='SalesReturn' AND j.source_id=r.id WHERE r.shop_id=$1 AND r.invoice_id=$2`,[shopId,invoiceId])).rows;
 let returned=0n;
 for(const r of returns){
 const reduction=moneyCents(r.reduction);
 if(r.customer_id!==customerId||r.original_journal_id!==original.journalId||!r.journal_id||r.day<original.invoice.day||r.day>date||r.posted_day!==r.day||await net(r.journal_id)!==-reduction)throw Error('Sales return history requires reconciliation.');
 returned+=reduction;
 }
 const outstanding=initial-paid-returned;
 const balance=customer.balance.startsWith('-')?-moneyCents(customer.balance.slice(1)):moneyCents(customer.balance);
 if(outstanding<0n||(outstanding>0n&&outstanding>balance))throw Error('Customer receivable requires reconciliation.');
 return {...original,customerId,receivablesAccount:mapping.code as string,initialReceivable:initial,verifiedPayments:paid,previousReceivableReductions:returned,outstandingReceivable:outstanding,customerBalance:balance};
}
