import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {postJournal} from './ledgerPosting';

const identity=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=200;
const day=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v>='1900-01-01'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
type Payment={id:string;accrualId:string;accountId:string;amount:string;expectedOutstanding:string;postingDate:string;currentBusinessDate:string;evidence:string};

/** Actual posted payroll only, not approved but unposted proposals. */
export async function listSalaryBalances(db:Pool,shopId:string,employeeId?:string){
 if(!identity(shopId)||(employeeId!==undefined&&!identity(employeeId)))throw Error('Valid salary shop and employee required.');
 return (await db.query(`SELECT a.id,a.employee_id,a.employee_name,a.period_key,a.posting_date::text,
 COALESCE(d.net_salary,a.gross_amount)::text AS net_salary,COALESCE(p.paid,0)::text AS paid,
 (COALESCE(d.net_salary,a.gross_amount)-COALESCE(p.paid,0))::text AS outstanding,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=a.shop_id AND j.source_kind='Reversal' AND
 (j.source_id=a.journal_id OR EXISTS(SELECT 1 FROM ars_gl_salary_payments s WHERE s.shop_id=a.shop_id AND s.accrual_id=a.id AND s.journal_id=j.source_id))) AS reconciliation_required
 FROM ars_gl_payroll_accruals a LEFT JOIN ars_gl_payroll_details d ON d.shop_id=a.shop_id AND d.proposal_id=a.id
 LEFT JOIN LATERAL(SELECT SUM(amount) AS paid FROM ars_gl_salary_payments WHERE shop_id=a.shop_id AND accrual_id=a.id) p ON TRUE
 WHERE a.shop_id=$1 AND ($2::text IS NULL OR a.employee_id=$2) ORDER BY a.period_key DESC,a.employee_name,a.id`,[shopId,employeeId??null])).rows;
}

/** Internal only pending payroll acceptance. No public payment endpoint. */
export async function payAccruedSalary(db:Pool,shopId:string,actor:string,i:Payment){
 if(!i||![shopId,actor,i.id,i.accrualId,i.accountId].every(identity)||!day(i.postingDate)||!day(i.currentBusinessDate)||i.postingDate>i.currentBusinessDate||typeof i.evidence!=='string'||!i.evidence.trim()||i.evidence.trim().length>500)throw Error('Valid salary payment and evidence required.');
 const amount=moneyCents(i.amount),expected=moneyCents(i.expectedOutstanding);
 if(amount<=0n||amount>99999999999999n||expected<amount)throw Error('Valid salary payment amount and outstanding balance required.');
 const value=decimal(amount),journalId='salary-payment:'+i.id,evidence=i.evidence.trim();
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['salary-payment:'+shopId]);
  const prior=(await c.query(`SELECT s.*,s.posting_date::text AS day,m.amount::text AS movement_amount,m.account_id AS movement_account,m.effective_date::text AS movement_day,m.recorded_by AS movement_actor
   FROM ars_gl_salary_payments s LEFT JOIN ars_financial_movements m ON m.shop_id=s.shop_id AND m.id=s.journal_id AND m.movement_kind='Salary Payment' AND m.source_id=s.id
   WHERE s.shop_id=$1 AND s.id=$2`,[shopId,i.id])).rows[0];
  if(prior){
   if(prior.accrual_id!==i.accrualId||prior.financial_account_id!==i.accountId||moneyCents(String(prior.amount))!==amount||prior.day!==i.postingDate||prior.evidence!==evidence||prior.recorded_by!==actor||prior.journal_id!==journalId||prior.movement_amount!=='-'+value||prior.movement_account!==i.accountId||prior.movement_day!==i.postingDate||prior.movement_actor!==actor)throw Error('Salary payment identifier already used or requires reconciliation.');
   await c.query('COMMIT');return {id:i.id,journalId,replayed:true};
  }
  if(i.postingDate!==i.currentBusinessDate)throw Error('New salary payment must use current business date.');
  const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[shopId])).rows[0];
  if(!cut?.posting_enabled||i.postingDate<cut.day)throw Error('Verified accounting required for salary payment.');
  const a=(await c.query(`SELECT a.*,a.posting_date::text AS day,COALESCE(d.net_salary,a.gross_amount)::text AS net
   FROM ars_gl_payroll_accruals a LEFT JOIN ars_gl_payroll_details d ON d.shop_id=a.shop_id AND d.proposal_id=a.id
   WHERE a.shop_id=$1 AND a.id=$2 FOR UPDATE OF a`,[shopId,i.accrualId])).rows[0];
  if(!a||a.day>i.postingDate)throw Error('Matching accrued payroll required.');
  const paid=(await c.query('SELECT COALESCE(SUM(amount),0)::text AS amount,MAX(posting_date)::text AS latest FROM ars_gl_salary_payments WHERE shop_id=$1 AND accrual_id=$2',[shopId,i.accrualId])).rows[0];
  const outstanding=moneyCents(a.net)-moneyCents(paid.amount);
  if(outstanding!==expected||amount>outstanding||(paid.latest&&paid.latest>i.postingDate))throw Error('Salary outstanding balance changed. Refresh and review.');
  if((await c.query(`SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=$1 AND j.source_kind='Reversal' AND
   (j.source_id=$2 OR EXISTS(SELECT 1 FROM ars_gl_salary_payments s WHERE s.shop_id=$1 AND s.accrual_id=$3 AND s.journal_id=j.source_id))`,[shopId,a.journal_id,i.accrualId])).rowCount)throw Error('Reversed payroll or payment requires reconciliation.');
  const account=(await c.query("SELECT id FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active AND kind IN ('Office Cash','Bank') FOR UPDATE",[shopId,i.accountId])).rows[0];
  if(!account)throw Error('Active bank or office cash account required.');
  const funds=(await c.query(`SELECT (SELECT COALESCE(SUM(amount),0) FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2 AND effective_date<=$4)
   -(SELECT COALESCE(SUM(amount),0) FROM ars_supplier_cheques WHERE shop_id=$1 AND bank_account_id=$2 AND status='Issued') >= $3::numeric AS sufficient,
   NOT EXISTS(SELECT 1 FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2 AND effective_date>$4) AS no_future`,[shopId,i.accountId,value,i.postingDate])).rows[0];
  if(!funds?.sufficient||!funds.no_future)throw Error('Insufficient uncommitted funds or future movements require reconciliation.');
  const map=async(kind:string,source:string,classification:string)=>{
   const m=(await c.query('SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id=$3 AND a.kind=$4 AND a.active FOR SHARE OF a',[shopId,kind,source,classification])).rows[0];
   if(!m)throw Error('Missing active salary accounting mapping: '+kind);return m.code as string;
  };
  const payable=await map('salaryPayable','control','Liability'),financial=await map('financialAccount',i.accountId,'Asset');
  const liability=(await c.query('SELECT COALESCE(SUM(credit-debit),0)::text AS amount FROM ars_gl_lines WHERE shop_id=$1 AND journal_id=$2 AND account_code=$3',[shopId,a.journal_id,payable])).rows[0];
  if(moneyCents(liability.amount)!==moneyCents(a.net)||payable===financial)throw Error('Accrued salary liability requires reconciliation.');
  await c.query("INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note) VALUES($1,$2,$3,-$4::numeric,'Salary Payment',$5,$6,$7,$8)",[journalId,shopId,i.accountId,value,i.id,actor,i.postingDate,evidence]);
  const journal=await postJournal(c,{id:journalId,shopId,postingDate:i.postingDate,sourceKind:'SalaryPayment',sourceId:i.id,description:'Salary payment '+a.period_key,actor,lines:[{accountCode:payable,debit:value,credit:'0.00'},{accountCode:financial,debit:'0.00',credit:value}]});
  if(journal.replayed)throw Error('Existing salary payment journal requires reconciliation.');
  await c.query('INSERT INTO ars_gl_salary_payments(shop_id,id,accrual_id,financial_account_id,amount,posting_date,journal_id,evidence,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[shopId,i.id,i.accrualId,i.accountId,value,i.postingDate,journalId,evidence,actor]);
  await c.query('COMMIT');return {id:i.id,journalId,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
