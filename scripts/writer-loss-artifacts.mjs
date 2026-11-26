// Read-only integrity verification of operator review artifacts; not accounting reconciliation.
import {open,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectWriterLoss} from './writer-loss-inspection.mjs';
import {inspectWriterLossReview} from './writer-loss-review.mjs';
const categories=['databaseIdentity','previousSession','recoverableBackup','invoices','payments','inventory','accounting'];
const blocked={startupAllowed:false,recoveryAllowed:false};
async function boundedFile(path,limit){
 const before=await lstat(path);
 if(!before.isFile()||before.size<1||before.size>limit)throw Error('Invalid evidence file.');
 const actual=await realpath(path);
 if(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path)throw Error('Linked evidence file.');
 const file=await open(path,'r');
 try{
  const current=await file.stat();
  if(!current.isFile()||current.dev!==before.dev||current.ino!==before.ino||current.size!==before.size)throw Error('Evidence changed.');
  const data=Buffer.alloc(before.size+1);
  let offset=0;
  while(offset<data.length){
   const {bytesRead}=await file.read(data,offset,data.length-offset,offset);
   if(!bytesRead)break;
   offset+=bytesRead;
  }
  const after=await file.stat();
  if(offset!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Evidence changed.');
  return data.subarray(0,offset);
 }finally{await file.close();}
}
const digest=data=>createHash('sha256').update(data).digest('hex');
export async function verifyWriterLossArtifacts(runtimeRoot){
 const root=resolve(runtimeRoot);
 try{
  const incident=await inspectWriterLoss(root);
  const review=await inspectWriterLossReview(root);
  if(incident.state!=='reconciliation-required'||review.state!=='review-recorded')return {state:'review-unavailable',...blocked};
  const reviewPath=join(root,'.ars-writer-loss-review.json');
  const raw=await boundedFile(reviewPath,8192);
  const record=JSON.parse(raw.toString('utf8'));
  if(record.schema!==1||record.incidentDigest!==incident.incidentDigest||record.operatorAttestationOnly!==true||record.startupAllowed!==false||record.recoveryAllowed!==false)throw Error('Review mismatch.');
  const folder=join(root,'writer-loss-evidence',incident.incidentDigest);
  for(const dir of [join(root,'writer-loss-evidence'),folder]){
   if(!(await lstat(dir)).isDirectory())throw Error('Invalid evidence directory.');
   const actual=await realpath(dir);
   if(process.platform==='win32'?actual.toLowerCase()!==dir.toLowerCase():actual!==dir)throw Error('Linked evidence directory.');
  }
  const checks=[];
  for(const category of categories){
   try{
    const data=await boundedFile(join(folder,category+'.json'),4*1024*1024);
    const matched=digest(data)===record.evidence?.[category];
    // Each artifact must explicitly refer to this incident and category.
    const item=JSON.parse(data.toString('utf8'));
    checks.push({category,matched:matched&&item.schema===1&&item.incidentDigest===incident.incidentDigest&&item.category===category});
   }catch{checks.push({category,matched:false});}
  }
  const final=await inspectWriterLoss(root);
  if(final.incidentDigest!==incident.incidentDigest||digest(await boundedFile(reviewPath,8192))!==digest(raw))throw Error('Review changed during inspection.');
  return {state:checks.every(x=>x.matched)?'artifact-integrity-matched':'artifact-mismatch',checks,accountingVerified:false,...blocked};
 }catch{return {state:'unreadable-or-invalid',...blocked};}
}
