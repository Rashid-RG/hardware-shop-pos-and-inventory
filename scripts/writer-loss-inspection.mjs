// Read-only incident evidence inspection. Never removes the startup marker.
import {lstat,realpath,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const blocked={startupAllowed:false,recoveryAllowed:false,requiresReview:true};
export async function inspectWriterLoss(runtimeRoot){
 try{
  const root=resolve(runtimeRoot);
  const actual=await realpath(root);
  if(!(await lstat(root)).isDirectory()||(process.platform==='win32'?actual.toLowerCase()!==root.toLowerCase():actual!==root))throw Error('Invalid runtime directory.');
  const target=join(root,'.ars-writer-loss.json');
  let stat;
  try{stat=await lstat(target);}catch(e){if(e.code==='ENOENT')return {state:'absent',startupAllowed:false,recoveryAllowed:false,requiresReview:false};throw e;}
  if(!stat.isFile()||stat.size<1||stat.size>8192)throw Error('Invalid incident evidence.');
  const file=await open(target,'r');
  let raw;
  try{
   const actualStat=await file.stat();
   if(!actualStat.isFile()||actualStat.dev!==stat.dev||actualStat.ino!==stat.ino||actualStat.size!==stat.size)throw Error('Incident changed.');
   const buffer=Buffer.alloc(8193);
   const {bytesRead}=await file.read(buffer,0,buffer.length,0);
   if(bytesRead!==stat.size)throw Error('Incident changed.');
   raw=buffer.subarray(0,bytesRead);
  }finally{await file.close();}
  const record=JSON.parse(raw.toString('utf8'));
  if(record.schema!==1||record.reason!=='writer-lease-lost'||record.reconciliationRequired!==true||!Number.isSafeInteger(record.pid)||record.pid<=0||typeof record.recordedAt!=='string'||!Number.isFinite(Date.parse(record.recordedAt)))throw Error('Invalid incident record.');
  return {state:'reconciliation-required',recordedAt:record.recordedAt,incidentDigest:createHash('sha256').update(raw).digest('hex'),...blocked};
 }catch{return {state:'unreadable-or-invalid',...blocked};}
}
