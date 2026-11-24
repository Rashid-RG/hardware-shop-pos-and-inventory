import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {postJournal} from './ledgerPosting';

const kinds=['Freight','Customs','Clearance'] as const;
type Kind=typeof kinds[number];
type Input={shopId:string;id:string;returnId:string;chargeKind:Kind;payer:string;documentReference:string;accountId:string;amount:string;date:string;evidence:string;actor:string};

/** Cash recoveries only, limited to documented historical charges and the
 * actual posted return expense. Other claims require separate accounting review. */
export function recoveryLimit(charges:bigint,postedLoss:bigint,used:bigint,categoryCharges:bigint,categoryUsed:bigint){
 if(charges<0n||postedLoss<0n||used<0n||categoryCharges<0n||categoryUsed<0n)throw Error('Import recovery balances require reconciliation.');
 const overall=(charges<postedLoss?charges:postedLoss)-used,category=categoryCharges-categoryUsed;
 const available=overall<category?overall:category;
 return available>0n?available:0n;
}
export async function recordImportChargeRecovery(db:Pool,i:Input){
 if(![i.shopId,i.id,i.returnId,i.accountId,i.actor,i.evidence,i.payer,i.documentReference].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)||i.payer.trim().length>200||i.documentReference.trim().length>200||!kinds.includes(i.chargeKind)||typeof i.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(i.date)||!Number.isFinite(Date.parse(i.date))||new Date(i.date).toISOString().slice(0,10)!==i.date)throw Error('Valid documented import recovery required.');
 const amount=moneyCents(i.amount);if(amount<=0n||amount>99999999999999n)throw Error('Valid positive recovery amount required.');
 const payer=i.payer.trim(),reference=i.documentReference.trim(),evidence=i.evidence.trim();
 const c=await db.connect();
 try{
 await c.query('BEGIN');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['import-recovery:'+i.shopId+':'+i.id]);
 const prior=(await c.query('SELECT *,amount::text AS amount_text,recovery_date::text AS day FROM ars_gl_import_charge_recoveries WHERE shop_id=$1 AND id=$2',[i.shopId,i.id])).rows[0];
 if(prior){
 if(prior.return_id!==i.returnId||prior.charge_kind!==i.chargeKind||prior.payer!==payer||prior.document_reference!==reference||prior.account_id!==i.accountId||moneyCents(prior.amount_text)!==amount||prior.day!==i.date||prior.evidence!==evidence||prior.recorded_by!==i.actor)throw Error('Recovery identifier already used.');
 await c.query('COMMIT');return {id:i.id,replayed:true};
 }
 const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[i.shopId])).rows[0];
 if(!cut?.posting_enabled||i.date<cut.day)throw Error('Active accounting required for import recovery.');
 const h=(await c.query("SELECT h.purchase_order_id,h.return_date::text AS day,j.id AS journal_id FROM ars_gl_purchase_returns h JOIN ars_gl_journals j ON j.shop_id=h.shop_id AND j.source_kind='PurchaseReturn' AND j.source_id=h.id WHERE h.shop_id=$1 AND h.id=$2",[i.shopId,i.returnId])).rows[0];
 if(!h||i.date<h.day)throw Error('Posted import return required before recovery.');
 const po=(await c.query('SELECT id FROM purchase_orders WHERE shop_id=$1 AND id=$2 FOR UPDATE',[i.shopId,h.purchase_order_id])).rows[0];
 if(!po)throw Error('Import purchase order not found.');
 const approval=(await c.query('SELECT id,snapshot,charges_total::text AS total FROM ars_landed_cost_approvals WHERE shop_id=$1 AND purchase_order_id=$2',[i.shopId,h.purchase_order_id])).rows[0];
 if(!approval)throw Error('Approved landed charges required.');
 const costs=(await c.query('SELECT count(*)::int AS n,COALESCE(sum(historical_import_charges),0)::text AS charges FROM ars_gl_import_return_costs WHERE shop_id=$1 AND return_id=$2 AND approval_id=$3',[i.shopId,i.returnId,approval.id])).rows[0];
 if(!costs.n)throw Error('Verified import return cost records required.');
 const variance=(await c.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind='purchaseReturnVariance' AND m.source_id='control' AND a.active AND a.kind='Expense' FOR SHARE OF a",[i.shopId])).rows[0];
 if(!variance)throw Error('Active return variance account required.');
 const lossRow=(await c.query('SELECT COALESCE(sum(debit-credit),0)::numeric(24,2)::text AS loss FROM ars_gl_lines WHERE shop_id=$1 AND journal_id=$2 AND account_code=$3',[i.shopId,h.journal_id,variance.code])).rows[0];
 const loss=lossRow.loss.startsWith('-')?0n:moneyCents(lossRow.loss);
 const charges=moneyCents(costs.charges),approvedCharges=moneyCents(approval.total);
 const key={Freight:'freightLkr',Customs:'customsLkr',Clearance:'clearanceLkr'}[i.chargeKind];
 const categoryValue=approval.snapshot?.[key];
 if(typeof categoryValue!=='number'||!Number.isFinite(categoryValue)||categoryValue<0)throw Error('Approved import charge breakdown required.');
 const categoryApproved=moneyCents(categoryValue.toFixed(2));
 if(approvedCharges<=0n||charges>approvedCharges||categoryApproved>approvedCharges)throw Error('Import recovery balances require reconciliation.');
 // Conservative proportional category cap; no rounding upward.
 const categoryCharges=charges*categoryApproved/approvedCharges;
 const used=(await c.query('SELECT COALESCE(sum(amount),0)::text AS total,COALESCE(sum(amount) FILTER(WHERE charge_kind=$3),0)::text AS category,MAX(recovery_date)::text AS latest FROM ars_gl_import_charge_recoveries WHERE shop_id=$1 AND return_id=$2',[i.shopId,i.returnId,i.chargeKind])).rows[0];
 if(used.latest&&i.date<used.latest)throw Error('Recovery date precedes later recovery.');
 if(amount>recoveryLimit(charges,loss,moneyCents(used.total),categoryCharges,moneyCents(used.category)))throw Error('Recovery exceeds documented available import charge loss.');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['import-recovery-document',i.shopId,i.chargeKind,payer.toLowerCase(),reference.toLowerCase()])]);
 const duplicate=(await c.query('SELECT 1 FROM ars_gl_import_charge_recoveries WHERE shop_id=$1 AND charge_kind=$2 AND lower(trim(payer))=lower($3) AND lower(trim(document_reference))=lower($4) LIMIT 1',[i.shopId,i.chargeKind,payer,reference])).rowCount;
 if(duplicate)throw Error('Recovery document already used.');
 const account=(await c.query("SELECT kind FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active FOR UPDATE",[i.shopId,i.accountId])).rows[0];
 if(!account||!['Office Cash','Bank'].includes(account.kind))throw Error('Active cash or bank account required.');
 const cash=(await c.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind='financialAccount' AND m.source_id=$2 AND a.active AND a.kind='Asset' FOR SHARE OF a",[i.shopId,i.accountId])).rows[0];
 if(!cash||cash.code===variance.code)throw Error('Active recovery financial mapping required.');
 const journal=await postJournal(c,{id:'import-recovery:'+i.id,shopId:i.shopId,postingDate:i.date,sourceKind:'ImportChargeRecovery',sourceId:i.id,description:'Import charge recovery '+i.returnId,actor:i.actor,lines:[{accountCode:cash.code,debit:decimal(amount),credit:'0.00'},{accountCode:variance.code,debit:'0.00',credit:decimal(amount)}]});
 await c.query("INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note) VALUES($1,$2,$3,$4,'Import Charge Recovery',$5,$6,$7,$8)",['import-recovery:'+i.shopId+':'+i.id,i.shopId,i.accountId,decimal(amount),i.id,i.actor,i.date,evidence]);
 await c.query('INSERT INTO ars_gl_import_charge_recoveries(shop_id,id,return_id,charge_kind,payer,document_reference,amount,account_id,recovery_date,evidence,recorded_by,journal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[i.shopId,i.id,i.returnId,i.chargeKind,payer,reference,decimal(amount),i.accountId,i.date,evidence,i.actor,journal.id]);
 await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
