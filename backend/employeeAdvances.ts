import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {postJournal} from './ledgerPosting';
type Input={id:string;employeeId:string;amount:string;requestedDate:string;currentBusinessDate:string;evidence:string};
const identity=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=200;
const evidence=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.trim().length<=500;
const day=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v>='1900-01-01'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export async function prepareEmployeeAdvance(db:Pool,shopId:string,actor:string,i:Input){
 if(!i||![shopId,actor,i.id,i.employeeId].every(identity)||!evidence(i.evidence)||!day(i.requestedDate)||!day(i.currentBusinessDate)||i.requestedDate>i.currentBusinessDate)throw Error('Valid employee advance request and evidence required.');
 const cents=moneyCents(i.amount);if(cents<=0n||cents>9999999999999999n)throw Error('Positive employee advance amount required.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['employee-advance:'+shopId]);
  const prior=(await c.query('SELECT *,amount::text AS amount_text,requested_date::text AS day FROM ars_gl_employee_advance_requests WHERE shop_id=$1 AND id=$2',[shopId,i.id])).rows[0];
  if(prior){
   if(prior.employee_id!==i.employeeId||moneyCents(prior.amount_text)!==cents||prior.day!==i.requestedDate||prior.evidence!==i.evidence.trim()||prior.submitted_by!==actor)throw Error('Advance request identifier already used with different details.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  const employee=(await c.query('SELECT name FROM employees WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,i.employeeId])).rows[0];
  if(!employee)throw Error('Employee not found in this shop.');
  await c.query('INSERT INTO ars_gl_employee_advance_requests(shop_id,id,employee_id,employee_name,amount,requested_date,evidence,submitted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[shopId,i.id,i.employeeId,employee.name,decimal(cents),i.requestedDate,i.evidence.trim(),actor]);
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function reviewEmployeeAdvance(db:Pool,shopId:string,actor:string,i:{id:string;decision:'Approved'|'Rejected';evidence:string}){
 if(!i||![shopId,actor,i.id].every(identity)||!['Approved','Rejected'].includes(i.decision)||!evidence(i.evidence))throw Error('Valid employee advance review required.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['employee-advance:'+shopId]);
  const request=(await c.query('SELECT * FROM ars_gl_employee_advance_requests WHERE shop_id=$1 AND id=$2',[shopId,i.id])).rows[0];
  if(!request)throw Error('Advance request not found in this shop.');
  const prior=(await c.query('SELECT * FROM ars_gl_employee_advance_reviews WHERE shop_id=$1 AND request_id=$2',[shopId,i.id])).rows[0];
  if(prior){
   if(prior.decision!==i.decision||prior.evidence!==i.evidence.trim()||prior.reviewed_by!==actor)throw Error('Advance request already reviewed.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  if(i.decision==='Approved'){
   if(request.submitted_by.trim().toLowerCase()===actor.trim().toLowerCase())throw Error('Independent advance reviewer required.');
   if(!(await c.query('SELECT 1 FROM employees WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,request.employee_id])).rowCount)throw Error('Employee not found in this shop.');
  }
  await c.query('INSERT INTO ars_gl_employee_advance_reviews(shop_id,request_id,decision,evidence,reviewed_by) VALUES($1,$2,$3,$4,$5)',[shopId,i.id,i.decision,i.evidence.trim(),actor]);
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function listEmployeeAdvanceRequests(db:Pool,shopId:string){
 if(!identity(shopId))throw Error('Valid payroll shop required.');
 return (await db.query('SELECT a.*,a.amount::text,a.requested_date::text,r.decision,r.evidence AS review_evidence,r.reviewed_by,r.reviewed_at FROM ars_gl_employee_advance_requests a LEFT JOIN ars_gl_employee_advance_reviews r ON r.shop_id=a.shop_id AND r.request_id=a.id WHERE a.shop_id=$1 ORDER BY a.requested_date DESC,a.submitted_at DESC,a.id',[shopId])).rows;
}

/** Internal only until reconciliation, permissions and integration tests are complete. */
export async function disburseEmployeeAdvance(db:Pool,shopId:string,actor:string,i:{id:string;requestId:string;accountId:string;expectedAmount:string;postingDate:string;currentBusinessDate:string;evidence:string}){
 if(!i||![shopId,actor,i.id,i.requestId,i.accountId].every(identity)||!evidence(i.evidence)||!day(i.postingDate)||!day(i.currentBusinessDate)||i.postingDate>i.currentBusinessDate)throw Error('Valid current-day employee advance disbursement required.');
 const amount=moneyCents(i.expectedAmount);
 if(amount<=0n||amount>99999999999999n)throw Error('Employee advance exceeds financial movement range.');
 const value=decimal(amount),journalId='employee-advance:'+i.id;
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['employee-advance:'+shopId]);
  const prior=(await c.query("SELECT d.*,d.posting_date::text AS day,m.amount::text AS movement_amount,m.account_id AS movement_account,m.effective_date::text AS movement_day,m.recorded_by AS movement_actor FROM ars_gl_employee_advance_disbursements d LEFT JOIN ars_financial_movements m ON m.shop_id=d.shop_id AND m.id=d.journal_id AND m.movement_kind='Employee Advance' AND m.source_id=d.id WHERE d.shop_id=$1 AND (d.id=$2 OR d.request_id=$3)",[shopId,i.id,i.requestId])).rows;
  if(prior.length){
   const p=prior[0];
   if(prior.length!==1||p.id!==i.id||p.request_id!==i.requestId||p.financial_account_id!==i.accountId||moneyCents(String(p.amount))!==amount||p.day!==i.postingDate||p.evidence!==i.evidence.trim()||p.recorded_by!==actor||p.journal_id!==journalId||p.movement_amount!=='-'+value||p.movement_account!==i.accountId||p.movement_day!==i.postingDate||p.movement_actor!==actor)throw Error('Employee advance already disbursed or requires reconciliation.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  if(i.postingDate!==i.currentBusinessDate)throw Error('New advance disbursement must use the current business date.');
  const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[shopId])).rows[0];
  if(!cut?.posting_enabled||i.postingDate<cut.day)throw Error('Verified accounting required for employee advance disbursement.');
  const request=(await c.query("SELECT a.*,a.requested_date::text AS day FROM ars_gl_employee_advance_requests a JOIN ars_gl_employee_advance_reviews r ON r.shop_id=a.shop_id AND r.request_id=a.id WHERE a.shop_id=$1 AND a.id=$2 AND r.decision='Approved'",[shopId,i.requestId])).rows[0];
  if(!request||request.day>i.postingDate||moneyCents(String(request.amount))!==amount)throw Error('Matching approved employee advance required.');
  if(!(await c.query('SELECT 1 FROM employees WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,request.employee_id])).rowCount)throw Error('Employee not found in this shop.');
  const account=(await c.query("SELECT id FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active AND kind IN ('Office Cash','Bank') FOR UPDATE",[shopId,i.accountId])).rows[0];
  if(!account)throw Error('Active bank or office cash account required.');
  const funds=(await c.query("SELECT (SELECT COALESCE(SUM(amount),0) FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2 AND effective_date<=$4)-(SELECT COALESCE(SUM(amount),0) FROM ars_supplier_cheques WHERE shop_id=$1 AND bank_account_id=$2 AND status='Issued') >= $3::numeric AS sufficient, NOT EXISTS(SELECT 1 FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2 AND effective_date>$4) AS no_future",[shopId,i.accountId,value,i.postingDate])).rows[0];
  if(!funds?.sufficient||!funds.no_future)throw Error('Insufficient uncommitted funds or future movements require reconciliation.');
  const map=async(kind:string,source:string)=>{
   const a=(await c.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id=$3 AND a.kind='Asset' AND a.active FOR SHARE OF a",[shopId,kind,source])).rows[0];
   if(!a)throw Error('Missing active employee advance accounting mapping: '+kind);return a.code as string;
  };
  const financial=await map('financialAccount',i.accountId),advance=await map('employeeAdvances','control');
  if(financial===advance)throw Error('Distinct employee advance and financial accounts required.');
  await c.query("INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note) VALUES($1,$2,$3,-$4::numeric,'Employee Advance',$5,$6,$7,$8)",[journalId,shopId,i.accountId,value,i.id,actor,i.postingDate,i.evidence.trim()]);
  const journal=await postJournal(c,{id:journalId,shopId,postingDate:i.postingDate,sourceKind:'EmployeeAdvanceDisbursement',sourceId:i.id,description:'Employee advance disbursement',actor,lines:[{accountCode:advance,debit:value,credit:'0.00'},{accountCode:financial,debit:'0.00',credit:value}]});
  if(journal.replayed)throw Error('Existing advance journal requires reconciliation.');
  await c.query('INSERT INTO ars_gl_employee_advance_disbursements(shop_id,id,request_id,employee_id,financial_account_id,amount,posting_date,journal_id,evidence,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[shopId,i.id,i.requestId,request.employee_id,i.accountId,value,i.postingDate,journalId,i.evidence.trim(),actor]);
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

/** Actual disbursements only; approved but unpaid requests are not receivables. */
export async function listEmployeeAdvanceBalances(db:Pool,shopId:string,employeeId?:string){
 if(!identity(shopId)||(employeeId!==undefined&&!identity(employeeId)))throw Error('Valid payroll shop and employee required.');
 return (await db.query(`SELECT d.id,d.request_id,d.employee_id,a.employee_name,d.posting_date::text,d.amount::text AS issued,
 COALESCE(r.recovered,0)::text AS recovered,(d.amount-COALESCE(r.recovered,0))::text AS outstanding,
 COALESCE(r.direct,0)::text AS direct_repayments,COALESCE(r.payroll,0)::text AS payroll_recoveries,
 d.journal_id
 FROM ars_gl_employee_advance_disbursements d JOIN ars_gl_employee_advance_requests a ON a.shop_id=d.shop_id AND a.id=d.request_id
 LEFT JOIN LATERAL (SELECT SUM(amount) AS recovered,SUM(amount) FILTER(WHERE recovery_kind='DirectRepayment') AS direct,SUM(amount) FILTER(WHERE recovery_kind='PayrollRecovery') AS payroll
 FROM ars_gl_employee_advance_recoveries WHERE shop_id=d.shop_id AND disbursement_id=d.id) r ON TRUE
 WHERE d.shop_id=$1 AND ($2::text IS NULL OR d.employee_id=$2) ORDER BY d.posting_date,d.id`,[shopId,employeeId??null])).rows;
}
/** Internal only. Direct cash receipts are distinct from payroll deductions. */
export async function repayEmployeeAdvance(db:Pool,shopId:string,actor:string,i:{id:string;disbursementId:string;accountId:string;amount:string;expectedOutstanding:string;postingDate:string;currentBusinessDate:string;evidence:string}){
 if(!i||![shopId,actor,i.id,i.disbursementId,i.accountId].every(identity)||!evidence(i.evidence)||!day(i.postingDate)||!day(i.currentBusinessDate)||i.postingDate>i.currentBusinessDate)throw Error('Valid employee advance repayment required.');
 const amount=moneyCents(i.amount),expected=moneyCents(i.expectedOutstanding);
 if(amount<=0n||amount>99999999999999n||expected<amount)throw Error('Valid repayment amount and outstanding balance required.');
 const value=decimal(amount),journalId='employee-advance-repayment:'+i.id;
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['employee-advance:'+shopId]);
  const prior=(await c.query("SELECT r.*,r.posting_date::text AS day,m.amount::text AS movement_amount,m.account_id AS movement_account,m.effective_date::text AS movement_day,m.recorded_by AS movement_actor FROM ars_gl_employee_advance_recoveries r LEFT JOIN ars_financial_movements m ON m.shop_id=r.shop_id AND m.id=r.journal_id AND m.movement_kind='Employee Advance' AND m.source_id=r.journal_id WHERE r.shop_id=$1 AND r.id=$2",[shopId,i.id])).rows[0];
  if(prior){
   if(prior.recovery_kind!=='DirectRepayment'||prior.disbursement_id!==i.disbursementId||prior.financial_account_id!==i.accountId||moneyCents(String(prior.amount))!==amount||prior.day!==i.postingDate||prior.evidence!==i.evidence.trim()||prior.recorded_by!==actor||prior.journal_id!==journalId||prior.movement_amount!==value||prior.movement_account!==i.accountId||prior.movement_day!==i.postingDate||prior.movement_actor!==actor)throw Error('Repayment identifier already used or requires reconciliation.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  if(i.postingDate!==i.currentBusinessDate)throw Error('New advance repayment must use the current business date.');
  const cut=(await c.query('SELECT posting_enabled,cutover_date::text AS day FROM ars_gl_cutover WHERE shop_id=$1 FOR SHARE',[shopId])).rows[0];
  if(!cut?.posting_enabled||i.postingDate<cut.day)throw Error('Verified accounting required for employee advance repayment.');
  const original=(await c.query('SELECT *,posting_date::text AS day FROM ars_gl_employee_advance_disbursements WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,i.disbursementId])).rows[0];
  if(!original||original.day>i.postingDate)throw Error('Matching disbursed advance required.');
  const recovered=(await c.query('SELECT COALESCE(SUM(amount),0)::text AS amount,MAX(posting_date)::text AS latest FROM ars_gl_employee_advance_recoveries WHERE shop_id=$1 AND disbursement_id=$2',[shopId,i.disbursementId])).rows[0];
  const outstanding=moneyCents(String(original.amount))-moneyCents(recovered.amount);
  if(outstanding!==expected||amount>outstanding||recovered.latest>i.postingDate)throw Error('Advance outstanding balance changed. Refresh and review.');
  const account=(await c.query("SELECT id FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active AND kind IN ('Office Cash','Bank') FOR UPDATE",[shopId,i.accountId])).rows[0];
  if(!account)throw Error('Active bank or office cash account required.');
  const map=async(kind:string,source:string)=>{
   const a=(await c.query("SELECT a.code FROM ars_gl_account_mappings m JOIN ars_gl_accounts a ON a.shop_id=m.shop_id AND a.code=m.account_code WHERE m.shop_id=$1 AND m.mapping_kind=$2 AND m.source_id=$3 AND a.kind='Asset' AND a.active FOR SHARE OF a",[shopId,kind,source])).rows[0];
   if(!a)throw Error('Missing active employee advance accounting mapping: '+kind);return a.code as string;
  };
  const financial=await map('financialAccount',i.accountId),advance=await map('employeeAdvances','control');
  if(financial===advance)throw Error('Distinct employee advance and financial accounts required.');
  await c.query("INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note) VALUES($1,$2,$3,$4,'Employee Advance',$1,$5,$6,$7)",[journalId,shopId,i.accountId,value,actor,i.postingDate,i.evidence.trim()]);
  const journal=await postJournal(c,{id:journalId,shopId,postingDate:i.postingDate,sourceKind:'EmployeeAdvanceRepayment',sourceId:i.id,description:'Employee advance direct repayment',actor,lines:[{accountCode:financial,debit:value,credit:'0.00'},{accountCode:advance,debit:'0.00',credit:value}]});
  if(journal.replayed)throw Error('Existing repayment journal requires reconciliation.');
  await c.query("INSERT INTO ars_gl_employee_advance_recoveries(shop_id,id,disbursement_id,employee_id,recovery_kind,financial_account_id,amount,posting_date,journal_id,evidence,recorded_by) VALUES($1,$2,$3,$4,'DirectRepayment',$5,$6,$7,$8,$9,$10)",[shopId,i.id,i.disbursementId,original.employee_id,i.accountId,value,i.postingDate,journalId,i.evidence.trim(),actor]);
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
