import {moneyCents} from './generalLedger';

type ReceiptCost={baseQuantity:number;landedCost:string};

/** Allocate historical receipt cost for audit only. Actual stock relief must use
 * current carrying cost; no freight/customs recovery is assumed by this helper. */
export function allocateImportReturnCost(input:{receipts:ReceiptCost[];previousReturnedBaseQuantity:number;returnBaseQuantity:number;goodsCostPerPurchaseUnit:string;purchaseFactor:number}){
 const {receipts,previousReturnedBaseQuantity:previous,returnBaseQuantity:quantity,purchaseFactor:factor}=input;
 if(!Array.isArray(receipts)||!receipts.length||![previous,quantity,factor].every(Number.isSafeInteger)||previous<0||quantity<=0||factor<=0)throw Error('Valid import return quantity and receipt history required.');
 let total=0n,landed=0n;
 for(const receipt of receipts){
 if(!Number.isSafeInteger(receipt.baseQuantity)||receipt.baseQuantity<=0)throw Error('Invalid import receipt cost history.');
 const cost=moneyCents(receipt.landedCost);
 if(cost<=0n)throw Error('Invalid import receipt cost history.');
 total+=BigInt(receipt.baseQuantity);landed+=cost;
 }
 const end=BigInt(previous)+BigInt(quantity);
 if(end>total||total%BigInt(factor)!==0n)throw Error('Import return exceeds verified receipt quantities or packaging reconciliation required.');
 const goods=moneyCents(input.goodsCostPerPurchaseUnit)*total/BigInt(factor);
 if(goods<=0n||landed<goods)throw Error('Import landed cost does not reconcile to goods cost.');
 // Cumulative rounding makes consecutive partial allocations conserve total cents.
 const allocate=(amount:bigint)=>amount*end/total-amount*BigInt(previous)/total;
 const goodsCost=allocate(goods),allocatedCharges=allocate(landed-goods);
 return {goodsCost,allocatedCharges,historicalLandedCost:goodsCost+allocatedCharges,receivedBaseQuantity:total};
}

/** Verify every receipt against its approved costing entry and posted journal.
 * Caller must hold the purchase order lock for a consistent return transaction. */
export async function verifiedImportReturnCosts(client:import('pg').PoolClient,input:{shopId:string;poId:string;itemId:number;date:string;previousReturnedBaseQuantity:number;returnBaseQuantity:number}){
 const {shopId,poId,itemId,date}=input;
 if(!shopId||!poId||!Number.isSafeInteger(itemId)||itemId<=0||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Valid import return details required.');
 const approved=(await client.query(`SELECT a.id,a.snapshot,i.product_id,i.variant_id,i.selling_unit_id,i.quantity,i.cost_price::text AS cost_price,i.base_units_per_purchase_unit FROM ars_landed_cost_approvals a JOIN purchase_orders p ON p.shop_id=a.shop_id AND p.id=a.purchase_order_id JOIN purchase_order_items i ON i.purchase_order_id=p.id WHERE a.shop_id=$1 AND a.purchase_order_id=$2 AND i.id=$3`,[shopId,poId,itemId])).rows[0];
 if(!approved)throw Error('Approved import purchase line required.');
 const snapshot=Array.isArray(approved.snapshot?.items)?approved.snapshot.items.find((x:any)=>String(x.itemId)===String(itemId)):null;
 const factor=Number(approved.base_units_per_purchase_unit??1);
 if(!snapshot||snapshot.productId!==approved.product_id||(snapshot.variantId||null)!==(approved.variant_id||null)||(snapshot.sellingUnitId||null)!==(approved.selling_unit_id||null)||snapshot.factor!==factor||snapshot.quantity!==Number(approved.quantity)||snapshot.purchaseUnitCost!==Number(approved.cost_price)||!Number.isSafeInteger(factor)||factor<=0)throw Error('Import purchase line differs from approved cost snapshot.');
 const legacy=(await client.query("SELECT 1 FROM ars_gl_journals WHERE shop_id=$1 AND source_kind='PurchaseReceipt' AND source_id=$2 LIMIT 1",[shopId,poId])).rowCount;
 if(legacy)throw Error('Import receipt history requires reconciliation.');
 const rows=(await client.query(`SELECT b.id,j.id AS journal_id,j.posting_date::text AS day,r.quantity,e.approval_id,e.product_id,e.variant_id,e.received_base_quantity,e.received_cost::text AS landed_cost FROM ars_receipt_batch_items r JOIN ars_receipt_batches b ON b.id=r.batch_id LEFT JOIN ars_gl_journals j ON j.shop_id=b.shop_id AND j.source_kind='ReceiptBatch' AND j.source_id=b.id LEFT JOIN ars_receipt_cost_entries e ON e.shop_id=b.shop_id AND e.batch_id=b.id AND e.purchase_order_item_id=r.purchase_order_item_id WHERE b.shop_id=$1 AND b.purchase_order_id=$2 AND r.purchase_order_item_id=$3 ORDER BY b.id`,[shopId,poId,itemId])).rows;
 if(!rows.length||rows.some(r=>!r.journal_id||r.approval_id!==approved.id||r.product_id!==approved.product_id||(r.variant_id||null)!==(approved.variant_id||null)||!Number.isSafeInteger(Number(r.quantity))||Number(r.quantity)<=0||!Number.isSafeInteger(Number(r.received_base_quantity))||Number(r.received_base_quantity)!==Number(r.quantity)*factor||!r.landed_cost))throw Error('Import receipt history requires reconciliation.');
 // Reject backdating across later receipts because inventory uses current weighted average.
 if(rows.some(r=>r.day>date))throw Error('Import return date precedes later receipts.');
 const total=rows.reduce((n,r)=>n+Number(r.received_base_quantity),0);
 if(!Number.isSafeInteger(total)||total>Number(approved.quantity)*factor)throw Error('Import receipt quantities exceed approval.');
 const allocation=allocateImportReturnCost({receipts:rows.map(r=>({baseQuantity:Number(r.received_base_quantity),landedCost:r.landed_cost})),previousReturnedBaseQuantity:input.previousReturnedBaseQuantity,returnBaseQuantity:input.returnBaseQuantity,goodsCostPerPurchaseUnit:approved.cost_price,purchaseFactor:factor});
 return {approvalId:approved.id,...allocation};
}
