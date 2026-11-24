import type {PoolClient} from 'pg';
import {buildSalesJournal} from './salesJournal';
import {postJournal} from './ledgerPosting';
import {moneyCents} from './generalLedger';

/** Internal transaction adapter. Never call outside the invoice transaction.
 * Production activation remains unavailable until all operational events are covered. */
export async function postInvoiceJournal(client:PoolClient,shopId:string,invoiceId:string,actor:string){
 const config=(await client.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[shopId])).rows[0];
 if(!config?.posting_enabled)return {posted:false};
 if(!actor?.trim())throw Error('Authenticated invoice actor required for accounting.');
 const invoice=(await client.query(`SELECT id,invoice_number,customer_id,total::text,tax::text,payment_method,payment_status,status,
 (date AT TIME ZONE 'Asia/Colombo')::date::text AS day FROM sales_transactions WHERE shop_id=$1 AND id=$2`,[shopId,invoiceId])).rows[0];
 if(!invoice||invoice.status!=='Completed'||invoice.day<config.day)throw Error('Invoice cannot be posted to the general ledger.');
 const mapping=async(kind:string,source:string,classification:string)=>{
 const r=(await client.query('SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id=$3 AND a.kind=$4 AND a.active FOR SHARE OF a',[shopId,kind,source,classification])).rows[0];
 if(!r)throw Error('Missing active accounting mapping: '+kind);
 return r.code as string;
 };
 let destination:string;
 if(invoice.payment_method==='Credit Account'){
 if(!invoice.customer_id||invoice.customer_id==='cust-walkin')throw Error('Credit invoice requires a customer.');
 // A customer with a pre-existing credit liability requires allocation, not a full receivable debit.
 const c=(await client.query('SELECT credit_balance::text AS balance FROM customers WHERE shop_id=$1 AND id=$2 FOR SHARE',[shopId,invoice.customer_id])).rows[0];
 if(!c||c.balance.startsWith('-')||moneyCents(c.balance)<moneyCents(invoice.total))throw Error('Customer credit allocation requires separate accounting integration.');
 destination=await mapping('receivables','control','Asset');
 }else if(['Cash','Bank Transfer'].includes(invoice.payment_method)&&invoice.payment_status==='PAID'){
 const movements=(await client.query("SELECT m.account_id,m.amount::text,a.kind,a.active FROM ars_financial_movements m JOIN ars_financial_accounts a ON a.shop_id=m.shop_id AND a.id=m.account_id WHERE m.shop_id=$1 AND m.source_id=$2 AND m.movement_kind='Invoice Payment'",[shopId,invoiceId])).rows;
 if(movements.length!==1||!movements[0].active||moneyCents(movements[0].amount)!==moneyCents(invoice.total)||movements[0].kind!==(invoice.payment_method==='Cash'?'Office Cash':'Bank'))throw Error('Verified immediate invoice payment required for accounting.');
 destination=await mapping('financialAccount',movements[0].account_id,'Asset');
 }else throw Error('Invoice payment method not supported by accounting integration.');
 const items=(await client.query('SELECT quantity,cost_price::text AS cost FROM sales_transaction_items WHERE transaction_id=$1 ORDER BY id',[invoiceId])).rows;
 const lines=buildSalesJournal({total:invoice.total,tax:invoice.tax,items:items.map(i=>({quantity:Number(i.quantity),costPerSellingUnit:i.cost}))},{
 destination,sales:await mapping('sales','control','Revenue'),tax:moneyCents(invoice.tax)>0n?await mapping('tax','control','Liability'):'',
 inventory:await mapping('inventory','control','Asset'),costOfGoods:await mapping('costOfGoods','control','Expense')});
 const result=await postJournal(client,{id:'sale:'+invoiceId,shopId,postingDate:invoice.day,sourceKind:'Sale',sourceId:invoiceId,description:'Wholesale invoice '+invoice.invoice_number,actor,lines});
 return {posted:true,...result};
}
