import type {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {calculatePayroll,type PayrollCalculationInput} from './payrollCalculation';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';

type Proposal={id:string;employeeId:string;period:string;expectedBaseSalary:string;postingDate:string;evidence:string;currentBusinessDate:string;calculation?:PayrollCalculationInput};
type Review={proposalId:string;decision:'Approved'|'Rejected';evidence:string};
const identity=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=200;
const evidenceValid=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.trim().length<=500;
const validDay=(d:string)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d&&d>='1900-01-01';

// Canonical object keys make the evidence hash stable through PostgreSQL JSONB round trips.
function canonical(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object'){const o=value as Record<string,unknown>;return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';}
 throw Error('Invalid payroll snapshot data.');
}
function snapshot(inputs:PayrollCalculationInput){
 const results=calculatePayroll(inputs);
 const hash=createHash('sha256').update(canonical({version:1,inputs,results})).digest('hex');
 return {inputs,results,hash};
}
export async function preparePayroll(db:Pool,shopId:string,actor:string,i:Proposal){
 if(!i||![shopId,actor,i.id,i.employeeId].every(identity)||!validDay(i.postingDate)||!validDay(i.currentBusinessDate)||i.postingDate>i.currentBusinessDate||i.period!==i.postingDate.slice(0,7)||!evidenceValid(i.evidence))throw Error('Valid payroll proposal and evidence required.');
 const cents=moneyCents(i.expectedBaseSalary),evidence=i.evidence.trim();
 if(cents<=0n||cents>99999999999999n)throw Error('Positive base salary required.');
 const detail=i.calculation===undefined?null:snapshot(i.calculation);
 if(detail&&moneyCents(detail.results.baseSalary)!==cents)throw Error('Payroll calculation base salary must match the proposal.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-proposal:'+shopId+':'+i.id]);
  const prior=(await c.query('SELECT *,posting_date::text AS day FROM ars_gl_payroll_proposals WHERE shop_id=$1 AND id=$2',[shopId,i.id])).rows[0];
  if(prior){
   if(prior.employee_id!==i.employeeId||prior.period_key!==i.period||moneyCents(prior.base_salary)!==cents||prior.day!==i.postingDate||prior.evidence!==evidence||prior.submitted_by!==actor)throw Error('Payroll proposal identifier already used with different details.');
   const saved=(await c.query('SELECT snapshot_hash FROM ars_gl_payroll_details WHERE shop_id=$1 AND proposal_id=$2',[shopId,i.id])).rows[0];
   if((saved?.snapshot_hash??null)!==(detail?.hash??null))throw Error('Payroll proposal identifier already used with different calculation.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  const employee=(await c.query('SELECT name,salary::text AS salary FROM employees WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,i.employeeId])).rows[0];
  if(!employee)throw Error('Employee not found in this shop.');
  if(moneyCents(employee.salary)!==cents)throw Error('Base salary changed. Refresh and review payroll.');
  if((await c.query('SELECT 1 FROM ars_gl_payroll_accruals WHERE shop_id=$1 AND employee_id=$2 AND period_key=$3',[shopId,i.employeeId,i.period])).rowCount)throw Error('Employee payroll already accrued for this month.');
  if((await c.query("SELECT 1 FROM ars_gl_payroll_proposals p LEFT JOIN ars_gl_payroll_reviews r ON r.shop_id=p.shop_id AND r.proposal_id=p.id WHERE p.shop_id=$1 AND p.employee_id=$2 AND p.period_key=$3 AND r.decision IS DISTINCT FROM 'Rejected'",[shopId,i.employeeId,i.period])).rowCount)throw Error('An unresolved or approved payroll proposal already exists for this month.');
  await c.query('INSERT INTO ars_gl_payroll_proposals(shop_id,id,employee_id,employee_name,period_key,base_salary,posting_date,evidence,submitted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[shopId,i.id,i.employeeId,employee.name,i.period,decimal(cents),i.postingDate,evidence,actor]);
  if(detail){
   const d=detail.results;
   await c.query('INSERT INTO ars_gl_payroll_details(shop_id,proposal_id,calculation_version,inputs,results,snapshot_hash,gross_salary,total_deductions,net_salary,employer_contributions,employer_cost,recorded_by) VALUES($1,$2,1,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11)',[shopId,i.id,JSON.stringify(detail.inputs),JSON.stringify(d),detail.hash,d.grossSalary,d.totalDeductions,d.netSalary,d.employerContributions,d.employerCost,actor]);
  }
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function reviewPayroll(db:Pool,shopId:string,actor:string,i:Review){
 if(!i||![shopId,actor,i.proposalId].every(identity)||!['Approved','Rejected'].includes(i.decision)||!evidenceValid(i.evidence))throw Error('Valid payroll decision and evidence required.');
 const evidence=i.evidence.trim(),c=await db.connect();
 try{
  await c.query('BEGIN');
  const p=(await c.query('SELECT * FROM ars_gl_payroll_proposals WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,i.proposalId])).rows[0];
  if(!p)throw Error('Payroll proposal not found in this shop.');
  const old=(await c.query('SELECT * FROM ars_gl_payroll_reviews WHERE shop_id=$1 AND proposal_id=$2',[shopId,i.proposalId])).rows[0];
  if(old){
   if(old.decision!==i.decision||old.evidence!==evidence||old.reviewed_by!==actor)throw Error('Payroll proposal already reviewed.');
   await c.query('COMMIT');return {id:i.proposalId,replayed:true};
  }
  if(i.decision==='Approved'){
   const employee=(await c.query('SELECT salary::text AS salary FROM employees WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,p.employee_id])).rows[0];
   if(!employee||moneyCents(employee.salary)!==moneyCents(p.base_salary))throw Error('Employee or base salary changed. Reject and prepare a new proposal.');
   if((await c.query('SELECT 1 FROM ars_gl_payroll_accruals WHERE shop_id=$1 AND employee_id=$2 AND period_key=$3',[shopId,p.employee_id,p.period_key])).rowCount)throw Error('Employee payroll already accrued for this month.');
  }
  await c.query('INSERT INTO ars_gl_payroll_reviews(shop_id,proposal_id,decision,evidence,reviewed_by) VALUES($1,$2,$3,$4,$5)',[shopId,i.proposalId,i.decision,evidence,actor]);
  await c.query('COMMIT');return {id:i.proposalId,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function listPayrollProposals(db:Pool,shopId:string,period:string){
 if(!identity(shopId)||typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Valid payroll month required.');
 return (await db.query(`SELECT p.id,p.employee_id,p.employee_name,p.period_key,p.base_salary::text,p.posting_date::text,p.evidence,p.submitted_by,p.submitted_at,
 r.decision,r.evidence AS review_evidence,r.reviewed_by,r.reviewed_at,
 a.id AS accrual_id,a.journal_id,d.snapshot_hash,d.gross_salary::text,d.total_deductions::text,d.net_salary::text,d.employer_contributions::text,d.employer_cost::text,d.inputs AS calculation_inputs,d.results AS calculation_results
 FROM ars_gl_payroll_proposals p LEFT JOIN ars_gl_payroll_reviews r ON r.shop_id=p.shop_id AND r.proposal_id=p.id
 LEFT JOIN ars_gl_payroll_accruals a ON a.shop_id=p.shop_id AND a.id=p.id
 LEFT JOIN ars_gl_payroll_details d ON d.shop_id=p.shop_id AND d.proposal_id=p.id
 WHERE p.shop_id=$1 AND p.period_key=$2 ORDER BY p.submitted_at DESC,p.id DESC`,[shopId,period])).rows;
}
