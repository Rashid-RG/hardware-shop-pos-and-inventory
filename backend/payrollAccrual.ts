import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {postJournal} from './ledgerPosting';

type Input={id:string;shopId:string;employeeId:string;period:string;expectedBaseSalary:string;postingDate:string;currentBusinessDate:string;actor:string;evidence:string};
const validDay=(d:string)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d&&d>='1900-01-01';

/** Posts only an approved base-salary proposal; statutory payroll and settlement are not implemented. */
export async function accrueBaseSalary(db:Pool,i:Input){
 if(!i||![i.id,i.shopId,i.employeeId,i.actor].every(v=>typeof v==='string'&&v.trim()&&v.length<=200)||typeof i.period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.period)||!validDay(i.postingDate)||!validDay(i.currentBusinessDate)||i.postingDate>i.currentBusinessDate||i.postingDate.slice(0,7)!==i.period||typeof i.evidence!=='string'||!i.evidence.trim()||i.evidence.trim().length>500)throw Error('Valid payroll period, date and evidence required.');
 const cents=moneyCents(i.expectedBaseSalary);
 if(cents<=0n||cents>99999999999999n)throw Error('Positive base salary required.');
 const amount=decimal(cents),evidence=i.evidence.trim(),journalId='payroll-accrual:'+i.id;
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-request:'+i.shopId+':'+i.id]);
  // Accrual identity is the approved proposal identity, not a new client request ID.
  const approved=(await c.query(`SELECT p.employee_id,p.employee_name,p.period_key,p.base_salary::text AS salary,p.posting_date::text AS day,p.evidence
   FROM ars_gl_payroll_proposals p JOIN ars_gl_payroll_reviews r ON r.shop_id=p.shop_id AND r.proposal_id=p.id AND r.decision='Approved'
   WHERE p.shop_id=$1 AND p.id=$2`,[i.shopId,i.id])).rows[0];
  if(!approved)throw Error('Approved payroll proposal required.');
  if((await c.query('SELECT 1 FROM ars_gl_payroll_details WHERE shop_id=$1 AND proposal_id=$2',[i.shopId,i.id])).rowCount)throw Error('Detailed payroll requires the advanced payroll posting workflow.');

  if(approved.employee_id!==i.employeeId||approved.period_key!==i.period||moneyCents(approved.salary)!==cents||approved.day!==i.postingDate||approved.evidence!==evidence)throw Error('Payroll posting must match the approved proposal.');
  const prior=(await c.query('SELECT *,posting_date::text AS day FROM ars_gl_payroll_accruals WHERE shop_id=$1 AND id=$2',[i.shopId,i.id])).rows[0];
  if(prior){
   if(prior.employee_id!==i.employeeId||prior.period_key!==i.period||moneyCents(String(prior.base_salary))!==cents||moneyCents(String(prior.gross_amount))!==cents||prior.day!==i.postingDate||prior.evidence!==evidence||prior.recorded_by!==i.actor||prior.journal_id!==journalId)throw Error('Payroll request identifier already used with different details.');
   await c.query('COMMIT');return {id:i.id,journalId,replayed:true};
  }
  const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[i.shopId])).rows[0];
  if(!cut?.posting_enabled||i.postingDate<cut.day)throw Error('Verified accounting required for payroll posting.');
  const employee=(await c.query('SELECT name,salary::text AS salary FROM employees WHERE shop_id=$1 AND id=$2 FOR UPDATE',[i.shopId,i.employeeId])).rows[0];
  if(!employee)throw Error('Employee not found in this shop.');
  if(moneyCents(employee.salary)!==cents)throw Error('Base salary changed. Refresh and review payroll before posting.');
  if((await c.query('SELECT 1 FROM ars_gl_payroll_accruals WHERE shop_id=$1 AND employee_id=$2 AND period_key=$3',[i.shopId,i.employeeId,i.period])).rowCount)throw Error('Employee payroll already accrued for this month.');
  const mapping=async(kind:string,classification:string)=>{
   const row=(await c.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id='control' AND a.kind=$3 AND a.active FOR SHARE OF a",[i.shopId,kind,classification])).rows[0];
   if(!row)throw Error('Missing active accounting mapping: '+kind);
   return row.code as string;
  };
  const expense=await mapping('salary','Expense'),payable=await mapping('salaryPayable','Liability');
  await postJournal(c,{id:journalId,shopId:i.shopId,postingDate:i.postingDate,sourceKind:'PayrollAccrual',sourceId:i.id,description:'Base salary accrual '+i.period,actor:i.actor,lines:[{accountCode:expense,debit:amount,credit:'0.00'},{accountCode:payable,debit:'0.00',credit:amount}]});
  await c.query('INSERT INTO ars_gl_payroll_accruals(shop_id,id,employee_id,employee_name,period_key,base_salary,gross_amount,posting_date,evidence,journal_id,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10)',[i.shopId,i.id,i.employeeId,approved.employee_name,i.period,amount,i.postingDate,evidence,journalId,i.actor]);
  await c.query('COMMIT');return {id:i.id,journalId,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

/** Resolve immutable approved terms server-side; callers cannot supply an amount or posting date. */
export async function postApprovedPayroll(db:Pool,shopId:string,proposalId:string,actor:string,currentBusinessDate:string){
 if(![shopId,proposalId,actor].every(v=>typeof v==='string'&&v.trim()&&v.length<=200)||!validDay(currentBusinessDate))throw Error('Valid payroll posting identity required.');
 const p=(await db.query(`SELECT p.employee_id,p.period_key,p.base_salary::text AS salary,p.posting_date::text AS day,p.evidence
 FROM ars_gl_payroll_proposals p JOIN ars_gl_payroll_reviews r ON r.shop_id=p.shop_id AND r.proposal_id=p.id AND r.decision='Approved'
 WHERE p.shop_id=$1 AND p.id=$2`,[shopId,proposalId])).rows[0];
 if(!p)throw Error('Approved payroll proposal required.');
 return accrueBaseSalary(db,{id:proposalId,shopId,employeeId:p.employee_id,period:p.period_key,expectedBaseSalary:p.salary,postingDate:p.day,currentBusinessDate,actor,evidence:p.evidence});
}
