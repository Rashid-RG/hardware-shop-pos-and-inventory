import type {Pool,PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {calculatePayroll,calculateStatutoryPayroll,type PayrollCalculationInput} from './payrollCalculation';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
import {effectivePayrollPolicy} from './payrollPolicies';
import {effectivePayrollEligibility} from './payrollEligibility';

type Proposal={id:string;employeeId:string;period:string;expectedBaseSalary:string;postingDate:string;evidence:string;currentBusinessDate:string;calculation?:PayrollCalculationInput;statutory?:{policyId:string;eligibilityId:string;eligibilityEvidence:string;sourceInputs:PayrollCalculationInput;expectedResults:ReturnType<typeof calculatePayroll>}};
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

// AdvanceRecovery component IDs are explicit disbursement references, not free-text deductions.
// Proposals do not reserve or settle balances; approval and eventual posting must revalidate.
async function verifyAdvanceDeductions(c:PoolClient,shopId:string,employeeId:string,postingDate:string,inputs:PayrollCalculationInput){
 for(const d of inputs.deductions.filter(d=>d.kind==='AdvanceRecovery')){
  const prefix='advance:';
  if(!d.id.startsWith(prefix)||!identity(d.id.slice(prefix.length)))throw Error('Advance recovery requires a disbursement reference.');
  const id=d.id.slice(prefix.length);
  const row=(await c.query(`SELECT a.amount::text AS issued,a.posting_date::text AS day,
  (SELECT COALESCE(SUM(r.amount),0)::text FROM ars_gl_employee_advance_recoveries r WHERE r.shop_id=a.shop_id AND r.disbursement_id=a.id) AS recovered
  FROM ars_gl_employee_advance_disbursements a WHERE a.shop_id=$1 AND a.id=$2 AND a.employee_id=$3 FOR UPDATE`,[shopId,id,employeeId])).rows[0];
  if(!row||row.day>postingDate)throw Error('Advance recovery requires matching disbursement before payroll date.');
  const balance=moneyCents(row.issued)-moneyCents(row.recovered);
  if(moneyCents(d.amount)>balance)throw Error('Payroll recovery exceeds outstanding employee advance.');
  const reversed=(await c.query("SELECT 1 FROM ars_gl_journals j JOIN ars_gl_employee_advance_disbursements a ON a.shop_id=j.shop_id AND a.journal_id=j.source_id WHERE a.shop_id=$1 AND a.id=$2 AND j.source_kind='Reversal'",[shopId,id])).rowCount;
  if(reversed)throw Error('Reversed employee advance requires reconciliation.');
 }
}
export async function preparePayroll(db:Pool,shopId:string,actor:string,i:Proposal){
 if(!i||![shopId,actor,i.id,i.employeeId].every(identity)||!validDay(i.postingDate)||!validDay(i.currentBusinessDate)||i.postingDate>i.currentBusinessDate||i.period!==i.postingDate.slice(0,7)||!evidenceValid(i.evidence))throw Error('Valid payroll proposal and evidence required.');
 const cents=moneyCents(i.expectedBaseSalary),evidence=i.evidence.trim();
 if(cents<=0n||cents>99999999999999n)throw Error('Positive base salary required.');
 const st=i.statutory;
 if(st!==undefined&&(!st||i.calculation!==undefined||!identity(st.policyId)||!identity(st.eligibilityId)||!evidenceValid(st.eligibilityEvidence)||!st.sourceInputs||!st.expectedResults))throw Error('Valid statutory snapshot request required.');
 if(!st&&i.calculation?.policyReference?.startsWith('statutory-policy:'))throw Error('Statutory calculations require verified source bindings.');
 const binding=(hash:string)=>st?createHash('sha256').update(canonical({version:1,shopId,proposalId:i.id,employeeId:i.employeeId,period:i.period,policyId:st.policyId,eligibilityId:st.eligibilityId,eligibilityEvidence:st.eligibilityEvidence.trim(),sourceInputs:st.sourceInputs,expectedResults:st.expectedResults,detailHash:hash})).digest('hex'):null;
 let detail=i.calculation===undefined?null:snapshot(i.calculation);
 if(detail&&moneyCents(detail.results.baseSalary)!==cents)throw Error('Payroll calculation base salary must match the proposal.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-proposal:'+shopId+':'+i.id]);
  if(st){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-policy:'+shopId]);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-eligibility:'+shopId]);}
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['employee-advance:'+shopId]);
  const prior=(await c.query('SELECT *,posting_date::text AS day FROM ars_gl_payroll_proposals WHERE shop_id=$1 AND id=$2',[shopId,i.id])).rows[0];
  if(prior){
   if(prior.employee_id!==i.employeeId||prior.period_key!==i.period||moneyCents(prior.base_salary)!==cents||prior.day!==i.postingDate||prior.evidence!==evidence||prior.submitted_by!==actor)throw Error('Payroll proposal identifier already used with different details.');
   const saved=(await c.query('SELECT snapshot_hash FROM ars_gl_payroll_details WHERE shop_id=$1 AND proposal_id=$2',[shopId,i.id])).rows[0];
   const bound=(await c.query('SELECT binding_hash FROM ars_gl_payroll_statutory_snapshots WHERE shop_id=$1 AND proposal_id=$2',[shopId,i.id])).rows[0];
   if(st?(!saved||!bound||bound.binding_hash!==binding(saved.snapshot_hash)):!!bound||(saved?.snapshot_hash??null)!==(detail?.hash??null))throw Error('Payroll proposal identifier already used with different calculation.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  if(st){
   const policy=await effectivePayrollPolicy(c as unknown as Pool,shopId,i.period);
   const eligibility=await effectivePayrollEligibility(c as unknown as Pool,shopId,i.employeeId,i.period);
   if(policy.id!==st.policyId||eligibility.id!==st.eligibilityId)throw Error('Statutory policy or eligibility changed. Recalculate payroll.');
   const derived=calculateStatutoryPayroll(st.sourceInputs,policy);
   if(canonical(derived.results)!==canonical(st.expectedResults))throw Error('Statutory calculation changed. Recalculate payroll.');
   detail=snapshot(derived.inputs);
   if(moneyCents(detail.results.baseSalary)!==cents)throw Error('Payroll calculation base salary must match the proposal.');
  }
  if(detail)await verifyAdvanceDeductions(c,shopId,i.employeeId,i.postingDate,detail.inputs);
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
  if(st&&detail)await c.query('INSERT INTO ars_gl_payroll_statutory_snapshots(shop_id,proposal_id,policy_id,eligibility_id,snapshot_version,source_inputs,eligibility_evidence,binding_hash,recorded_by) VALUES($1,$2,$3,$4,1,$5::jsonb,$6,$7,$8)',[shopId,i.id,st.policyId,st.eligibilityId,JSON.stringify(st.sourceInputs),st.eligibilityEvidence.trim(),binding(detail.hash),actor]);
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function reviewPayroll(db:Pool,shopId:string,actor:string,i:Review){
 if(!i||![shopId,actor,i.proposalId].every(identity)||!['Approved','Rejected'].includes(i.decision)||!evidenceValid(i.evidence))throw Error('Valid payroll decision and evidence required.');
 const evidence=i.evidence.trim(),c=await db.connect();
 try{
  await c.query('BEGIN');
  // Same lock order as statutory preparation; serialize all approvals against source changes.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-policy:'+shopId]);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-eligibility:'+shopId]);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['employee-advance:'+shopId]);
  const p=(await c.query('SELECT *,posting_date::text AS day FROM ars_gl_payroll_proposals WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,i.proposalId])).rows[0];
  if(!p)throw Error('Payroll proposal not found in this shop.');
  const old=(await c.query('SELECT * FROM ars_gl_payroll_reviews WHERE shop_id=$1 AND proposal_id=$2',[shopId,i.proposalId])).rows[0];
  if(old){
   if(old.decision!==i.decision||old.evidence!==evidence||old.reviewed_by!==actor)throw Error('Payroll proposal already reviewed.');
   await c.query('COMMIT');return {id:i.proposalId,replayed:true};
  }
  if(i.decision==='Approved'){
   const detail=(await c.query('SELECT * FROM ars_gl_payroll_details WHERE shop_id=$1 AND proposal_id=$2',[shopId,i.proposalId])).rows[0];
   const bound=(await c.query('SELECT * FROM ars_gl_payroll_statutory_snapshots WHERE shop_id=$1 AND proposal_id=$2',[shopId,i.proposalId])).rows[0];
   if(bound){
    if(!detail||bound.snapshot_version!==1||bound.recorded_by!==p.submitted_by||p.submitted_by.trim().toLowerCase()===actor.trim().toLowerCase())throw Error('Independent statutory payroll review and intact snapshot required.');
    const policy=await effectivePayrollPolicy(c as unknown as Pool,shopId,p.period_key);
    const eligibility=await effectivePayrollEligibility(c as unknown as Pool,shopId,p.employee_id,p.period_key);
    if(policy.id!==bound.policy_id||eligibility.id!==bound.eligibility_id)throw Error('Statutory policy or eligibility changed. Reject and prepare a new proposal.');
    const derived=calculateStatutoryPayroll(bound.source_inputs,policy);
    const verified=snapshot(derived.inputs);
    const hash=createHash('sha256').update(canonical({version:1,shopId,proposalId:p.id,employeeId:p.employee_id,period:p.period_key,policyId:bound.policy_id,eligibilityId:bound.eligibility_id,eligibilityEvidence:bound.eligibility_evidence,sourceInputs:bound.source_inputs,expectedResults:derived.results,detailHash:verified.hash})).digest('hex');
    if(hash!==bound.binding_hash||verified.hash!==detail.snapshot_hash||canonical(derived.inputs)!==canonical(detail.inputs)||canonical(derived.results)!==canonical(detail.results))throw Error('Statutory payroll snapshot integrity verification failed.');
   }else if(detail?.inputs?.policyReference?.startsWith('statutory-policy:'))throw Error('Statutory calculations require verified source bindings.');
   if(detail){
    const verified=snapshot(detail.inputs);
    const d=verified.results;
    await verifyAdvanceDeductions(c,shopId,p.employee_id,p.day,verified.inputs);
    if(detail.calculation_version!==1||verified.hash!==detail.snapshot_hash||canonical(d)!==canonical(detail.results)||moneyCents(d.baseSalary)!==moneyCents(p.base_salary)||moneyCents(d.grossSalary)!==moneyCents(detail.gross_salary)||moneyCents(d.totalDeductions)!==moneyCents(detail.total_deductions)||moneyCents(d.netSalary)!==moneyCents(detail.net_salary)||moneyCents(d.employerContributions)!==moneyCents(detail.employer_contributions)||moneyCents(d.employerCost)!==moneyCents(detail.employer_cost))throw Error('Payroll calculation integrity verification failed.');
   }

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
 a.id AS accrual_id,a.journal_id,d.snapshot_hash,d.gross_salary::text,d.total_deductions::text,d.net_salary::text,d.employer_contributions::text,d.employer_cost::text,d.inputs AS calculation_inputs,d.results AS calculation_results,s.policy_id AS statutory_policy_id,s.eligibility_id AS statutory_eligibility_id,s.binding_hash AS statutory_binding_hash
 FROM ars_gl_payroll_proposals p LEFT JOIN ars_gl_payroll_reviews r ON r.shop_id=p.shop_id AND r.proposal_id=p.id
 LEFT JOIN ars_gl_payroll_accruals a ON a.shop_id=p.shop_id AND a.id=p.id
 LEFT JOIN ars_gl_payroll_details d ON d.shop_id=p.shop_id AND d.proposal_id=p.id
 LEFT JOIN ars_gl_payroll_statutory_snapshots s ON s.shop_id=p.shop_id AND s.proposal_id=p.id
 WHERE p.shop_id=$1 AND p.period_key=$2 ORDER BY p.submitted_at DESC,p.id DESC`,[shopId,period])).rows;
}
