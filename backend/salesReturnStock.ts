import type {PoolClient} from 'pg';
import type {ProductVariant} from '../src/types';

const MAX=2147483647;
export function restoredQuantity(existing:number,returned:number){
 if(!Number.isSafeInteger(existing)||existing<0||!Number.isSafeInteger(returned)||returned<=0||existing+returned>MAX)throw Error('Invalid or excessive returned stock quantity.');
 return existing+returned;
}

/** Internal helper: caller must reconcile invoice quantities, lock invoice and
 * customer, and post the return journal in the same database transaction.
 * Only inspected sellable goods may use this path. */
export async function restorePartialSaleStock(c:PoolClient,input:{shopId:string;returnId:string;invoiceLineIndex:number;productId:string;variantId?:string|null;sellingUnitId?:string|null;unitsPerSaleUnit:number;returnedBaseQuantity:number;actor:string}){
 const {shopId,returnId,invoiceLineIndex,productId,variantId,sellingUnitId,unitsPerSaleUnit,returnedBaseQuantity,actor}=input;
 if(!shopId||!returnId||!productId||!actor||!Number.isSafeInteger(invoiceLineIndex)||invoiceLineIndex<0||!Number.isSafeInteger(unitsPerSaleUnit)||unitsPerSaleUnit<=0||!Number.isSafeInteger(returnedBaseQuantity)||returnedBaseQuantity<=0)throw Error('Valid original stock snapshot required.');
 const p=(await c.query('SELECT name,status,quantity,variants_json,shared_stock_units FROM products WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,productId])).rows[0];
 if(!p||p.status==='Inactive')throw Error('Return stock product requires reconciliation.');
 const variants:ProductVariant[]=Array.isArray(p.variants_json)?p.variants_json:[];
 let next:number;
 if(sellingUnitId){
 if(!p.shared_stock_units||variants.length||variantId)throw Error('Original shared stock is incompatible with current product.');
 next=restoredQuantity(Number(p.quantity),returnedBaseQuantity);
 await c.query('UPDATE products SET quantity=$1,updated_at=NOW() WHERE shop_id=$2 AND id=$3',[next,shopId,productId]);
 }else if(variantId){
 if(p.shared_stock_units||unitsPerSaleUnit!==1)throw Error('Original variant stock is incompatible with current product.');
 const matches=variants.filter(v=>v.id===variantId);
 if(matches.length!==1||variants.some(v=>!Number.isSafeInteger(Number(v.quantity))||Number(v.quantity)<0)||variants.reduce((n,v)=>n+Number(v.quantity),0)!==Number(p.quantity))throw Error('Variant stock requires reconciliation.');
 matches[0].quantity=restoredQuantity(Number(matches[0].quantity),returnedBaseQuantity);
 next=restoredQuantity(Number(p.quantity),returnedBaseQuantity);
 await c.query('UPDATE products SET quantity=$1,variants_json=$2::jsonb,updated_at=NOW() WHERE shop_id=$3 AND id=$4',[next,JSON.stringify(variants),shopId,productId]);
 }else{
 if(p.shared_stock_units||variants.length||unitsPerSaleUnit!==1)throw Error('Original stock structure requires reconciliation.');
 next=restoredQuantity(Number(p.quantity),returnedBaseQuantity);
 await c.query('UPDATE products SET quantity=$1,updated_at=NOW() WHERE shop_id=$2 AND id=$3',[next,shopId,productId]);
 }
 await c.query("INSERT INTO stock_logs(id,shop_id,date,product_id,product_name,type,quantity,reason,user_name,reference_id) VALUES($1,$2,NOW(),$3,$4,'Stock In',$5,'Partial Sales Return',$6,$7)",[JSON.stringify(['sales-return',shopId,returnId,invoiceLineIndex]),shopId,productId,p.name,returnedBaseQuantity,actor,returnId]);
 return {restoredBaseQuantity:returnedBaseQuantity,stockAfter:next};
}
