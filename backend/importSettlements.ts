import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {postJournal} from './ledgerPosting';
type Input={shopId:string;id:string;obligationId:string;accountId:string;amount:string;date:string;evidence:string;actor:string};
export async function settleImportCreditor(db:Pool,i:Input){
 if(![i.shopId,i.id,i.obligationId,i.accountId,i.actor].every(x=>typeof x==='string'&&x.trim()&&x.length<=160)||typeof i.evidence!=='string'||!i.evidence.trim()||i.evidence.length>500||typeof i.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(i.date)||!Number.isFinite(Date.parse(i.date))||new Date(i.date).toISOString().slice(0,10)!==i.date)throw Error('Valid creditor settlement details required.');
 const amount=moneyCents(i.amount);if(amount<=0n)throw Error('Positive settlement required.');
 const c=await db.connect();
 try{
 await c.query('BEGIN');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['import-settlement:'+i.shopId+':'+i.id]);
 const prior=(await c.query('SELECT obligation_id,account_id,amount::text,payment_date::text,evidence,recorded_by FROM ars_gl_import_settlements WHERE shop_id=$1 AND id=$2',[i.shopId,i.id])).rows[0];
 if(prior){if(prior.obligation_id!==i.obligationId||prior.account_id!==i.accountId||moneyCents(prior.amount)!==amount||prior.payment_date!==i.date||prior.evidence!==i.evidence.trim()||prior.recorded_by!==i.actor)throw Error('Settlement identifier already used.');await c.query('COMMIT');return {id:i.id,replayed:true};}
 const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[i.shopId])).rows[0];
 if(!cut?.posting_enabled||i.date<cut.day)throw Error('Active accounting required for creditor settlement.');
 const o=(await c.query("SELECT o.approval_id,o.amount::text FROM ars_gl_import_obligations o JOIN ars_gl_import_obligation_reviews r ON r.shop_id=o.shop_id AND r.obligation_id=o.id AND r.decision='Approved' WHERE o.shop_id=$1 AND o.id=$2 FOR UPDATE OF o",[i.shopId,i.obligationId])).rows[0];
 if(!o)throw Error('Approved creditor obligation required.');
 await c.query('SELECT id FROM ars_landed_cost_approvals WHERE shop_id=$1 AND id=$2 FOR UPDATE',[i.shopId,o.approval_id]);
 const b=(await c.query(`SELECT COALESCE((SELECT sum(a.amount) FROM ars_gl_import_receipt_allocations a JOIN ars_gl_journals j ON j.shop_id=a.shop_id AND j.id=a.journal_id WHERE a.shop_id=$1 AND a.obligation_id=$2 AND j.posting_date<=$3),0)::numeric(24,2)::text AS recognized,
 COALESCE((SELECT sum(amount) FROM ars_gl_import_settlements WHERE shop_id=$1 AND obligation_id=$2),0)::numeric(24,2)::text AS paid`,[i.shopId,i.obligationId,i.date])).rows[0];
 if(amount>moneyCents(b.recognized)-moneyCents(b.paid))throw Error('Payment exceeds recognized outstanding liability.');
 const account=(await c.query("SELECT kind FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active FOR UPDATE",[i.shopId,i.accountId])).rows[0];
 if(!account||!['Office Cash','Bank'].includes(account.kind))throw Error('Active cash or bank account required.');
 const funds=(await c.query(`SELECT (SELECT COALESCE(SUM(amount),0) FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2)-(SELECT COALESCE(SUM(amount),0) FROM ars_supplier_cheques WHERE shop_id=$1 AND bank_account_id=$2 AND status='Issued') >= $3::numeric AS sufficient`,[i.shopId,i.accountId,decimal(amount)])).rows[0];
 if(!funds.sufficient)throw Error('Insufficient recorded funds.');
 const map=async(kind:string,source:string,classification:string)=>{
 const a=(await c.query('SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id=$3 AND a.kind=$4 AND a.active FOR SHARE OF a',[i.shopId,kind,source,classification])).rows[0];
 if(!a)throw Error('Missing active settlement accounting mapping.');return a.code as string;
 };
 const payable=await map('importPayables','control','Liability'),cash=await map('financialAccount',i.accountId,'Asset');
 const journal=await postJournal(c,{id:'import-settlement:'+i.id,shopId:i.shopId,postingDate:i.date,sourceKind:'ImportCreditorPayment',sourceId:i.id,description:'Import creditor settlement '+i.obligationId,actor:i.actor,lines:[{accountCode:payable,debit:decimal(amount),credit:'0.00'},{accountCode:cash,debit:'0.00',credit:decimal(amount)}]});
 await c.query("INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note) VALUES($1,$2,$3,-$4::numeric,'Import Creditor Payment',$5,$6,$7,$8)",['import-payment:'+i.shopId+':'+i.id,i.shopId,i.accountId,decimal(amount),i.id,i.actor,i.date,i.evidence.trim()]);
 await c.query('INSERT INTO ars_gl_import_settlements(shop_id,id,obligation_id,account_id,amount,payment_date,evidence,recorded_by,journal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[i.shopId,i.id,i.obligationId,i.accountId,decimal(amount),i.date,i.evidence.trim(),i.actor,journal.id]);
 await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
