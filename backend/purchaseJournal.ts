import type {PoolClient} from 'pg';
import {moneyCents} from './generalLedger';
import {postJournal,reverseJournal} from './ledgerPosting';

async function config(client:PoolClient,shopId:string){
 return (await client.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[shopId])).rows[0];
}
async function mapping(client:PoolClient,shopId:string,kind:string,classification:string){
 const row=(await client.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id='control' AND a.kind=$3 AND a.active FOR SHARE OF a",[shopId,kind,classification])).rows[0];
 if(!row)throw Error('Missing active accounting mapping: '+kind);
 return row.code as string;
}
const decimal=(n:bigint)=>(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');

/** Legacy full domestic receipt only. Reject advance, landed cost and valuation differences. */
export async function postPurchaseReceipt(client:PoolClient,shopId:string,poId:string,actor:string){
 const c=await config(client,shopId);if(!c?.posting_enabled)return {posted:false};
 const po=(await client.query("SELECT total::text,status,(NOW() AT TIME ZONE 'Asia/Colombo')::date::text AS day FROM purchase_orders WHERE shop_id=$1 AND id=$2",[shopId,poId])).rows[0];
 if(!po||po.status!=='Received'||po.day<c.day||!actor?.trim())throw Error('Verified purchase receipt required.');
 if((await client.query('SELECT 1 FROM supplier_payments WHERE shop_id=$1 AND purchase_order_id=$2 LIMIT 1',[shopId,poId])).rowCount)throw Error('Purchase with supplier advances requires separate accounting reconciliation.');
 const items=(await client.query('SELECT i.quantity,i.cost_price::text AS purchase_cost,i.variant_id,i.base_units_per_purchase_unit,p.cost_price::text AS current_cost,p.variants_json FROM purchase_order_items i JOIN products p ON p.id=i.product_id AND p.shop_id=$1 WHERE i.purchase_order_id=$2',[shopId,poId])).rows;
 const count=(await client.query('SELECT count(*)::int AS n FROM purchase_order_items WHERE purchase_order_id=$1',[poId])).rows[0].n;
 if(!items.length||items.length!==count)throw Error('Purchase item coverage incomplete.');
 let total=0n;
 for(const i of items){
  const qty=Number(i.quantity),factor=Number(i.base_units_per_purchase_unit??1);
  if(!Number.isSafeInteger(qty)||qty<=0||!Number.isSafeInteger(factor)||factor<=0)throw Error('Invalid purchase quantity or unit conversion.');
  const cost=moneyCents(i.purchase_cost);
  const variant=i.variant_id&&Array.isArray(i.variants_json)?i.variants_json.find((v:any)=>v.id===i.variant_id):null;
  const current=i.variant_id?(variant&&Number.isFinite(Number(variant.costPrice))?Number(variant.costPrice).toFixed(2):'0'):i.current_cost;
  if(cost<=0n||cost!==moneyCents(current)*BigInt(factor))throw Error('Purchase cost differs from inventory carrying cost; verified costing adjustment required.');
  total+=cost*BigInt(qty);
 }
 if(total!==moneyCents(po.total)||total<=0n)throw Error('Purchase total does not reconcile to verified inventory cost.');
 const inventory=await mapping(client,shopId,'inventory','Asset'),payables=await mapping(client,shopId,'supplierPayables','Liability');
 const result=await postJournal(client,{id:'purchase:'+poId,shopId,postingDate:po.day,sourceKind:'PurchaseReceipt',sourceId:poId,description:'Full purchase receipt '+poId,actor,lines:[{accountCode:inventory,debit:decimal(total),credit:'0.00'},{accountCode:payables,debit:'0.00',credit:decimal(total)}]});
 return {posted:true,...result};
}

/** Only full refunds of originally posted sales; no historical journal fabrication. */
export async function postSaleRefund(client:PoolClient,shopId:string,invoiceId:string,actor:string,reason:string){
 const c=await config(client,shopId);if(!c?.posting_enabled)return {posted:false};
 const original=(await client.query("SELECT id FROM ars_gl_journals WHERE shop_id=$1 AND source_kind='Sale' AND source_id=$2",[shopId,invoiceId])).rows[0];
 if(!original)throw Error('Original invoice journal missing; historical refund requires reconciliation.');
 const sale=(await client.query("SELECT status,(refunded_at AT TIME ZONE 'Asia/Colombo')::date::text AS day,payment_method,total::text FROM sales_transactions WHERE shop_id=$1 AND id=$2",[shopId,invoiceId])).rows[0];
 if(!sale||sale.status!=='Refunded'||!actor?.trim())throw Error('Verified full sale refund required.');
 if(sale.payment_method!=='Credit Account'){
  const movements=(await client.query("SELECT amount::text FROM ars_financial_movements WHERE shop_id=$1 AND source_id=$2 AND movement_kind='Invoice Refund'",[shopId,invoiceId])).rows;
  if(movements.length!==1||movements[0].amount!=='-'+sale.total)throw Error('Verified financial refund required.');
 }
 return {posted:true,...await reverseJournal(client,{shopId,id:'refund:'+invoiceId,originalId:original.id,postingDate:sale.day,actor,reason:reason?.trim()||'Full invoice refund'})};
}
