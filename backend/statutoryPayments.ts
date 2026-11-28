import type {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {postJournal} from './ledgerPosting';

type Allocation={accrualId:string;amount:string;expectedOutstanding:string};
type Remittance={id:string;fund:'EPF'|'ETF';period:string;accountId:string;postingDate:string;currentBusinessDate:string;receiptReference:string;evidence:string;allocations:Allocation[]};
const valid=(v:unknown,n=200):v is string=>typeof v==='string'&&v.trim()===v&&!!v&&v.length<=n;
const day=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v>='1900-01-01'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');

/** Internal only: no operational route until accounting acceptance. */
export async function settleStatutoryRemittance(db:Pool,shopId:string,actor:string,i:Remittance){
 if(!i||![shopId,actor,i.id,i.accountId].every(v=>valid(v))||!['EPF','ETF'].includes(i.fund)||typeof i.period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.period)||!day(i.postingDate)||!day(i.currentBusinessDate)||i.postingDate>i.currentBusinessDate||!valid(i.receiptReference,160)||!valid(i.evidence,500)||!Array.isArray(i.allocations)||!i.allocations.length||i.allocations.length>500)throw Error('Valid statutory remittance and evidence required.');
 const allocations=i.allocations.map(a=>{
  if(!a||!valid(a.accrualId))throw Error('Valid payroll allocation required.');
  const amount=moneyCents(a.amount),expected=moneyCents(a.expectedOutstanding);
  if(amount<=0n||amount>99999999999999n||expected<amount)throw Error('Invalid statutory allocation amount.');
  return {accrualId:a.accrualId,amount,expected};
 }).sort((a,b)=>a.accrualId<b.accrualId?-1:a.accrualId>b.accrualId?1:0);
 if(new Set(allocations.map(a=>a.accrualId)).size!==allocations.length)throw Error('Duplicate payroll allocation.');
 const total=allocations.reduce((s,a)=>s+a.amount,0n);
 if(total>99999999999999n)throw Error('Remittance exceeds supported bank amount.');
 const prefix='statutory:'+hash(JSON.stringify([shopId,i.id]))+':';
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['statutory-settlement:'+shopId]);
  const prior=(await c.query(`SELECT s.*,s.posting_date::text AS day,a.period_key,m.amount::text AS movement_amount,m.account_id AS movement_account,m.effective_date::text AS movement_day,m.recorded_by AS movement_actor,
   EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=s.shop_id AND j.source_kind='Reversal' AND j.source_id IN (s.journal_id,a.journal_id)) AS reversed
   FROM ars_gl_statutory_settlements s JOIN ars_gl_payroll_accruals a ON a.shop_id=s.shop_id AND a.id=s.accrual_id
   LEFT JOIN ars_financial_movements m ON m.shop_id=s.shop_id AND m.id=s.journal_id AND m.source_id=s.id AND m.movement_kind='Statutory Settlement'
   WHERE s.shop_id=$1 AND left(s.id,length($2))=$2`,[shopId,prefix])).rows;
  if(prior.length){
   if(prior.length!==allocations.length||!allocations.every(a=>prior.some(p=>p.id===prefix+hash(a.accrualId)&&p.accrual_id===a.accrualId&&p.fund===i.fund&&p.period_key===i.period&&p.financial_account_id===i.accountId&&moneyCents(String(p.amount))===a.amount&&p.day===i.postingDate&&p.receipt_reference===i.receiptReference&&p.evidence===i.evidence&&p.recorded_by===actor&&p.journal_id===p.id&&p.movement_amount==='-'+decimal(a.amount)&&p.movement_account===i.accountId&&p.movement_day===i.postingDate&&p.movement_actor===actor&&!p.reversed)))throw Error('Remittance identifier already used or requires reconciliation.');
   await c.query('COMMIT');return {id:i.id,total:decimal(total),replayed:true};
  }
  if(i.postingDate!==i.currentBusinessDate)throw Error('New remittance must use current business date.');
  const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[shopId])).rows[0];
  if(!cut?.posting_enabled||i.postingDate<cut.day)throw Error('Verified accounting required for statutory remittance.');
  if((await c.query('SELECT 1 FROM ars_gl_statutory_settlements WHERE shop_id=$1 AND fund=$2 AND lower(trim(receipt_reference))=lower(trim($3)) LIMIT 1',[shopId,i.fund,i.receiptReference])).rowCount)throw Error('Receipt reference already used for this fund.');
  const account=(await c.query("SELECT id FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active AND kind='Bank' FOR UPDATE",[shopId,i.accountId])).rows[0];
  if(!account)throw Error('Active bank account required.');
  const funds=(await c.query(`SELECT (SELECT COALESCE(SUM(amount),0) FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2 AND effective_date<=$4)
   -(SELECT COALESCE(SUM(amount),0) FROM ars_supplier_cheques WHERE shop_id=$1 AND bank_account_id=$2 AND status='Issued') >= $3::numeric AS sufficient,
   NOT EXISTS(SELECT 1 FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2 AND effective_date>$4) AS no_future`,[shopId,i.accountId,decimal(total),i.postingDate])).rows[0];
  if(!funds?.sufficient||!funds.no_future)throw Error('Insufficient uncommitted bank funds or future movements require reconciliation.');
  const map=async(kind:string,source:string,classification:string)=>{
   const m=(await c.query('SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id=$3 AND a.kind=$4 AND a.active FOR SHARE OF a',[shopId,kind,source,classification])).rows[0];
   if(!m)throw Error('Missing active statutory accounting mapping: '+kind);return m.code as string;
  };
  const payable=await map(i.fund==='EPF'?'epfPayable':'etfPayable','control','Liability'),bank=await map('financialAccount',i.accountId,'Asset');
  for(const a of allocations){
   const accrual=(await c.query(`SELECT a.journal_id,a.posting_date::text AS day FROM ars_gl_payroll_accruals a
    JOIN ars_gl_payroll_statutory_snapshots s ON s.shop_id=a.shop_id AND s.proposal_id=a.id
    WHERE a.shop_id=$1 AND a.id=$2 AND a.period_key=$3 FOR UPDATE OF a`,[shopId,a.accrualId,i.period])).rows[0];
   if(!accrual||accrual.day>i.postingDate)throw Error('Matching posted statutory payroll for selected month required.');
   const balance=(await c.query(`SELECT (SELECT COALESCE(SUM(credit-debit),0) FROM ars_gl_lines WHERE shop_id=$1 AND journal_id=$2 AND account_code=$3)::text AS liability,
    (SELECT COALESCE(SUM(amount),0) FROM ars_gl_statutory_settlements WHERE shop_id=$1 AND accrual_id=$4 AND fund=$5)::text AS settled`,[shopId,accrual.journal_id,payable,a.accrualId,i.fund])).rows[0];
   if(moneyCents(balance.liability)-moneyCents(balance.settled)!==a.expected)throw Error('Statutory outstanding changed. Refresh and review.');
   const id=prefix+hash(a.accrualId),value=decimal(a.amount);
   const journal=await postJournal(c,{id,shopId,postingDate:i.postingDate,sourceKind:'StatutorySettlement',sourceId:id,description:i.fund+' remittance '+i.period,actor,lines:[{accountCode:payable,debit:value,credit:'0.00'},{accountCode:bank,debit:'0.00',credit:value}]});
   if(journal.replayed)throw Error('Existing statutory journal requires reconciliation.');
   await c.query("INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note) VALUES($1,$2,$3,-$4::numeric,'Statutory Settlement',$1,$5,$6,$7)",[id,shopId,i.accountId,value,actor,i.postingDate,i.evidence]);
   await c.query('INSERT INTO ars_gl_statutory_settlements(shop_id,id,accrual_id,fund,financial_account_id,amount,posting_date,journal_id,receipt_reference,evidence,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$2,$8,$9,$10)',[shopId,id,a.accrualId,i.fund,i.accountId,value,i.postingDate,i.receiptReference,i.evidence,actor]);
  }
  await c.query('COMMIT');return {id:i.id,total:decimal(total),replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
