import type {Pool} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
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
