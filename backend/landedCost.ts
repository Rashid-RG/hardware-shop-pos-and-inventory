import type {Pool,PoolClient} from 'pg';
import {estimateImportLandedCost} from '../src/utils/importLandedCost';

export async function initLandedCostTables(db:Pool|PoolClient){
 await db.query(`
 CREATE TABLE IF NOT EXISTS ars_landed_cost_approvals (
 id TEXT PRIMARY KEY,shop_id TEXT NOT NULL,shipment_id TEXT NOT NULL,purchase_order_id TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(currency='LKR'),goods_total NUMERIC(16,2) NOT NULL CHECK(goods_total>0),
 charges_total NUMERIC(16,2) NOT NULL CHECK(charges_total>=0),landed_total NUMERIC(16,2) NOT NULL,
 evidence TEXT NOT NULL,approved_by TEXT NOT NULL,approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 snapshot JSONB NOT NULL,UNIQUE(shop_id,shipment_id),UNIQUE(shop_id,purchase_order_id),
 CHECK(landed_total=goods_total+charges_total)
 );
 `);
}
async function buildSnapshot(db:Pool|PoolClient,shopId:string,shipmentId:string,lock=false){
 const s=await db.query(`SELECT s.*,p.status,p.po_number,p.total AS po_total FROM ars_import_shipments s
 JOIN purchase_orders p ON p.id=s.purchase_order_id AND p.shop_id=s.shop_id WHERE s.shop_id=$1 AND s.id=$2`+(lock?' FOR UPDATE OF p,s':''),[shopId,shipmentId]);
 if(!s.rowCount)throw Error('Shipment not found in this shop.');
 const shipment=s.rows[0];
 const lines=await db.query(`SELECT id::text AS item_id,product_id,product_name,variant_id,quantity,cost_price,selling_unit_id,selling_unit_label,base_units_per_purchase_unit
 FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY id`+(lock?' FOR UPDATE':''),[shipment.purchase_order_id]);
 const items=lines.rows.map(r=>{
 const factor=r.selling_unit_id?Number(r.base_units_per_purchase_unit):1,quantity=Number(r.quantity),cost=Number(r.cost_price);
 if(!Number.isSafeInteger(factor)||factor<1||!Number.isSafeInteger(quantity*factor)||cost<=0)throw Error('Review invalid or missing purchase unit cost or conversion.');
 return {itemId:r.item_id,productId:r.product_id,productName:r.product_name,variantId:r.variant_id,sellingUnitId:r.selling_unit_id,sellingUnitLabel:r.selling_unit_label,quantity,factor,baseQuantity:quantity*factor,purchaseUnitCost:cost};
 });
 const estimate=estimateImportLandedCost({currency:'LKR',exchangeRateLkr:1,freightLkr:Number(shipment.freight_lkr),dutiesLkr:Number(shipment.customs_lkr),clearanceLkr:Number(shipment.clearance_lkr),otherLkr:0,lines:items.map(i=>({sku:i.itemId,description:i.productName,quantity:i.quantity,unitForeign:i.purchaseUnitCost}))});
 if(Math.round(Number(shipment.po_total)*100)!==Math.round(estimate.goodsTotalLkr*100))throw Error('Purchase order total does not reconcile to line costs.');
 return {shipmentId,purchaseOrderId:shipment.purchase_order_id,poNumber:shipment.po_number,status:shipment.status,currency:'LKR',sourceCurrency:shipment.invoice_currency,sourceExchangeRate:String(shipment.exchange_rate_lkr),freightLkr:Number(shipment.freight_lkr),customsLkr:Number(shipment.customs_lkr),clearanceLkr:Number(shipment.clearance_lkr),goodsTotal:estimate.goodsTotalLkr,chargesTotal:estimate.chargesTotalLkr,landedTotal:estimate.grandTotalLkr,items:items.map((i,index)=>({...i,goodsCost:estimate.detail[index].baseLkr,allocatedCharges:estimate.detail[index].allocatedChargesLkr,landedTotal:estimate.detail[index].landedTotalLkr,landedBaseUnitCost:estimate.detail[index].landedTotalLkr/i.baseQuantity}))};
}
export async function previewLandedCost(db:Pool,shopId:string,shipmentId:string){
 const existing=await db.query('SELECT * FROM ars_landed_cost_approvals WHERE shop_id=$1 AND shipment_id=$2',[shopId,shipmentId]);
 if(existing.rowCount)return {approved:true,approval:existing.rows[0],snapshot:existing.rows[0].snapshot};
 return {approved:false,snapshot:await buildSnapshot(db,shopId,shipmentId)};
}
export async function approveLandedCost(db:Pool,input:{id:string;shopId:string;shipmentId:string;evidence:string;approvedBy:string;expectedSnapshot:unknown}){
 const {id,shopId,shipmentId,approvedBy}=input,evidence=input.evidence.trim();
 if(!id||!shopId||!shipmentId||!approvedBy||!evidence||evidence.length>500||!input.expectedSnapshot)throw Error('Approval reference and reviewed cost snapshot are required.');
 const client=await db.connect();
 try{
 await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['landed-cost-'+id]);
 const prior=await client.query('SELECT *,snapshot=$2::jsonb AS matches FROM ars_landed_cost_approvals WHERE id=$1',[id,JSON.stringify(input.expectedSnapshot)]);
 if(prior.rowCount){const p=prior.rows[0];if(p.shop_id!==shopId||p.shipment_id!==shipmentId||p.evidence!==evidence||p.approved_by!==approvedBy||!p.matches)throw Error('Approval request identifier already used.');await client.query('COMMIT');return {id,replayed:true};}
 const snapshot=await buildSnapshot(client,shopId,shipmentId,true);
 if(!['Pending','Ordered'].includes(snapshot.status))throw Error('Only shipments with open, unreceived purchase orders can be approved.');
 const receipts=await client.query('SELECT 1 FROM ars_receipt_batches WHERE shop_id=$1 AND purchase_order_id=$2 LIMIT 1',[shopId,snapshot.purchaseOrderId]);
 if(receipts.rowCount)throw Error('Existing receipts require a separate historical costing review.');
 const matches=await client.query('SELECT $1::jsonb=$2::jsonb AS matches',[JSON.stringify(snapshot),JSON.stringify(input.expectedSnapshot)]);
 if(!matches.rows[0].matches)throw Error('Shipment costs changed. Refresh and review again.');
 const existing=await client.query('SELECT id FROM ars_landed_cost_approvals WHERE shop_id=$1 AND shipment_id=$2',[shopId,shipmentId]);
 if(existing.rowCount)throw Error('Shipment already has an approved landed cost.');
 await client.query('INSERT INTO ars_landed_cost_approvals(id,shop_id,shipment_id,purchase_order_id,currency,goods_total,charges_total,landed_total,evidence,approved_by,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',[id,shopId,shipmentId,snapshot.purchaseOrderId,'LKR',snapshot.goodsTotal,snapshot.chargesTotal,snapshot.landedTotal,evidence,approvedBy,JSON.stringify(snapshot)]);
 await client.query('COMMIT');return {id,replayed:false};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
