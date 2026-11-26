// Record operator-supplied review evidence, not automatic reconciliation or startup approval.
import {open,lstat,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {inspectWriterLoss} from './writer-loss-inspection.mjs';
const categories=['databaseIdentity','previousSession','recoverableBackup','invoices','payments','inventory','accounting'];
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const validEvidence=e=>e&&Object.keys(e).length===categories.length&&categories.every(k=>Object.hasOwn(e,k)&&hex(e[k]));
const blocked={startupAllowed:false,recoveryAllowed:false};
export async function recordWriterLossReview(runtimeRoot,evidence,confirmation){
 if(confirmation!=='RECORD INCIDENT REVIEW'||!validEvidence(evidence))throw Error('Explicit review evidence required.');
 const root=resolve(runtimeRoot);
 const incident=await inspectWriterLoss(root);
 if(incident.state!=='reconciliation-required')throw Error('Valid incident required.');
 const record={schema:1,incidentDigest:incident.incidentDigest,reviewedAt:new Date().toISOString(),evidence:Object.fromEntries(categories.map(k=>[k,evidence[k]])),operatorAttestationOnly:true,...blocked};
 const target=join(root,'.ars-writer-loss-review.json');
 const file=await open(target,'wx',0o600);
 try{await file.writeFile(JSON.stringify(record)+'\n');await file.sync();}finally{await file.close();}
 if(process.platform!=='win32'){const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}}
 const check=await inspectWriterLossReview(root);
 if(check.state!=='review-recorded')throw Error('Review evidence no longer matches incident.');
 return {reviewRecorded:true,incidentRetained:true,...blocked};
}
export async function inspectWriterLossReview(runtimeRoot){
 const root=resolve(runtimeRoot);
 const incident=await inspectWriterLoss(root);
 if(incident.state!=='reconciliation-required')return {state:'incident-unavailable',...blocked};
 try{
  const target=join(root,'.ars-writer-loss-review.json');
  let stat;
  try{stat=await lstat(target);}catch(e){if(e.code==='ENOENT')return {state:'review-not-recorded',...blocked};throw e;}
  if(!stat.isFile()||stat.size>8192)throw Error('Invalid review file.');
  const r=JSON.parse(await readFile(target,'utf8'));
  if(r.schema!==1||r.incidentDigest!==incident.incidentDigest||!validEvidence(r.evidence)||r.operatorAttestationOnly!==true||r.startupAllowed!==false||r.recoveryAllowed!==false||typeof r.reviewedAt!=='string'||!Number.isFinite(Date.parse(r.reviewedAt)))throw Error('Invalid review evidence.');
  return {state:'review-recorded',reviewedAt:r.reviewedAt,operatorAttestationOnly:true,...blocked};
 }catch{return {state:'unreadable-or-mismatched',...blocked};}
}
