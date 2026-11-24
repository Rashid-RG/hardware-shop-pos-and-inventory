import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal,supplierOrderBalances} from './supplierAdvance';
import {validatePurchaseReturnQuantity,buildPurchaseReturnJournal} from './purchaseReturnJournal';
import {postJournal} from './ledgerPosting';
import {purchaseVariant} from './purchaseVariant';
import type {ProductVariant} from '../src/types';

type Input={shopId:string;id:string;poId:string;actor:string;date:string;reason:string;evidence:string;items:{itemId:number;baseQuantity:number;supplierCredit:string}[]};
export async function recordPurchaseReturn(db:Pool,i:Input){
 if(![i.shopId,i.id,i.poId,i.actor,i.reason,i.evidence].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)||!/^\d{4}-\d{2}-\d{2}$/.test(i.date)||!Number.isFinite(Date.parse(i.date))||new Date(i.date).toISOString().slice(0,10)!==i.date||!Array.isArray(i.items)||!i.items.length||i.items.length>200)throw Error('Valid purchase return details required.');
 const items=[...i.items].sort((a,b)=>a.itemId-b.itemId);
 if(new Set(items.map(x=>x.itemId)).size!==items.length||items.some(x=>!Number.isSafeInteger(x.itemId)||x.itemId<=0||!Number.isSafeInteger(x.baseQuantity)||x.baseQuantity<=0||moneyCents(x.supplierCredit)<=0n))throw Error('Valid unique return lines required.');
 const c=await db.connect();
 try{
 await c.query('BEGIN');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['purchase-return:'+i.shopId+':'+i.id]);
 const prior=(await c.query('SELECT purchase_order_id,return_date::text,reason,evidence,recorded_by FROM ars_gl_purchase_returns WHERE shop_id=$1 AND id=$2',[i.shopId,i.id])).rows[0];
 if(prior){
 const lines=(await c.query('SELECT purchase_order_item_id,base_quantity,supplier_credit::text FROM ars_gl_purchase_return_lines WHERE shop_id=$1 AND return_id=$2 ORDER BY purchase_order_item_id',[i.shopId,i.id])).rows;
 if(prior.purchase_order_id!==i.poId||prior.return_date!==i.date||prior.reason!==i.reason.trim()||prior.evidence!==i.evidence.trim()||prior.recorded_by!==i.actor||lines.length!==items.length||!items.every((x,n)=>Number(lines[n].purchase_order_item_id)===x.itemId&&Number(lines[n].base_quantity)===x.baseQuantity&&moneyCents(lines[n].supplier_credit)===moneyCents(x.supplierCredit)))throw Error('Return identifier already used.');
 await c.query('COMMIT');return {id:i.id,replayed:true};
 }
 const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[i.shopId])).rows[0];
 if(!cut?.posting_enabled||i.date<cut.day)throw Error('Active accounting required for purchase returns.');
 const po=(await c.query('SELECT status FROM purchase_orders WHERE shop_id=$1 AND id=$2 FOR UPDATE',[i.shopId,i.poId])).rows[0];
 if(!po||!['Received','Partially Received'].includes(po.status))throw Error('Received purchase order required.');
 if((await c.query('SELECT 1 FROM ars_landed_cost_approvals WHERE shop_id=$1 AND purchase_order_id=$2',[i.shopId,i.poId])).rowCount)throw Error('Import returns require landed charge reconciliation.');
 const b=await supplierOrderBalances(c,i.shopId,i.poId);
 const full=(await c.query("SELECT 1 FROM ars_gl_journals WHERE shop_id=$1 AND source_kind='PurchaseReceipt' AND source_id=$2 AND posting_date<=$3",[i.shopId,i.poId,i.date])).rowCount;
 if((await c.query("SELECT 1 FROM ars_receipt_batches b WHERE b.shop_id=$1 AND b.purchase_order_id=$2 AND NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=b.shop_id AND j.source_kind='ReceiptBatch' AND j.source_id=b.id) LIMIT 1",[i.shopId,i.poId])).rowCount)throw Error('Unposted receipt history requires reconciliation.');
 await c.query('INSERT INTO ars_gl_purchase_returns(shop_id,id,purchase_order_id,return_date,reason,evidence,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[i.shopId,i.id,i.poId,i.date,i.reason.trim(),i.evidence.trim(),i.actor]);
 let totalCost=0n,totalCredit=0n;
 for(const x of items){
 const row=(await c.query('SELECT * FROM purchase_order_items WHERE id=$1 AND purchase_order_id=$2',[x.itemId,i.poId])).rows[0];
 if(!row)throw Error('Return line not found in purchase order.');
 const p=(await c.query('SELECT * FROM products WHERE shop_id=$1 AND id=$2 FOR UPDATE',[i.shopId,row.product_id])).rows[0];
 if(!p)throw Error('Returned product unavailable.');
 const variants:ProductVariant[]=p.variants_json||[];
 const factor=Number(row.base_units_per_purchase_unit??1);
 if((p.shared_stock_units||row.selling_unit_id||row.base_units_per_purchase_unit!=null)&&(!p.shared_stock_units||!row.selling_unit_id||!row.base_units_per_purchase_unit||variants.length||row.variant_id))throw Error('Incompatible purchase unit snapshot.');
 const variant=purchaseVariant(variants,row.variant_id,p.name,false);
 const received=(await c.query("SELECT COALESCE(sum(r.quantity),0)::text AS quantity FROM ars_receipt_batch_items r JOIN ars_receipt_batches b ON b.id=r.batch_id JOIN ars_gl_journals j ON j.shop_id=b.shop_id AND j.source_kind='ReceiptBatch' AND j.source_id=b.id WHERE b.shop_id=$1 AND b.purchase_order_id=$2 AND r.purchase_order_item_id=$3 AND j.posting_date<=$4",[i.shopId,i.poId,x.itemId,i.date])).rows[0];
 if(full&&Number(received.quantity)>0)throw Error('Mixed receipt history requires reconciliation.');
 const receivedBase=Number(full?row.quantity:received.quantity)*factor;
 const previous=(await c.query('SELECT COALESCE(sum(l.base_quantity),0)::text AS qty,COALESCE(sum(l.supplier_credit),0)::text AS credit FROM ars_gl_purchase_return_lines l JOIN ars_gl_purchase_returns h ON h.shop_id=l.shop_id AND h.id=l.return_id WHERE h.shop_id=$1 AND h.purchase_order_id=$2 AND l.purchase_order_item_id=$3',[i.shopId,i.poId,x.itemId])).rows[0];
 const qty=validatePurchaseReturnQuantity({quantity:x.baseQuantity,unitsPerReturnUnit:1,receivedBaseQuantity:receivedBase,previousReturnedBaseQuantity:Number(previous.qty),availableBaseQuantity:Number(variant?variant.quantity:p.quantity)});
 const cost=moneyCents(variant?Number(variant.costPrice).toFixed(2):String(p.cost_price))*BigInt(qty),credit=moneyCents(x.supplierCredit);
 if(cost<=0n||credit+moneyCents(previous.credit)>moneyCents(String(row.cost_price))*BigInt(receivedBase)/BigInt(factor))throw Error('Return credit exceeds verified purchase cost.');
 if(variant){variant.quantity=Number(variant.quantity)-qty;await c.query('UPDATE products SET quantity=$1,variants_json=$2::jsonb,updated_at=NOW() WHERE shop_id=$3 AND id=$4',[variants.reduce((n,v)=>n+Number(v.quantity),0),JSON.stringify(variants),i.shopId,p.id]);}
 else await c.query('UPDATE products SET quantity=quantity-$1,updated_at=NOW() WHERE shop_id=$2 AND id=$3',[qty,i.shopId,p.id]);
 await c.query('INSERT INTO ars_gl_purchase_return_lines(shop_id,return_id,purchase_order_item_id,base_quantity,inventory_cost,supplier_credit) VALUES($1,$2,$3,$4,$5,$6)',[i.shopId,i.id,x.itemId,qty,decimal(cost),decimal(credit)]);
 await c.query("INSERT INTO stock_logs(id,shop_id,date,product_id,product_name,type,quantity,reason,user_name,reference_id) VALUES($1,$2,NOW(),$3,$4,'Stock Out',$5,'Purchase Return',$6,$7)",['purchase-return:'+i.shopId+':'+i.id+':'+x.itemId,i.shopId,p.id,p.name,qty,i.actor,i.id]);
 totalCost+=cost;totalCredit+=credit;
 }
 const map=async(kind:string,classification:string)=>{const a=(await c.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id='control' AND a.kind=$3 AND a.active FOR SHARE OF a",[i.shopId,kind,classification])).rows[0];if(!a)throw Error('Missing purchase return accounting mapping: '+kind);return a.code as string;};
 const lines=buildPurchaseReturnJournal({inventoryCost:decimal(totalCost),supplierCredit:decimal(totalCredit),outstandingPayable:decimal(b.payable),inventoryAccount:await map('inventory','Asset'),payableAccount:b.payableAccount,advanceAccount:b.advanceAccount,varianceAccount:totalCost!==totalCredit?await map('purchaseReturnVariance','Expense'):''});
 await postJournal(c,{id:'purchase-return:'+i.id,shopId:i.shopId,postingDate:i.date,sourceKind:'PurchaseReturn',sourceId:i.id,description:'Purchase return '+i.poId,actor:i.actor,lines});
 await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
