import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {reconcileReturnReceivable} from './salesReturnReconciliation';
import {allocateOriginalInvoiceLines} from './salesReturnAllocation';
import {allocateSalesReturn,buildSalesReturnJournal} from './salesReturnJournal';
import {restorePartialSaleStock} from './salesReturnStock';
import {postJournal} from './ledgerPosting';

type Input={shopId:string;id:string;invoiceId:string;date:string;actor:string;reason:string;evidence:string;items:{lineIndex:number;baseQuantity:number}[]};
export async function recordPartialSalesReturn(db:Pool,i:Input){
 if(![i.shopId,i.id,i.invoiceId,i.actor,i.reason,i.evidence].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)||typeof i.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(i.date)||!Number.isFinite(Date.parse(i.date))||new Date(i.date).toISOString().slice(0,10)!==i.date||!Array.isArray(i.items)||!i.items.length||i.items.length>200)throw Error('Valid sales return details required.');
 const requested=[...i.items].sort((a,b)=>a.lineIndex-b.lineIndex);
 if(requested.some(x=>!Number.isSafeInteger(x.lineIndex)||x.lineIndex<0||!Number.isSafeInteger(x.baseQuantity)||x.baseQuantity<=0)||new Set(requested.map(x=>x.lineIndex)).size!==requested.length)throw Error('Valid unique return lines required.');
 const c=await db.connect();
 try{
 await c.query('BEGIN');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['sales-return',i.shopId,i.id])]);
 const prior=(await c.query('SELECT *,return_date::text AS day FROM ars_gl_sales_returns WHERE shop_id=$1 AND id=$2',[i.shopId,i.id])).rows[0];
 if(prior){
 const lines=(await c.query('SELECT invoice_line_index,returned_base_quantity FROM ars_gl_sales_return_lines WHERE shop_id=$1 AND return_id=$2 ORDER BY invoice_line_index',[i.shopId,i.id])).rows;
 if(prior.invoice_id!==i.invoiceId||prior.day!==i.date||prior.recorded_by!==i.actor||prior.reason!==i.reason.trim()||prior.evidence!==i.evidence.trim()||lines.length!==requested.length||requested.some((x,n)=>x.lineIndex!==Number(lines[n].invoice_line_index)||x.baseQuantity!==Number(lines[n].returned_base_quantity)))throw Error('Return identifier already used.');
 await c.query('COMMIT');return {id:i.id,replayed:true};
 }
 const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[i.shopId])).rows[0];
 if(!cut?.posting_enabled||i.date<cut.day)throw Error('Active accounting required for sales returns.');
 const original=await reconcileReturnReceivable(c,i.shopId,i.invoiceId,i.date);
 const allocations=allocateOriginalInvoiceLines({subtotal:String(original.invoice.subtotal),discountAmount:String(original.invoice.discount_amount),tax:original.invoice.tax_text,total:original.invoice.total_text,lines:original.items.map(x=>({quantity:Number(x.quantity),sellingPrice:String(x.selling_price),discountPercent:String(x.discount),discountAmount:String(x.discount_amount),costPerSellingUnit:x.cost_text}))});
 const previous=(await c.query('SELECT l.invoice_line_index,sum(l.returned_base_quantity)::text AS qty FROM ars_gl_sales_return_lines l JOIN ars_gl_sales_returns h ON h.shop_id=l.shop_id AND h.id=l.return_id WHERE h.shop_id=$1 AND h.invoice_id=$2 GROUP BY l.invoice_line_index',[i.shopId,i.invoiceId])).rows;
 let revenue=0n,tax=0n,cost=0n;
 const prepared=requested.map(x=>{
 const row=original.items[x.lineIndex],allocation=allocations[x.lineIndex];
 if(!row||!allocation)throw Error('Original invoice line not found.');
 const factor=Number(row.base_units_per_sale_unit??1);
 const a=allocateSalesReturn({soldQuantity:Number(row.quantity),unitsPerSaleUnit:factor,previousReturnedBaseQuantity:Number(previous.find(p=>Number(p.invoice_line_index)===x.lineIndex)?.qty??0),returnBaseQuantity:x.baseQuantity,netRevenue:allocation.netRevenue,tax:allocation.tax,inventoryCost:allocation.inventoryCost});
 revenue+=a.revenue;tax+=a.tax;cost+=a.cost;
 return {x,row,factor,a};
 });
 const total=revenue+tax,applied=total<original.outstandingReceivable?total:original.outstandingReceivable,credit=total-applied;
 // Separate customer-credit liabilities need their own operational allocation
 // and refund register before they can safely be exposed to collections.
 if(credit>0n)throw Error('Excess customer credit requires completed customer credit integration.');
 const map=async(kind:string,classification:string)=>{const r=(await c.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id='control' AND a.active AND a.kind=$3 FOR SHARE OF a",[i.shopId,kind,classification])).rows[0];if(!r)throw Error('Missing active sales return mapping: '+kind);return r.code as string;};
 const lines=buildSalesReturnJournal({netRevenue:decimal(revenue),tax:decimal(tax),inventoryCost:decimal(cost),outstandingReceivable:decimal(original.outstandingReceivable),salesAccount:await map('sales','Revenue'),taxAccount:tax>0n?await map('tax','Liability'):'',inventoryAccount:await map('inventory','Asset'),costOfGoodsAccount:await map('costOfGoods','Expense'),receivablesAccount:original.receivablesAccount,customerCreditsAccount:''});
 const journal=await postJournal(c,{id:'sales-return:'+i.id,shopId:i.shopId,postingDate:i.date,sourceKind:'SalesReturn',sourceId:i.id,description:'Partial sales return '+i.invoiceId,actor:i.actor,lines});
 await c.query('INSERT INTO ars_gl_sales_returns(shop_id,id,invoice_id,customer_id,return_date,reason,evidence,recorded_by,original_journal_id,journal_id,net_revenue,tax,inventory_cost,receivable_reduction,customer_credit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[i.shopId,i.id,i.invoiceId,original.customerId,i.date,i.reason.trim(),i.evidence.trim(),i.actor,original.journalId,journal.id,decimal(revenue),decimal(tax),decimal(cost),decimal(applied),decimal(credit)]);
 for(const {x,row,factor,a} of prepared){
 await restorePartialSaleStock(c,{shopId:i.shopId,returnId:i.id,invoiceLineIndex:x.lineIndex,productId:row.product_id,variantId:row.variant_id,sellingUnitId:row.selling_unit_id,unitsPerSaleUnit:factor,returnedBaseQuantity:x.baseQuantity,actor:i.actor});
 await c.query('INSERT INTO ars_gl_sales_return_lines(shop_id,return_id,invoice_line_index,product_id,variant_id,selling_unit_id,selling_unit_label,sold_quantity,units_per_sale_unit,returned_base_quantity,net_revenue,tax,inventory_cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[i.shopId,i.id,x.lineIndex,row.product_id,row.variant_id,row.selling_unit_id,row.selling_unit_label,row.quantity,factor,x.baseQuantity,decimal(a.revenue),decimal(a.tax),decimal(a.cost)]);
 }
 if(applied>0n)await c.query('UPDATE customers SET credit_balance=credit_balance-$1 WHERE shop_id=$2 AND id=$3',[decimal(applied),i.shopId,original.customerId]);
 await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
