import type {Pool} from 'pg';
import {openingReconciliation} from './openingReconciliation';

type Evidence={kind:string;source:string;reference:string;explanation:string};
type Submission={id:string;proposalId:string;snapshotHash:string;evidence:Evidence[]};
const identifier=(s:unknown):s is string=>typeof s==='string'&&/^[-a-zA-Z0-9_]{1,100}$/.test(s);
const validText=(s:unknown,max:number):s is string=>typeof s==='string'&&s.trim().length>0&&s.trim().length<=max;
const key=(kind:string,source:string)=>JSON.stringify([kind,source]);

export async function listDocumentaryReviews(db:Pool,shopId:string,proposalId:string){
 if(!shopId?.trim()||!identifier(proposalId))throw Error('Valid opening proposal required.');
 return (await db.query('SELECT id,snapshot_hash AS "snapshotHash",snapshot,evidence,recorded_by,recorded_at FROM ars_gl_documentary_reviews WHERE shop_id=$1 AND proposal_id=$2 ORDER BY recorded_at DESC,id DESC LIMIT 20',[shopId,proposalId])).rows;
}

/** Records a review of a report, never a certification or authorization to post. */
export async function submitDocumentaryReview(db:Pool,shopId:string,actor:string,input:Submission){
 if(!shopId?.trim()||!actor?.trim()||!input||!identifier(input.id)||!identifier(input.proposalId)||typeof input.snapshotHash!=='string'||!/^[0-9a-f]{64}$/.test(input.snapshotHash)||!Array.isArray(input.evidence)||input.evidence.length<1||input.evidence.length>2000)throw Error('Valid documentary review required.');
 const evidence=input.evidence.map(e=>{
  if(!e||!validText(e.kind,100)||!validText(e.source,160)||!validText(e.reference,500)||!validText(e.explanation,1000))throw Error('Document reference and explanation required for each reconciliation row.');
  return {kind:e.kind.trim(),source:e.source.trim(),reference:e.reference.trim(),explanation:e.explanation.trim()};
 }).sort((a,b)=>a.kind.localeCompare(b.kind)||a.source.localeCompare(b.source));
 const keys=new Set(evidence.map(e=>key(e.kind,e.source)));
 if(keys.size!==evidence.length)throw Error('Duplicate documentary evidence row.');
 const replay=(row:any)=>{
  if(row.snapshot_hash!==input.snapshotHash||row.recorded_by!==actor||!Array.isArray(row.evidence)||row.evidence.length!==evidence.length||!evidence.every((e,i)=>e.kind===row.evidence[i].kind&&e.source===row.evidence[i].source&&e.reference===row.evidence[i].reference&&e.explanation===row.evidence[i].explanation))throw Error('Documentary review identifier already used.');
  return {id:input.id,replayed:true,postingActivated:false,operationallyReconciled:false};
 };
 const args=[shopId,input.proposalId,input.id];
 const previous=(await db.query('SELECT snapshot_hash,evidence,recorded_by FROM ars_gl_documentary_reviews WHERE shop_id=$1 AND proposal_id=$2 AND id=$3',args)).rows[0];
 if(previous)return replay(previous);
 // Recompute on the server. This is a historical observation, not a lock on live business activity.
 const snapshot=await openingReconciliation(db,shopId,input.proposalId);
 if(snapshot.snapshotHash!==input.snapshotHash)throw Error('Reconciliation snapshot changed. Refresh and review the new balances.');
 const required=new Set(snapshot.rows.map(r=>key(r.kind,r.source)));
 if(required.size!==snapshot.rows.length||required.size!==keys.size||[...required].some(k=>!keys.has(k)))throw Error('Evidence must cover every reconciliation row exactly once.');
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ars-gl-opening:'+shopId]);
  const old=(await client.query('SELECT snapshot_hash,evidence,recorded_by FROM ars_gl_documentary_reviews WHERE shop_id=$1 AND proposal_id=$2 AND id=$3',args)).rows[0];
  if(old){const result=replay(old);await client.query('COMMIT');return result;}
  const proposal=(await client.query('SELECT submitted_by FROM ars_gl_opening_proposals WHERE shop_id=$1 AND id=$2 FOR SHARE',[shopId,input.proposalId])).rows[0];
  if(!proposal)throw Error('Opening proposal not found in this shop.');
  if(proposal.submitted_by===actor)throw Error('An independent administrator must record documentary review.');
  if((await client.query("SELECT 1 FROM ars_gl_opening_reviews WHERE shop_id=$1 AND proposal_id=$2 AND decision='Rejected'",[shopId,input.proposalId])).rowCount)throw Error('Rejected proposal cannot receive a new documentary review.');
  if((await client.query('SELECT 1 FROM ars_gl_cutover WHERE shop_id=$1 AND posting_enabled',[shopId])).rowCount)throw Error('Accounting already active.');
  await client.query('INSERT INTO ars_gl_documentary_reviews(shop_id,proposal_id,id,snapshot_hash,snapshot,evidence,recorded_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',[...args,input.snapshotHash,JSON.stringify(snapshot),JSON.stringify(evidence),actor]);
  await client.query('COMMIT');
  return {id:input.id,replayed:false,postingActivated:false,operationallyReconciled:false};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
