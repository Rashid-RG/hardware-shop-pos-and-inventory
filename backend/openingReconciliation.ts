import type {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {moneyCents,validateJournal,type JournalLine} from './generalLedger';
import {inventoryValuation} from './inventoryValuation';
import {supplierPayableAging} from './payableAging';

function signedCents(s:string):bigint{
 const neg=s.startsWith('-');return (neg?-1n:1n)*moneyCents(neg?s.slice(1):s);
}
function decimal(n:bigint){const a=n<0n?-n:n;return (n<0n?'-':'')+(a/100n).toString()+'.'+(a%100n).toString().padStart(2,'0');}
function estimatedCents(n:number):bigint|null{
 const scaled=Math.round(n*100);return Number.isSafeInteger(scaled)?BigInt(scaled):null;
}
/** Current repeatable-read comparison only, not historical reconstruction or approval. */
export async function openingReconciliation(db:Pool,shopId:string,proposalId:string){
 if(!shopId?.trim()||!/^[-a-zA-Z0-9_]{1,100}$/.test(proposalId))throw Error('Valid opening proposal required.');
 const client=await db.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const proposal=(await client.query('SELECT cutover_date::text AS day,lines,total_cents::text AS total FROM ars_gl_opening_proposals WHERE shop_id=$1 AND id=$2',[shopId,proposalId])).rows[0];
  if(!proposal)throw Error('Opening proposal not found in this shop.');
  const lines=proposal.lines as JournalLine[];
  if(validateJournal(lines).totalCents!==proposal.total||new Set(lines.map(l=>l.accountCode)).size!==lines.length)throw Error('Opening proposal integrity check failed.');
  const proposed=new Map(lines.map(l=>[l.accountCode,moneyCents(l.debit)-moneyCents(l.credit)]));
  const maps=(await client.query('SELECT m.mapping_kind AS kind,m.source_id AS source,m.account_code AS code,a.active,a.kind AS classification FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1',[shopId])).rows;
  const financial=(await client.query(`SELECT a.id,a.name,a.kind,a.active,COALESCE(sum(m.amount),0)::numeric(16,2)::text AS balance FROM ars_financial_accounts a LEFT JOIN ars_financial_movements m ON m.shop_id=a.shop_id AND m.account_id=a.id WHERE a.shop_id=$1 GROUP BY a.id,a.name,a.kind,a.active ORDER BY a.id`,[shopId])).rows;
  const totals=(await client.query(`SELECT (NOW() AT TIME ZONE 'Asia/Colombo')::date::text AS day,
   (SELECT COALESCE(sum(credit_balance) FILTER(WHERE credit_balance>0),0)::numeric(16,2)::text FROM customers WHERE shop_id=$1) AS receivables,
   (SELECT COALESCE(sum(credit_balance) FILTER(WHERE credit_balance<0),0)::numeric(16,2)::text FROM customers WHERE shop_id=$1) AS customer_credits,
   (SELECT COALESCE(sum(CASE WHEN entry_type='Contribution' THEN amount_lkr WHEN entry_type='Drawing' THEN -amount_lkr ELSE 0 END),0)::numeric(16,2)::text FROM ars_partner_capital_entries WHERE shop_id=$1) AS capital`,[shopId])).rows[0];
  const inventory=await inventoryValuation(client,shopId);
  const suppliers=await supplierPayableAging(client,shopId);
  const rows:{kind:string;source:string;label:string;accountCode:string|null;expected:string|null;proposed:string|null;difference:string|null;status:string;note:string}[]=[];
  const used=new Set<string>();
  const compare=(kind:string,source:string,label:string,expected:bigint|null,classification:string,note='',review=false)=>{
   const m=maps.find(x=>x.kind===kind&&x.source===source);
   const code=m?.code??null;
   if(code)used.add(code);
   const actual=code?(proposed.get(code)??0n):null;
   const difference=actual!==null&&expected!==null?actual-expected:null;
   const status=!m?'Unmapped':!m.active||m.classification!==classification||review||expected===null?'Review':difference===0n?'Matched':'Mismatch';
   rows.push({kind,source,label,accountCode:code,expected:expected===null?null:decimal(expected),proposed:actual===null?null:decimal(actual),difference:difference===null?null:decimal(difference),status,note});
  };
  for(const a of financial){
   const value=signedCents(a.balance);
   if(!a.active&&value===0n)continue;
   compare('financialAccount',a.id,a.name,value,'Asset',a.kind==='Settlement'?'Settlement classification requires manual review.':!a.active?'Inactive account with balance.':value<0n?'Negative balance requires liability review.':'',!a.active||a.kind==='Settlement'||value<0n);
  }
  compare('receivables','control','Customer receivables',signedCents(totals.receivables),'Asset','Current customer balances; verify individual statements.');
  compare('customerCredits','control','Customer credits',signedCents(totals.customer_credits),'Liability');
  compare('inventory','control','Inventory valuation',inventory.complete?estimatedCents(inventory.totalValue!):null,'Asset','Operational carrying value; physical stock and cost verification required.',!inventory.complete);
  const supplierEstimate=estimatedCents(suppliers.estimatedPayable);
  compare('supplierPayables','control','Supplier payables',supplierEstimate===null?null:-supplierEstimate,'Liability','Received purchase-order estimate only; supplier invoices must be reconciled.',true);
  compare('capital','control','Partner capital',-signedCents(totals.capital),'Equity','Contribution/drawing ledger only; opening equity completeness requires review.',true);
  for(const l of lines)if(!used.has(l.accountCode))rows.push({kind:'unverified',source:l.accountCode,label:'Other proposed opening balance',accountCode:l.accountCode,expected:null,proposed:decimal(proposed.get(l.accountCode)!),difference:null,status:'Review',note:'Independent evidence required; no automatic operational comparison.'});
  await client.query('COMMIT');
  const snapshot={proposalId,cutoverDate:proposal.day,asOf:totals.day,rows:rows.sort((a,b)=>a.kind.localeCompare(b.kind)||a.source.localeCompare(b.source)),matched:rows.filter(r=>r.status==='Matched').length,needsReview:rows.filter(r=>r.status!=='Matched').length,supplierIssues:suppliers.needsReview,inventoryIssues:inventory.flagged,operationallyReconciled:false,activationAllowed:false,note:'Current snapshot comparison only. Cannot establish balances at historical or future cutover dates. Documentary reconciliation and explicit activation approval remain required.'};
  return {...snapshot,snapshotHash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
