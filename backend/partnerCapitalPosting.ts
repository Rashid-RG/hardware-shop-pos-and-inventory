import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {postJournal} from './ledgerPosting';

type Input={id:string;shopId:string;partnerId:string;accountId:string;entryType:'Contribution'|'Drawing';amount:string;date:string;reference:string;note:string;actor:string;currentBusinessDate:string};
const validDay=(d:string)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export async function postPartnerCapital(db:Pool,i:Input){
 if(![i.id,i.shopId,i.partnerId,i.accountId,i.actor].every(v=>typeof v==='string'&&v.trim()&&v.length<=200)||!['Contribution','Drawing'].includes(i.entryType)||typeof i.reference!=='string'||!i.reference.trim()||i.reference.trim().length>120||typeof i.note!=='string'||i.note.length>1000||!validDay(i.date)||!validDay(i.currentBusinessDate)||i.date>i.currentBusinessDate)throw Error('Invalid partner capital transaction details.');
 const amount=moneyCents(i.amount);if(amount<=0n||amount>99999999999999n)throw Error('Invalid partner capital amount.');
 const value=decimal(amount),signed=i.entryType==='Contribution'?value:'-'+value;
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['partner-capital:'+i.shopId+':'+i.id]);
  const prior=(await c.query(`SELECT e.*,e.entry_date::text AS day,m.account_id,m.amount::text AS movement_amount,j.id AS journal_id
    FROM ars_partner_capital_entries e LEFT JOIN ars_financial_movements m ON m.shop_id=e.shop_id AND m.source_id=e.id AND m.movement_kind='Partner Capital'
    LEFT JOIN ars_gl_journals j ON j.shop_id=e.shop_id AND j.source_id=e.id AND j.source_kind='PartnerCapital'
    WHERE e.shop_id=$1 AND e.id=$2`,[i.shopId,i.id])).rows;
  if(prior.length){
   const p=prior[0];
   if(prior.length!==1||p.partner_id!==i.partnerId||p.entry_type!==i.entryType||moneyCents(String(p.amount_lkr))!==amount||p.day!==i.date||p.reference!==i.reference.trim()||p.note!==i.note.trim()||p.created_by!==i.actor||p.account_id!==i.accountId||p.movement_amount!==signed||p.journal_id!=='partner-capital:'+i.id)throw Error('Capital request already used or requires reconciliation.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[i.shopId])).rows[0];
  if(!cut?.posting_enabled||i.date<cut.day)throw Error('Verified accounting required for partner capital posting.');
  const partner=(await c.query('SELECT id FROM ars_business_partners WHERE shop_id=$1 AND id=$2 AND is_active FOR UPDATE',[i.shopId,i.partnerId])).rows[0];
  if(!partner)throw Error('Active partner required in this shop.');
  const account=(await c.query("SELECT id FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active AND kind IN ('Bank','Office Cash') FOR UPDATE",[i.shopId,i.accountId])).rows[0];
  if(!account)throw Error('Active bank or office cash account required.');
  if(i.entryType==='Drawing'){
   const funds=(await c.query(`SELECT (SELECT COALESCE(SUM(amount),0) FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2)-(SELECT COALESCE(SUM(amount),0) FROM ars_supplier_cheques WHERE shop_id=$1 AND bank_account_id=$2 AND status='Issued') >= $3::numeric AS sufficient`,[i.shopId,i.accountId,value])).rows[0];
   if(!funds?.sufficient)throw Error('Insufficient uncommitted funds for partner drawing.');
  }
  const map=async(kind:string,source:string,classification:string)=>{
   const a=(await c.query('SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id=$3 AND a.kind=$4 AND a.active FOR SHARE OF a',[i.shopId,kind,source,classification])).rows[0];
   if(!a)throw Error('Missing active accounting mapping: '+kind);return a.code as string;
  };
  const financial=await map('financialAccount',i.accountId,'Asset'),equity=await map(i.entryType==='Contribution'?'partnerCapital':'partnerDrawings',i.partnerId,'Equity');
  const debit=i.entryType==='Contribution'?financial:equity,credit=i.entryType==='Contribution'?equity:financial;
  await c.query('INSERT INTO ars_partner_capital_entries(id,shop_id,partner_id,entry_type,amount_lkr,entry_date,reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[i.id,i.shopId,i.partnerId,i.entryType,value,i.date,i.reference.trim(),i.note.trim(),i.actor]);
  await c.query("INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note) VALUES($1,$2,$3,$4,'Partner Capital',$5,$6,$7,$8)",['partner-capital:'+i.id,i.shopId,i.accountId,signed,i.id,i.actor,i.date,i.reference.trim()]);
  await postJournal(c,{id:'partner-capital:'+i.id,shopId:i.shopId,postingDate:i.date,sourceKind:'PartnerCapital',sourceId:i.id,description:'Partner '+i.entryType.toLowerCase()+' '+i.reference.trim(),actor:i.actor,lines:[{accountCode:debit,debit:value,credit:'0.00'},{accountCode:credit,debit:'0.00',credit:value}]});
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
