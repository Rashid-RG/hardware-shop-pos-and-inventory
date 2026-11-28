import {buildImportLiabilityReceiptJournal,verifiedImportChargeFunding,allocateImportChargeFunding,recordImportReceiptAllocations} from './importCapitalization';
import {supplierReceiptCredits} from './supplierAdvance';
import type {PoolClient} from 'pg';
import {moneyCents} from './generalLedger';
import {postJournal} from './ledgerPosting';

const signed=(s:string)=>s.startsWith('-')?-moneyCents(s.slice(1)):moneyCents(s);
/** Post one receipt batch, never the entire PO again on final receipt.
 * Freight/customs counterparties and inventory rounding need explicit classification;
 * do not silently treat them as goods supplier debt. */
export async function postReceiptBatch(client:PoolClient,shopId:string,batchId:string){
 const config=(await client.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[shopId])).rows[0];
 if(!config?.posting_enabled)return {posted:false};
 const batch=(await client.query("SELECT purchase_order_id,received_by,(created_at AT TIME ZONE 'Asia/Colombo')::date::text AS day FROM ars_receipt_batches WHERE shop_id=$1 AND id=$2",[shopId,batchId])).rows[0];
 if(!batch||batch.day<config.day||!batch.received_by)throw Error('Verified receipt batch required.');
 const rows=(await client.query(`SELECT r.quantity,i.cost_price::text AS purchase_cost,i.variant_id,i.base_units_per_purchase_unit,p.cost_price::text AS carrying_cost,p.variants_json,c.received_cost::text AS landed_cost,c.rounding_difference::text AS rounding
 FROM ars_receipt_batch_items r JOIN purchase_order_items i ON i.id=r.purchase_order_item_id AND i.purchase_order_id=$3
 JOIN products p ON p.id=i.product_id AND p.shop_id=$1
 LEFT JOIN ars_receipt_cost_entries c ON c.shop_id=$1 AND c.batch_id=r.batch_id AND c.purchase_order_item_id=i.id
 WHERE r.batch_id=$2`,[shopId,batchId,batch.purchase_order_id])).rows;
 const count=(await client.query('SELECT count(*)::int AS n FROM ars_receipt_batch_items WHERE batch_id=$1',[batchId])).rows[0].n;
 if(!rows.length||rows.length!==count)throw Error('Receipt accounting line coverage incomplete.');
 let goods=0n,landed=0n,rounding=0n;
 for(const row of rows){
  const quantity=Number(row.quantity),factor=Number(row.base_units_per_purchase_unit??1);
  if(!Number.isSafeInteger(quantity)||quantity<=0||!Number.isSafeInteger(factor)||factor<=0)throw Error('Invalid receipt unit conversion.');
  const cost=moneyCents(row.purchase_cost)*BigInt(quantity);
  if(cost<=0n)throw Error('Verified goods cost required.');
  goods+=cost;
  if(row.landed_cost!==null){
   const amount=moneyCents(row.landed_cost);
   if(amount<cost||row.rounding===null)throw Error('Verified landed cost and rounding required.');
   rounding+=signed(row.rounding);
   landed+=amount;
  }else{
   const variant=row.variant_id&&Array.isArray(row.variants_json)?row.variants_json.find((v:any)=>v.id===row.variant_id):null;
   const carrying=row.variant_id?(variant&&Number.isFinite(Number(variant.costPrice))?Number(variant.costPrice).toFixed(2):'0'):row.carrying_cost;
   if(moneyCents(carrying)*BigInt(factor)*BigInt(quantity)!==cost)throw Error('Receipt cost differs from inventory carrying value.');
   landed+=cost;
  }
 }
 const map=async(kind:string,classification:string)=>{
  const r=(await client.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id='control' AND a.kind=$3 AND a.active FOR SHARE OF a",[shopId,kind,classification])).rows[0];
  if(!r)throw Error('Missing receipt accounting mapping: '+kind);return r.code as string;
 };
 const inventory=await map('inventory','Asset'),credits=await supplierReceiptCredits(client,shopId,batch.purchase_order_id,goods);
 const expense=landed>goods?await map('operatingExpense','Expense'):'';
 const roundingAccount=rounding!==0n?await map('inventoryRounding','Expense'):'';
 const funding=landed>goods?await verifiedImportChargeFunding(client,shopId,batch.purchase_order_id,expense):{fundedRemaining:0n,approvedUnpaidRemaining:0n,available:[]};
 const allocation=allocateImportChargeFunding({charges:landed-goods,fundedRemaining:funding.fundedRemaining,approvedUnpaidRemaining:funding.approvedUnpaidRemaining});
 const importPayableAccount=allocation.unpaid>0n?await map('importPayables','Liability'):'';
 const lines=buildImportLiabilityReceiptJournal({goods,landed,rounding,fundedRemaining:funding.fundedRemaining,approvedUnpaidRemaining:funding.approvedUnpaidRemaining,goodsCredits:credits,inventoryAccount:inventory,expenseAccount:expense,roundingAccount,importPayableAccount});
 const result=await postJournal(client,{id:'receipt:'+batchId,shopId,postingDate:batch.day,sourceKind:'ReceiptBatch',sourceId:batchId,description:'Warehouse goods receipt '+batchId,actor:batch.received_by,lines});
 if(!result.replayed&&allocation.unpaid>0n)await recordImportReceiptAllocations(client,shopId,batchId,result.id,allocation.unpaid,funding.available);
 return {posted:true,...result};
}
