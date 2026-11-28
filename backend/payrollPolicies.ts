import type {Pool} from 'pg';
type PolicyInput={id:string;effectiveMonth:string;employeeEpfBp:number;employerEpfBp:number;employerEtfBp:number;eligibilityRules:Record<string,unknown>;authorityReference:string;evidence:string};
const identity=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=200;
const evidence=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.trim().length<=500;
const month=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v)&&v>='1900-01';
const rate=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=10000;
/** Documentary register only. Approval does not certify legal compliance or enable payroll posting. */
export async function proposePayrollPolicy(db:Pool,shopId:string,actor:string,i:PolicyInput){
 if(!i||![shopId,actor,i.id].every(identity)||!month(i.effectiveMonth)||![i.employeeEpfBp,i.employerEpfBp,i.employerEtfBp].every(rate)||!evidence(i.authorityReference)||!evidence(i.evidence)||!i.eligibilityRules||typeof i.eligibilityRules!=='object'||Array.isArray(i.eligibilityRules))throw Error('Valid payroll policy and documentary evidence required.');
 const rules=JSON.stringify(i.eligibilityRules);
 if(rules.length>10000||rules==='{}')throw Error('Documented eligibility rules required.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-policy:'+shopId]);
  const prior=(await c.query('SELECT *,eligibility_rules=$3::jsonb AS same_rules FROM ars_gl_payroll_policies WHERE shop_id=$1 AND id=$2',[shopId,i.id,rules])).rows[0];
  if(prior){
   if(!prior.same_rules||prior.effective_month!==i.effectiveMonth||prior.employee_epf_bp!==i.employeeEpfBp||prior.employer_epf_bp!==i.employerEpfBp||prior.employer_etf_bp!==i.employerEtfBp||prior.authority_reference!==i.authorityReference.trim()||prior.evidence!==i.evidence.trim()||prior.submitted_by!==actor)throw Error('Payroll policy identifier already used with different details.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  const conflict=await c.query("SELECT 1 FROM ars_gl_payroll_policies p LEFT JOIN ars_gl_payroll_policy_reviews r ON r.shop_id=p.shop_id AND r.policy_id=p.id WHERE p.shop_id=$1 AND p.effective_month=$2 AND r.decision IS DISTINCT FROM 'Rejected'",[shopId,i.effectiveMonth]);
  if(conflict.rowCount)throw Error('A pending or approved policy already exists for this effective month.');
  await c.query('INSERT INTO ars_gl_payroll_policies(shop_id,id,effective_month,employee_epf_bp,employer_epf_bp,employer_etf_bp,eligibility_rules,authority_reference,evidence,submitted_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)',[shopId,i.id,i.effectiveMonth,i.employeeEpfBp,i.employerEpfBp,i.employerEtfBp,rules,i.authorityReference.trim(),i.evidence.trim(),actor]);
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function reviewPayrollPolicy(db:Pool,shopId:string,actor:string,i:{id:string;decision:'Approved'|'Rejected';evidence:string}){
 if(!i||![shopId,actor,i.id].every(identity)||!['Approved','Rejected'].includes(i.decision)||!evidence(i.evidence))throw Error('Valid payroll policy review required.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-policy:'+shopId]);
  const p=(await c.query('SELECT * FROM ars_gl_payroll_policies WHERE shop_id=$1 AND id=$2',[shopId,i.id])).rows[0];
  if(!p)throw Error('Payroll policy not found in this shop.');
  const prior=(await c.query('SELECT * FROM ars_gl_payroll_policy_reviews WHERE shop_id=$1 AND policy_id=$2',[shopId,i.id])).rows[0];
  if(prior){
   if(prior.decision!==i.decision||prior.reviewed_by!==actor||prior.evidence!==i.evidence.trim())throw Error('Payroll policy already reviewed.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  if(i.decision==='Approved'){
   if(p.submitted_by.trim().toLowerCase()===actor.trim().toLowerCase())throw Error('Independent payroll policy reviewer required.');
   if((await c.query("SELECT 1 FROM ars_gl_payroll_policies p JOIN ars_gl_payroll_policy_reviews r ON r.shop_id=p.shop_id AND r.policy_id=p.id WHERE p.shop_id=$1 AND p.effective_month=$2 AND r.decision='Approved'",[shopId,p.effective_month])).rowCount)throw Error('Approved policy already exists for this effective month.');
   if((await c.query('SELECT 1 FROM ars_gl_payroll_details d JOIN ars_gl_payroll_proposals p ON p.shop_id=d.shop_id AND p.id=d.proposal_id JOIN ars_gl_payroll_reviews r ON r.shop_id=p.shop_id AND r.proposal_id=p.id WHERE p.shop_id=$1 AND p.period_key>=$2 AND r.decision=\'Approved\' LIMIT 1',[shopId,p.effective_month])).rowCount)throw Error('Existing approved detailed payroll requires policy reconciliation before retrospective approval.');
  }
  await c.query('INSERT INTO ars_gl_payroll_policy_reviews(shop_id,policy_id,decision,evidence,reviewed_by) VALUES($1,$2,$3,$4,$5)',[shopId,i.id,i.decision,i.evidence.trim(),actor]);
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function listPayrollPolicies(db:Pool,shopId:string){
 if(!identity(shopId))throw Error('Valid payroll shop required.');
 return (await db.query('SELECT p.*,r.decision,r.evidence AS review_evidence,r.reviewed_by,r.reviewed_at FROM ars_gl_payroll_policies p LEFT JOIN ars_gl_payroll_policy_reviews r ON r.shop_id=p.shop_id AND r.policy_id=p.id WHERE p.shop_id=$1 ORDER BY p.effective_month DESC,p.submitted_at DESC,p.id',[shopId])).rows;
}
export async function effectivePayrollPolicy(db:Pool,shopId:string,period:string){
 if(!identity(shopId)||!month(period))throw Error('Valid payroll month required.');
 const rows=(await db.query("SELECT p.*,r.reviewed_by,r.reviewed_at FROM ars_gl_payroll_policies p JOIN ars_gl_payroll_policy_reviews r ON r.shop_id=p.shop_id AND r.policy_id=p.id WHERE p.shop_id=$1 AND p.effective_month<=$2 AND r.decision='Approved' ORDER BY p.effective_month DESC,p.id LIMIT 2",[shopId,period])).rows;
 if(!rows.length)throw Error('No approved payroll policy for this month.');
 if(rows.length>1&&rows[0].effective_month===rows[1].effective_month)throw Error('Conflicting approved payroll policies require reconciliation.');
 return rows[0];
}
