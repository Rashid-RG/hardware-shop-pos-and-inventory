// Local reviewer attestation only. No authenticated reviewer identity or live clearance.
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectReconciliationEvidence} from './writer-loss-reconciliation-evidence.mjs';
const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,continuousExclusionVerified:false,reviewerIdentityVerified:false,independenceVerified:false};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const validText=(v,max)=>typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const decisions=['Review accepted','Further investigation required'];
async function canonicalRoot(input){
 if(typeof input!=='string'||!isAbsolute(input))throw Error('Absolute runtime required.');
 const root=resolve(input),s=await lstat(root),actual=await realpath(root);
 if(!s.isDirectory()||(process.platform==='win32'?actual.toLowerCase()!==root.toLowerCase():actual!==root))throw Error('Invalid runtime.');
 return root;
}
export function matchesReviewDecision(record,evidence){
 return record?.schema===1&&record.kind==='recovery-review-decision'&&evidence?.state==='evidence-matched'&&hex(evidence.evidenceDigest)&&record.evidenceDigest===evidence.evidenceDigest&&validText(record.reviewer,160)&&validText(record.reference,240)&&decisions.includes(record.decision)&&typeof record.recordedAt==='string'&&Number.isFinite(Date.parse(record.recordedAt))&&record.attestationOnly===true&&Object.keys(blocked).every(k=>record[k]===false)&&(record.decision!=='Review accepted'||(evidence.allSectionsAvailable===true&&Object.values(evidence.sections??{}).length===8&&Object.values(evidence.sections).every(s=>['selected-checks-match','estimate-review'].includes(s))));
}
export async function recordReviewDecision(runtimeRoot,input,confirmation){
 if(confirmation!=='RECORD RECOVERY REVIEW DECISION'||!hex(input?.evidenceDigest)||!validText(input.reviewer,160)||!validText(input.reference,240)||!decisions.includes(input.decision))throw Error('Explicit review decision and evidence fingerprint required.');
 const root=await canonicalRoot(runtimeRoot),evidence=await inspectReconciliationEvidence(root);
 const record={schema:1,kind:'recovery-review-decision',evidenceDigest:input.evidenceDigest,reviewer:input.reviewer,reference:input.reference,decision:input.decision,recordedAt:new Date().toISOString(),attestationOnly:true,...blocked};
 if(!matchesReviewDecision(record,evidence))throw Error('Evidence stale or unresolved diagnostic sections.');
 const final=await inspectReconciliationEvidence(root);
 if(!matchesReviewDecision(record,final))throw Error('Evidence changed.');
 const file=await open(join(root,'.ars-recovery-review-decision.json'),'wx',0o600);
 try{await file.writeFile(JSON.stringify(record)+'\n');await file.sync();}finally{await file.close();}
 if(process.platform!=='win32'){const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}}
 const result=await inspectReviewDecision(root);
 if(result.state!=='review-decision-matched')throw Error('Retained decision requires investigation.');
 return result;
}
export async function inspectReviewDecision(runtimeRoot){
 try{
  const root=await canonicalRoot(runtimeRoot),path=join(root,'.ars-recovery-review-decision.json');
  let s;try{s=await lstat(path);}catch(e){if(e.code==='ENOENT')return {state:'review-decision-missing',...blocked};throw e;}
  const actual=await realpath(path);
  if(!s.isFile()||s.size<1||s.size>8192||(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path))throw Error('Invalid decision.');
  const f=await open(path,'r');let bytes;
  try{
   const a=await f.stat();if(a.dev!==s.dev||a.ino!==s.ino||a.size!==s.size)throw Error('Decision changed.');
   bytes=Buffer.alloc(s.size+1);
   const {bytesRead}=await f.read(bytes,0,bytes.length,0),z=await f.stat();
   if(bytesRead!==s.size||z.size!==s.size||z.mtimeMs!==s.mtimeMs||z.ctimeMs!==s.ctimeMs)throw Error('Decision changed.');
   bytes=bytes.subarray(0,bytesRead);
  }finally{await f.close();}
  const record=JSON.parse(bytes.toString('utf8')),evidence=await inspectReconciliationEvidence(root),last=await lstat(path);
  if(last.dev!==s.dev||last.ino!==s.ino||last.size!==s.size||last.mtimeMs!==s.mtimeMs||last.ctimeMs!==s.ctimeMs||!matchesReviewDecision(record,evidence))throw Error('Decision stale.');
  return {state:'review-decision-matched',decision:record.decision,decisionDigest:createHash('sha256').update(bytes).digest('hex'),recordedAt:record.recordedAt,attestationOnly:true,...blocked};
 }catch{return {state:'review-decision-invalid-or-stale',...blocked};}
}
