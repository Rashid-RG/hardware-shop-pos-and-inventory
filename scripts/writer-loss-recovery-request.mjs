// Records a request for recovery review, never grants live recovery.
import {open,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {inspectWriterLoss} from './writer-loss-inspection.mjs';
import {verifyIncidentBackup} from './writer-loss-backup.mjs';
import {inspectIncidentRestoreReceipt} from './writer-loss-restore-receipt.mjs';
const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,continuousExclusionVerified:false};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
async function hashFile(path){
 const s=await lstat(path);
 const actual=await realpath(path);
 if(!s.isFile()||s.size<1||s.size>16384||(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path))throw Error('Invalid evidence file.');
 const f=await open(path,'r');
 try{
  const a=await f.stat();
  if(a.dev!==s.dev||a.ino!==s.ino||a.size!==s.size)throw Error('Evidence changed.');
  const bytes=await f.readFile();
  const b=await f.stat();
  if(bytes.length!==s.size||b.size!==s.size||b.mtimeMs!==s.mtimeMs||b.ctimeMs!==s.ctimeMs)throw Error('Evidence changed.');
  return {digest:createHash('sha256').update(bytes).digest('hex'),record:JSON.parse(bytes.toString('utf8'))};
 }finally{await f.close();}
}
async function snapshot(root){
 const incident=await inspectWriterLoss(root);
 if(incident.state!=='reconciliation-required')throw Error('Valid incident required.');
 const review=join(root,'.ars-writer-loss-review.json');
 const receipt=join(root,'writer-loss-evidence',incident.incidentDigest,'isolated-restore-receipt.json');
 const firstReview=await hashFile(review),firstReceipt=await hashFile(receipt);
 const backup=await verifyIncidentBackup(root);
 const restored=await inspectIncidentRestoreReceipt(root);
 if(backup.state!=='archive-integrity-matched'||backup.incidentDigest!==incident.incidentDigest||restored.state!=='restore-receipt-matched')throw Error('Verified backup and matching restore receipt required.');
 if((await hashFile(review)).digest!==firstReview.digest||(await hashFile(receipt)).digest!==firstReceipt.digest||(await inspectWriterLoss(root)).incidentDigest!==incident.incidentDigest)throw Error('Recovery evidence changed.');
 return {incidentDigest:incident.incidentDigest,reviewDigest:firstReview.digest,restoreReceiptDigest:firstReceipt.digest,archiveSha256:backup.archiveSha256};
}
export function matchesRecoveryRequest(record,evidence){
 return record?.schema===1&&record.kind==='recovery-review-request'&&typeof record.id==='string'&&/^[a-f0-9-]{36}$/.test(record.id)&&typeof record.requestedAt==='string'&&Number.isFinite(Date.parse(record.requestedAt))&&record.operatorAttestationOnly===true&&Object.keys(blocked).every(k=>record[k]===false)&&['incidentDigest','reviewDigest','restoreReceiptDigest','archiveSha256'].every(k=>hex(evidence?.[k])&&record[k]===evidence[k]);
}
export async function recordRecoveryRequest(runtimeRoot,confirmation){
 if(confirmation!=='REQUEST RECOVERY REVIEW')throw Error('Explicit operator confirmation required.');
 const root=resolve(runtimeRoot),evidence=await snapshot(root);
 const record={schema:1,kind:'recovery-review-request',id:randomUUID(),requestedAt:new Date().toISOString(),...evidence,operatorAttestationOnly:true,...blocked};
 const f=await open(join(root,'.ars-recovery-request.json'),'wx',0o600);
 try{await f.writeFile(JSON.stringify(record)+'\n');await f.sync();}finally{await f.close();}
 if(process.platform!=='win32'){const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}}
 const result=await inspectRecoveryRequest(root);
 if(result.state!=='request-matched')throw Error('Retained request requires investigation.');
 return result;
}
export async function inspectRecoveryRequest(runtimeRoot){
 try{
  const root=resolve(runtimeRoot);
  const path=join(root,'.ars-recovery-request.json');
  let first;
  try{first=await hashFile(path);}catch(e){if(e.code==='ENOENT')return {state:'request-missing',...blocked};throw e;}
  const evidence=await snapshot(root);
  if(!matchesRecoveryRequest(first.record,evidence)||(await hashFile(path)).digest!==first.digest)throw Error('Request mismatch.');
  return {state:'request-matched',requestId:first.record.id,requestDigest:first.digest,operatorAttestationOnly:true,...blocked};
 }catch{return {state:'request-invalid-or-stale',...blocked};}
}
