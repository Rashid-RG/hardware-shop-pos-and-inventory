import type {Pool} from 'pg';
export async function inventoryValuation(db:Pool,shopId:string){
 const result=await db.query(`SELECT id,name,sku,category,status,quantity,cost_price,variants_json,shared_stock_units FROM products WHERE shop_id=$1 ORDER BY name,id`,[shopId]);
 const rows=result.rows.flatMap(p=>{
  const variants=Array.isArray(p.variants_json)?p.variants_json:[];
  const parentQuantity=Number(p.quantity);
  const inconsistent=variants.length>0&&(!!p.shared_stock_units||variants.reduce((n:number,v:any)=>n+Number(v.quantity),0)!==parentQuantity);
  const lines=variants.length?variants.map((v:any)=>({variantId:String(v.id),name:p.name+' · '+v.name,sku:v.sku||p.sku,unit:v.unit||'Unit',quantity:Number(v.quantity),cost:v.costPrice==null?null:Number(v.costPrice)})):[{variantId:null,name:p.name,sku:p.sku,unit:p.shared_stock_units?.baseUnit||'Unit',quantity:parentQuantity,cost:p.cost_price==null?null:Number(p.cost_price)}];
  return lines.map(l=>{
   const validQuantity=Number.isSafeInteger(l.quantity)&&l.quantity>=0;
   const validCost=l.cost!==null&&Number.isFinite(l.cost)&&l.cost>0;
   const issue=inconsistent?'Stock breakdown mismatch':!validQuantity?'Invalid quantity':l.quantity>0&&!validCost?'Missing or zero cost':'';
   const value=issue?null:Math.round(l.quantity*(l.cost??0)*100)/100;
   return {...l,productId:p.id,category:p.category,status:p.status,issue,value};
  });
 });
 const knownValue=Math.round(rows.reduce((n,r)=>n+(r.value??0),0)*100)/100;
 const flagged=rows.filter(r=>r.issue).length;
 return {generatedAt:new Date().toISOString(),rows,knownValue,flagged,complete:flagged===0,totalValue:flagged===0?knownValue:null};
}
export async function inventoryCostHistory(db:Pool,shopId:string,productId:string,offset:number){
 const result=await db.query(`SELECT c.*,b.purchase_order_id,b.received_by,a.shipment_id FROM ars_receipt_cost_entries c
 JOIN ars_receipt_batches b ON b.id=c.batch_id AND b.shop_id=c.shop_id
 JOIN ars_landed_cost_approvals a ON a.id=c.approval_id AND a.shop_id=c.shop_id
 WHERE c.shop_id=$1 AND c.product_id=$2 ORDER BY c.recorded_at DESC,c.batch_id,c.purchase_order_item_id LIMIT 101 OFFSET $3`,[shopId,productId,offset]);
 return {rows:result.rows.slice(0,100),offset,hasMore:result.rows.length>100};
}
