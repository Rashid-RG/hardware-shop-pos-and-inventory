import type {Pool} from 'pg';
type Input={id:string;employeeId:string;effectiveMonth:string;classification:'StandardCoveredEmployee'|'RequiresSpecialReview';authorityReference:string;evidence:string};
const identity=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=200;
const evidence=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.trim().length<=500;
const month=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v)&&v>='1900-01';
export async function proposePayrollEligibility(db:Pool,shopId:string,actor:string,i:Input){
 if(!i||![shopId,actor,i.id,i.employeeId].every(identity)||!month(i.effectiveMonth)||!['StandardCoveredEmployee','RequiresSpecialReview'].includes(i.classification)||!evidence(i.authorityReference)||!evidence(i.evidence))throw Error('Valid employee eligibility proposal and evidence required.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-eligibility:'+shopId]);
  const old=(await c.query('SELECT * FROM ars_gl_payroll_eligibility WHERE shop_id=$1 AND id=$2',[shopId,i.id])).rows[0];
  if(old){
   if(old.employee_id!==i.employeeId||old.effective_month!==i.effectiveMonth||old.classification!==i.classification||old.authority_reference!==i.authorityReference.trim()||old.evidence!==i.evidence.trim()||old.submitted_by!==actor)throw Error('Eligibility request identifier already used with different details.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  const employee=(await c.query('SELECT name FROM employees WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,i.employeeId])).rows[0];
  if(!employee)throw Error('Employee not found in this shop.');
  if((await c.query("SELECT 1 FROM ars_gl_payroll_eligibility e LEFT JOIN ars_gl_payroll_eligibility_reviews r ON r.shop_id=e.shop_id AND r.eligibility_id=e.id WHERE e.shop_id=$1 AND e.employee_id=$2 AND e.effective_month=$3 AND r.decision IS DISTINCT FROM 'Rejected'",[shopId,i.employeeId,i.effectiveMonth])).rowCount)throw Error('Pending or approved eligibility record already exists for this month.');
  await c.query('INSERT INTO ars_gl_payroll_eligibility(shop_id,id,employee_id,employee_name,effective_month,classification,authority_reference,evidence,submitted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[shopId,i.id,i.employeeId,employee.name,i.effectiveMonth,i.classification,i.authorityReference.trim(),i.evidence.trim(),actor]);
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function reviewPayrollEligibility(db:Pool,shopId:string,actor:string,i:{id:string;decision:'Approved'|'Rejected';evidence:string}){
 if(!i||![shopId,actor,i.id].every(identity)||!['Approved','Rejected'].includes(i.decision)||!evidence(i.evidence))throw Error('Valid eligibility review and evidence required.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['payroll-eligibility:'+shopId]);
  const p=(await c.query('SELECT * FROM ars_gl_payroll_eligibility WHERE shop_id=$1 AND id=$2',[shopId,i.id])).rows[0];
  if(!p)throw Error('Eligibility record not found in this shop.');
  const old=(await c.query('SELECT * FROM ars_gl_payroll_eligibility_reviews WHERE shop_id=$1 AND eligibility_id=$2',[shopId,i.id])).rows[0];
  if(old){
   if(old.decision!==i.decision||old.reviewed_by!==actor||old.evidence!==i.evidence.trim())throw Error('Eligibility record already reviewed.');
   await c.query('COMMIT');return {id:i.id,replayed:true};
  }
  if(i.decision==='Approved'){
   if(p.submitted_by.trim().toLowerCase()===actor.trim().toLowerCase())throw Error('Independent eligibility reviewer required.');
   if(!(await c.query('SELECT 1 FROM employees WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,p.employee_id])).rowCount)throw Error('Employee not found in this shop.');
   if((await c.query("SELECT 1 FROM ars_gl_payroll_eligibility e JOIN ars_gl_payroll_eligibility_reviews r ON r.shop_id=e.shop_id AND r.eligibility_id=e.id WHERE e.shop_id=$1 AND e.employee_id=$2 AND e.effective_month=$3 AND r.decision='Approved'",[shopId,p.employee_id,p.effective_month])).rowCount)throw Error('Approved eligibility already exists for this month.');
   if((await c.query("SELECT 1 FROM ars_gl_payroll_details d JOIN ars_gl_payroll_proposals p ON p.shop_id=d.shop_id AND p.id=d.proposal_id JOIN ars_gl_payroll_reviews r ON r.shop_id=p.shop_id AND r.proposal_id=p.id WHERE p.shop_id=$1 AND p.employee_id=$2 AND p.period_key>=$3 AND r.decision='Approved' LIMIT 1",[shopId,p.employee_id,p.effective_month])).rowCount)throw Error('Approved payroll requires eligibility reconciliation before retrospective approval.');
  }
  await c.query('INSERT INTO ars_gl_payroll_eligibility_reviews(shop_id,eligibility_id,decision,evidence,reviewed_by) VALUES($1,$2,$3,$4,$5)',[shopId,i.id,i.decision,i.evidence.trim(),actor]);
  await c.query('COMMIT');return {id:i.id,replayed:false};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function listPayrollEligibility(db:Pool,shopId:string){
 if(!identity(shopId))throw Error('Valid payroll shop required.');
 return (await db.query('SELECT e.*,r.decision,r.evidence AS review_evidence,r.reviewed_by,r.reviewed_at FROM ars_gl_payroll_eligibility e LEFT JOIN ars_gl_payroll_eligibility_reviews r ON r.shop_id=e.shop_id AND r.eligibility_id=e.id WHERE e.shop_id=$1 ORDER BY e.effective_month DESC,e.employee_name,e.id',[shopId])).rows;
}
export async function effectivePayrollEligibility(db:Pool,shopId:string,employeeId:string,period:string){
 if(!identity(shopId)||!identity(employeeId)||!month(period))throw Error('Valid employee and payroll month required.');
 const rows=(await db.query("SELECT e.*,r.reviewed_by,r.reviewed_at,r.decision FROM ars_gl_payroll_eligibility e LEFT JOIN ars_gl_payroll_eligibility_reviews r ON r.shop_id=e.shop_id AND r.eligibility_id=e.id JOIN employees s ON s.shop_id=e.shop_id AND s.id=e.employee_id WHERE e.shop_id=$1 AND e.employee_id=$2 AND e.effective_month<=$3 AND r.decision IS DISTINCT FROM 'Rejected' ORDER BY e.effective_month DESC,e.id LIMIT 2",[shopId,employeeId,period])).rows;
 if(!rows.length)throw Error('No employee eligibility record for this month.');
 if(rows.length>1&&rows[0].effective_month===rows[1].effective_month)throw Error('Conflicting eligibility records require reconciliation.');
 if(rows[0].decision!=='Approved')throw Error('Latest employee eligibility requires independent approval.');
 if(rows[0].classification!=='StandardCoveredEmployee')throw Error('Employee requires special statutory review.');
 return rows[0];
}
