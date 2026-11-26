// Retained diagnostic evidence only; not clearance or proof of accounting accuracy.
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectWriterLoss} from './writer-loss-inspection.mjs';
import {inspectRecoveryRequest} from './writer-loss-recovery-request.mjs';
import {offlineRecoveryDiagnostics} from './writer-loss-offline-diagnostics.mjs';
const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,continuousExclusionVerified:false};
const keys=['business','financial','stockPayables','partnerPayroll','partner','imports','payroll','inventory'];
const statuses=['selected-checks-match','estimate-review','review-required','no-coverage','unavailable'];
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function summarizeEvidence(report){
 const r=report?.reconciliation;
 if(report?.startupAllowed!==false||report?.recoveryAllowed!==false||report.checks?.databaseIdentityMatched!==true||r?.consistentAcrossSections!==true||r.accountingVerified!==false||r.startupAllowed!==false||r.recoveryAllowed!==false||!r.sections||!keys.every(k=>statuses.includes(r.sections[k])))throw Error('Valid unified diagnostic snapshot required.');
 return {sections:Object.fromEntries(keys.map(k=>[k,r.sections[k]])),allSectionsAvailable:keys.every(k=>r.sections[k]!=='unavailable'),consistentAcrossSections:true};
}
async function canonicalRoot(input){
 if(typeof input!=='string'||!isAbsolute(input))throw Error('Absolute runtime required.');
 const root=resolve(input),s=await lstat(root),actual=await realpath(root);
 if(!s.isDirectory()||(process.platform==='win32'?actual.toLowerCase()!==root.toLowerCase():actual!==root))throw Error('Invalid runtime.');
 return root;
}
async function binding(root){
 const incident=await inspectWriterLoss(root),request=await inspectRecoveryRequest(root);
 if(incident.state!=='reconciliation-required'||request.state!=='request-matched'||!hex(incident.incidentDigest)||!hex(request.requestDigest))throw Error('Retained incident and recovery request required.');
 return {incidentDigest:incident.incidentDigest,requestDigest:request.requestDigest};
}
export function matchesReconciliationEvidence(record,b){
 return record?.schema===1&&record.kind==='reconciliation-snapshot-evidence'&&hex(b?.incidentDigest)&&hex(b?.requestDigest)&&record.incidentDigest===b.incidentDigest&&record.requestDigest===b.requestDigest&&typeof record.recordedAt==='string'&&Number.isFinite(Date.parse(record.recordedAt))&&record.consistentAcrossSections===true&&record.observationOnly===true&&Object.keys(blocked).every(k=>record[k]===false)&&record.sections&&keys.every(k=>statuses.includes(record.sections[k]))&&Object.keys(record.sections).length===keys.length&&record.allSectionsAvailable===keys.every(k=>record.sections[k]!=='unavailable');
}
export async function recordReconciliationEvidence(runtimeRoot,expected,confirmation){
 if(confirmation!=='RETAIN RECONCILIATION EVIDENCE')throw Error('Explicit operator confirmation required.');
 const root=await canonicalRoot(runtimeRoot),before=await binding(root);
 const summary=summarizeEvidence(await offlineRecoveryDiagnostics(root,expected));
 const after=await binding(root);
 if(before.incidentDigest!==after.incidentDigest||before.requestDigest!==after.requestDigest)throw Error('Recovery evidence changed.');
 const record={schema:1,kind:'reconciliation-snapshot-evidence',recordedAt:new Date().toISOString(),...before,...summary,observationOnly:true,...blocked};
 const file=await open(join(root,'.ars-reconciliation-evidence.json'),'wx',0o600);
 try{await file.writeFile(JSON.stringify(record)+'\n');await file.sync();}finally{await file.close();}
 if(process.platform!=='win32'){const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}}
 const result=await inspectReconciliationEvidence(root);
 if(result.state!=='evidence-matched')throw Error('Retained evidence requires investigation.');
 return result;
}
export async function inspectReconciliationEvidence(runtimeRoot){
 try{
  const root=await canonicalRoot(runtimeRoot),path=join(root,'.ars-reconciliation-evidence.json');
  let s;
  try{s=await lstat(path);}catch(e){if(e.code==='ENOENT')return {state:'evidence-missing',...blocked};throw e;}
  const actual=await realpath(path);
  if(!s.isFile()||s.size<1||s.size>8192||(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path))throw Error('Invalid evidence.');
  const file=await open(path,'r');
  let bytes;
  try{
   const a=await file.stat();
   if(a.dev!==s.dev||a.ino!==s.ino||a.size!==s.size)throw Error('Evidence changed.');
   bytes=Buffer.alloc(s.size+1);
   const {bytesRead}=await file.read(bytes,0,bytes.length,0);
   const z=await file.stat();
   if(bytesRead!==s.size||z.size!==s.size||z.mtimeMs!==s.mtimeMs||z.ctimeMs!==s.ctimeMs)throw Error('Evidence changed.');
   bytes=bytes.subarray(0,bytesRead);
  }finally{await file.close();}
  const record=JSON.parse(bytes.toString('utf8')),b=await binding(root),last=await lstat(path);
  if(last.dev!==s.dev||last.ino!==s.ino||last.size!==s.size||last.mtimeMs!==s.mtimeMs||last.ctimeMs!==s.ctimeMs||!matchesReconciliationEvidence(record,b))throw Error('Evidence mismatch.');
  return {state:'evidence-matched',evidenceDigest:createHash('sha256').update(bytes).digest('hex'),recordedAt:record.recordedAt,sections:record.sections,allSectionsAvailable:record.allSectionsAvailable,observationOnly:true,...blocked};
 }catch{return {state:'evidence-invalid-or-stale',...blocked};}
}
