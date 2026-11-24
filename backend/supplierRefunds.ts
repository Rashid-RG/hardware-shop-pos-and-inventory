import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal,supplierOrderBalances} from './supplierAdvance';
import {postJournal} from './ledgerPosting';

type Input={shopId:string;id:string;returnId:string;accountId:string;amount:string;date:string;evidence:string;actor:string};

export function validateSupplierRefund(amount:bigint,orderAdvance:bigint,returnCredit:bigint,previousRefunds:bigint){
 if(amount<=0n||orderAdvance<0n||returnCredit<0n||previousRefunds<0n||amount>orderAdvance||amount>returnCredit-previousRefunds)throw Error('Refund exceeds available supplier return credit.');
}

export async function recordSupplierRefund(db:Pool,i:Input){
 if(![i.shopId,i.id,i.returnId,i.accountId,i.actor,i.evidence].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)||typeof i.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(i.date)||!Number.isFinite(Date.parse(i.date))||new Date(i.date).toISOString().slice(0,10)!==i.date)throw Error('Valid supplier refund details required.');
 const amount=moneyCents(i.amount);
 if(amount<=0n||amount>99999999999999n)throw Error('Valid positive refund amount required.');
 const c=await db.connect();
 try{
 await c.query('BEGIN');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['supplier-refund:'+i.shopId+':'+i.id]);
 const prior=(await c.query('SELECT return_id,account_id,amount::text,refund_date::text,evidence,recorded_by FROM ars_gl_supplier_refunds WHERE shop_id=$1 AND id=$2',[i.shopId,i.id])).rows[0];
 if(prior){
 if(prior.return_id!==i.returnId||prior.account_id!==i.accountId||moneyCents(prior.amount)!==amount||prior.refund_date!==i.date||prior.evidence!==i.evidence.trim()||prior.recorded_by!==i.actor)throw Error('Refund identifier already used.');
 await c.query('COMMIT');return {id:i.id,replayed:true};
 }
 const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[i.shopId])).rows[0];
 if(!cut?.posting_enabled||i.date<cut.day)throw Error('Active accounting required for supplier refunds.');
 const h=(await c.query("SELECT h.purchase_order_id,h.return_date::text AS day,j.id AS journal_id FROM ars_gl_purchase_returns h JOIN ars_gl_journals j ON j.shop_id=h.shop_id AND j.source_kind='PurchaseReturn' AND j.source_id=h.id WHERE h.shop_id=$1 AND h.id=$2",[i.shopId,i.returnId])).rows[0];
 if(!h||i.date<h.day)throw Error('Posted purchase return required before refund.');
 const b=await supplierOrderBalances(c,i.shopId,h.purchase_order_id);
 // Do not permit backdating across later supplier transactions.
 const future=(await c.query(`SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=$1 AND j.posting_date>$3 AND (
 (j.source_kind='PurchaseReceipt' AND j.source_id=$2)
 OR (j.source_kind='ReceiptBatch' AND EXISTS(SELECT 1 FROM ars_receipt_batches r WHERE r.shop_id=$1 AND r.id=j.source_id AND r.purchase_order_id=$2))
 OR (j.source_kind='SupplierPayment' AND EXISTS(SELECT 1 FROM supplier_payments p WHERE p.shop_id=$1 AND p.id=j.source_id AND p.purchase_order_id=$2))
 OR (j.source_kind='PurchaseReturn' AND EXISTS(SELECT 1 FROM ars_gl_purchase_returns r WHERE r.shop_id=$1 AND r.id=j.source_id AND r.purchase_order_id=$2))
 OR (j.source_kind='SupplierReturnRefund' AND EXISTS(SELECT 1 FROM ars_gl_supplier_refunds f JOIN ars_gl_purchase_returns r ON r.shop_id=f.shop_id AND r.id=f.return_id WHERE f.shop_id=$1 AND f.id=j.source_id AND r.purchase_order_id=$2))) LIMIT 1`,[i.shopId,h.purchase_order_id,i.date])).rowCount;
 if(future)throw Error('Refund date precedes later supplier transactions.');
 const credit=(await c.query('SELECT COALESCE(sum(debit-credit),0)::text AS credit FROM ars_gl_lines WHERE shop_id=$1 AND journal_id=$2 AND account_code=$3',[i.shopId,h.journal_id,b.advanceAccount])).rows[0];
 const used=(await c.query('SELECT COALESCE(sum(amount),0)::text AS amount FROM ars_gl_supplier_refunds WHERE shop_id=$1 AND return_id=$2',[i.shopId,i.returnId])).rows[0];
 validateSupplierRefund(amount,b.advance,moneyCents(credit.credit),moneyCents(used.amount));
 const a=(await c.query("SELECT kind FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active FOR UPDATE",[i.shopId,i.accountId])).rows[0];
 if(!a||!['Office Cash','Bank'].includes(a.kind))throw Error('Active cash or bank account required.');
 const map=(await c.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind='financialAccount' AND m.source_id=$2 AND a.kind='Asset' AND a.active FOR SHARE OF a",[i.shopId,i.accountId])).rows[0];
 if(!map||map.code===b.advanceAccount||map.code===b.payableAccount)throw Error('Distinct active refund accounting mapping required.');
 const journal=await postJournal(c,{id:'supplier-refund:'+i.id,shopId:i.shopId,postingDate:i.date,sourceKind:'SupplierReturnRefund',sourceId:i.id,description:'Supplier return refund '+i.returnId,actor:i.actor,lines:[{accountCode:map.code,debit:decimal(amount),credit:'0.00'},{accountCode:b.advanceAccount,debit:'0.00',credit:decimal(amount)}]});
 await c.query("INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note) VALUES($1,$2,$3,$4,'Supplier Return Refund',$5,$6,$7,$8)",['supplier-refund:'+i.shopId+':'+i.id,i.shopId,i.accountId,decimal(amount),i.id,i.actor,i.date,i.evidence.trim()]);
 await c.query('INSERT INTO ars_gl_supplier_refunds(shop_id,id,return_id,account_id,amount,refund_date,evidence,recorded_by,journal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[i.shopId,i.id,i.returnId,i.accountId,decimal(amount),i.date,i.evidence.trim(),i.actor,journal.id]);
 await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

/** Advisory preview only: posting locks the order and rechecks all limits. */
export async function supplierRefundAvailability(db:Pool,shopId:string,returnId:string){
 const c=await db.connect();
 try{
 await c.query('BEGIN');
 const h=(await c.query("SELECT h.purchase_order_id,h.return_date::text AS day,j.id AS journal_id FROM ars_gl_purchase_returns h JOIN ars_gl_journals j ON j.shop_id=h.shop_id AND j.source_kind='PurchaseReturn' AND j.source_id=h.id WHERE h.shop_id=$1 AND h.id=$2",[shopId,returnId])).rows[0];
 if(!h)throw Error('Posted purchase return required before refund.');
 const cut=(await c.query('SELECT posting_enabled FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[shopId])).rows[0];
 if(!cut?.posting_enabled)throw Error('Active accounting required for supplier refunds.');
 const b=await supplierOrderBalances(c,shopId,h.purchase_order_id);
 const credit=moneyCents((await c.query('SELECT COALESCE(sum(debit-credit),0)::text AS credit FROM ars_gl_lines WHERE shop_id=$1 AND journal_id=$2 AND account_code=$3',[shopId,h.journal_id,b.advanceAccount])).rows[0].credit);
 const used=moneyCents((await c.query('SELECT COALESCE(sum(amount),0)::text AS amount FROM ars_gl_supplier_refunds WHERE shop_id=$1 AND return_id=$2',[shopId,returnId])).rows[0].amount);
 const remaining=credit>used?credit-used:0n;
 const available=remaining<b.advance?remaining:b.advance;
 const accounts=(await c.query("SELECT f.id,f.name,f.kind FROM ars_financial_accounts f JOIN ars_gl_account_mappings m ON m.shop_id=f.shop_id AND m.mapping_kind='financialAccount' AND m.source_id=f.id JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE f.shop_id=$1 AND f.active AND f.kind IN ('Office Cash','Bank') AND a.active AND a.kind='Asset' AND a.code<>ALL($2::text[]) ORDER BY f.name,f.id",[shopId,[b.advanceAccount,b.payableAccount]])).rows;
 await c.query('COMMIT');
 return {returnId,returnDate:h.day,returnCredit:decimal(credit),refunded:decimal(used),orderAdvance:decimal(b.advance),available:decimal(available),accounts};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
