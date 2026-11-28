import type {Pool,PoolClient} from 'pg';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';
type ChargeKind='Freight'|'Customs'|'Clearance';
type Submission={id:string;shopId:string;approvalId:string;chargeKind:ChargeKind;creditorName:string;documentReference:string;amount:string;dueDate:string;evidence:string;actor:string};
const fields={Freight:'freightLkr',Customs:'customsLkr',Clearance:'clearanceLkr'} as const;
const valid=(s:unknown,max:number)=>typeof s==='string'&&s.trim().length>0&&s.trim().length<=max;
const day=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
async function tx<T>(db:Pool,fn:(c:PoolClient)=>Promise<T>){const c=await db.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function lockApproval(c:PoolClient,shopId:string,approvalId:string){
 const a=(await c.query('SELECT snapshot FROM ars_landed_cost_approvals WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,approvalId])).rows[0];
 if(!a)throw Error('Approved shipment not found.');
 return a.snapshot;
}
async function remaining(c:PoolClient,shopId:string,approvalId:string,kind:ChargeKind,snapshot:any){
 const cap=moneyCents(String(snapshot[fields[kind]]));
 const r=(await c.query(`SELECT (
 COALESCE((SELECT sum(amount) FROM ars_import_expense_links WHERE shop_id=$1 AND approval_id=$2 AND charge_kind=$3),0)+
 COALESCE((SELECT sum(o.amount) FROM ars_gl_import_obligations o JOIN ars_gl_import_obligation_reviews r ON r.shop_id=o.shop_id AND r.obligation_id=o.id AND r.decision='Approved' WHERE o.shop_id=$1 AND o.approval_id=$2 AND o.charge_kind=$3),0)
 )::numeric(24,2)::text AS used`,[shopId,approvalId,kind])).rows[0];
 const free=cap-moneyCents(r.used);
 if(free<0n)throw Error('Existing import charges require reconciliation.');
 return free;
}
export async function submitImportObligation(db:Pool,input:Submission){
 if(![input.id,input.shopId,input.approvalId,input.actor].every(x=>valid(x,160))||!Object.prototype.hasOwnProperty.call(fields,input.chargeKind)||!valid(input.creditorName,200)||!valid(input.documentReference,200)||!valid(input.evidence,500)||!day(input.dueDate))throw Error('Valid creditor, document, due date and evidence required.');
 const amount=moneyCents(input.amount);if(amount<=0n)throw Error('Positive obligation amount required.');
 const values=[input.shopId,input.id,input.approvalId,input.chargeKind,input.creditorName.trim(),input.documentReference.trim(),decimal(amount),input.dueDate,input.evidence.trim(),input.actor];
 return tx(db,async c=>{
 const snapshot=await lockApproval(c,input.shopId,input.approvalId);
 const old=(await c.query('SELECT approval_id,charge_kind,creditor_name,document_reference,amount::text,due_date::text,evidence,submitted_by FROM ars_gl_import_obligations WHERE shop_id=$1 AND id=$2',values.slice(0,2))).rows[0];
 if(old){if(JSON.stringify(Object.values(old))!==JSON.stringify(values.slice(2)))throw Error('Obligation identifier already used.');return {id:input.id,replayed:true};}
 if(amount>await remaining(c,input.shopId,input.approvalId,input.chargeKind,snapshot))throw Error('Obligation exceeds remaining approved charge.');
 await c.query('INSERT INTO ars_gl_import_obligations(shop_id,id,approval_id,charge_kind,creditor_name,document_reference,amount,due_date,evidence,submitted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',values);
 return {id:input.id,replayed:false};
 });
}
export async function reviewImportObligation(db:Pool,input:{shopId:string;id:string;actor:string;decision:'Approved'|'Rejected';evidence:string}){
 if(![input.shopId,input.id,input.actor].every(x=>valid(x,160))||!valid(input.evidence,500)||!['Approved','Rejected'].includes(input.decision))throw Error('Valid obligation review required.');
 return tx(db,async c=>{
 const o=(await c.query('SELECT * FROM ars_gl_import_obligations WHERE shop_id=$1 AND id=$2',[input.shopId,input.id])).rows[0];
 if(!o)throw Error('Import obligation not found.');
 const snapshot=await lockApproval(c,input.shopId,o.approval_id);
 if(o.submitted_by===input.actor)throw Error('Independent obligation reviewer required.');
 const prior=(await c.query('SELECT decision,evidence,reviewed_by FROM ars_gl_import_obligation_reviews WHERE shop_id=$1 AND obligation_id=$2',[input.shopId,input.id])).rows[0];
 if(prior){if(prior.decision!==input.decision||prior.evidence!==input.evidence.trim()||prior.reviewed_by!==input.actor)throw Error('Obligation review already recorded.');return {id:input.id,replayed:true};}
 if(input.decision==='Approved'&&moneyCents(String(o.amount))>await remaining(c,input.shopId,o.approval_id,o.charge_kind,snapshot))throw Error('Obligation exceeds remaining approved charge.');
 await c.query('INSERT INTO ars_gl_import_obligation_reviews(shop_id,obligation_id,decision,evidence,reviewed_by) VALUES($1,$2,$3,$4,$5)',[input.shopId,input.id,input.decision,input.evidence.trim(),input.actor]);
 return {id:input.id,replayed:false};
 });
}
export async function listImportObligations(db:Pool,shopId:string,approvalId:string){
 return (await db.query('SELECT o.*,r.decision,r.reviewed_by,r.reviewed_at,r.evidence AS review_evidence, COALESCE((SELECT sum(a.amount) FROM ars_gl_import_receipt_allocations a WHERE a.shop_id=o.shop_id AND a.obligation_id=o.id),0)::numeric(24,2)::text AS recognized, COALESCE((SELECT sum(s.amount) FROM ars_gl_import_settlements s WHERE s.shop_id=o.shop_id AND s.obligation_id=o.id),0)::numeric(24,2)::text AS settled, (COALESCE((SELECT sum(a.amount) FROM ars_gl_import_receipt_allocations a WHERE a.shop_id=o.shop_id AND a.obligation_id=o.id),0)-COALESCE((SELECT sum(s.amount) FROM ars_gl_import_settlements s WHERE s.shop_id=o.shop_id AND s.obligation_id=o.id),0))::numeric(24,2)::text AS outstanding FROM ars_gl_import_obligations o LEFT JOIN ars_gl_import_obligation_reviews r ON r.shop_id=o.shop_id AND r.obligation_id=o.id WHERE o.shop_id=$1 AND o.approval_id=$2 ORDER BY o.submitted_at DESC,o.id LIMIT 500',[shopId,approvalId])).rows;
}
