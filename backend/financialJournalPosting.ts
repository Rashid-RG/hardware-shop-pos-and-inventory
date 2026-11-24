import type {PoolClient} from 'pg';
import {moneyCents,type JournalLine} from './generalLedger';
import {postJournal} from './ledgerPosting';
type Event='CustomerCollection'|'SupplierPayment'|'Transfer'|'Expense';
const decimal=(n:bigint)=>(n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0');
/** Called only inside the source business transaction, after the movements are persisted. */
export async function postFinancialJournal(client:PoolClient,shopId:string,sourceId:string,event:Event){
 const config=(await client.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[shopId])).rows[0];
 if(!config?.posting_enabled)return {posted:false};
 const kinds=event==='Transfer'?['Transfer In','Transfer Out']:event==='CustomerCollection'?['Customer Collection']:event==='SupplierPayment'?['Supplier Payment']:['Expense'];
 const rows=(await client.query(`SELECT m.account_id,m.amount::text,m.movement_kind,m.recorded_by,m.effective_date::text AS day,a.kind,a.active FROM ars_financial_movements m JOIN ars_financial_accounts a ON a.shop_id=m.shop_id AND a.id=m.account_id WHERE m.shop_id=$1 AND m.source_id=$2 AND m.movement_kind=ANY($3::text[]) ORDER BY m.movement_kind`,[shopId,sourceId,kinds])).rows;
 if(rows.length!==(event==='Transfer'?2:1)||rows.some(r=>!r.active||!['Office Cash','Bank','Representative Cash'].includes(r.kind)||!r.recorded_by||r.day<config.day||r.day!==rows[0].day||r.recorded_by!==rows[0].recorded_by))throw Error('Verified financial movements required for accounting.');
 const mapping=async(kind:string,source:string,classification:string)=>{
  const r=(await client.query('SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id=$3 AND a.kind=$4 AND a.active FOR SHARE OF a',[shopId,kind,source,classification])).rows[0];
  if(!r)throw Error('Missing active accounting mapping: '+kind);return r.code as string;
 };
 const signed=(s:string)=>s.startsWith('-')?-moneyCents(s.slice(1)):moneyCents(s);
 const line=(code:string,amount:bigint):JournalLine=>({accountCode:code,debit:decimal(amount>0n?amount:0n),credit:decimal(amount<0n?-amount:0n)});
 let lines:JournalLine[];
 if(event==='Transfer'){
  const incoming=rows.find(r=>r.movement_kind==='Transfer In'),outgoing=rows.find(r=>r.movement_kind==='Transfer Out');
  if(!incoming||!outgoing||incoming.account_id===outgoing.account_id||signed(incoming.amount)<=0n||signed(incoming.amount)!==-signed(outgoing.amount))throw Error('Transfer movements must offset exactly.');
  lines=[line(await mapping('financialAccount',incoming.account_id,'Asset'),signed(incoming.amount)),line(await mapping('financialAccount',outgoing.account_id,'Asset'),signed(outgoing.amount))];
 }else{
  const m=rows[0],amount=signed(m.amount);
  if(event==='CustomerCollection'?amount<=0n:amount>=0n)throw Error('Invalid financial movement direction.');
  let counter:string;
  if(event==='CustomerCollection'){
   const p=(await client.query('SELECT amount::text,customer_id FROM customer_credit_payments WHERE shop_id=$1 AND id=$2',[shopId,sourceId])).rows[0];
   if(!p||moneyCents(p.amount)!==amount)throw Error('Verified customer payment required.');
   counter=await mapping('receivables','control','Asset');
  }else if(event==='SupplierPayment'){
   const p=(await client.query('SELECT p.amount::text,p.purchase_order_id,o.status FROM supplier_payments p LEFT JOIN purchase_orders o ON o.shop_id=p.shop_id AND o.id=p.purchase_order_id AND o.supplier_id=p.supplier_id WHERE p.shop_id=$1 AND p.id=$2',[shopId,sourceId])).rows[0];
   if(!p||moneyCents(p.amount)!==-amount||p.status!=='Received')throw Error('Supplier advances or unmatched payments require separate accounting classification.');
   counter=await mapping('supplierPayables','control','Liability');
  }else{
   const p=(await client.query('SELECT amount::text,category FROM manual_expenses WHERE shop_id=$1 AND id=$2',[shopId,sourceId])).rows[0];
   if(!p||moneyCents(p.amount)!==-amount)throw Error('Verified paid expense required.');
   // Only ordinary paid operating expenses are covered; payroll needs a separate controlled workflow.
   if(/salary|payroll|wages/i.test(p.category))throw Error('Payroll accounting requires verified salary integration.');
   counter=await mapping('operatingExpense','control','Expense');
  }
  lines=[line(await mapping('financialAccount',m.account_id,'Asset'),amount),line(counter,-amount)];
 }
 if(new Set(lines.map(l=>l.accountCode)).size!==lines.length)throw Error('Financial event requires distinct ledger accounts.');
 const result=await postJournal(client,{id:event+':'+sourceId,shopId,postingDate:rows[0].day,sourceKind:event,sourceId,description:event+' '+sourceId,actor:rows[0].recorded_by,lines});
 return {posted:true,...result};
}
