// Durable local observation history; not a clearance or authorization artifact.
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {observeAuthenticatedActivationReview} from './activation-incident-authenticated-review.mjs';
const blocked={activationAllowed:false,runtimeActivated:false,startupAllowed:false,rollbackAllowed:false,recoveryAllowed:false,continuousExclusionVerified:false,independenceVerified:false};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const hash=b=>createHash('sha256').update(b).digest('hex');
const account=a=>typeof a?.id==='string'&&a.id.length>0&&a.id.length<=254&&hex(a.revisionDigest);
async function root(input){
 if(typeof input!=='string'||!isAbsolute(input))throw Error('Absolute review directory required.');
 const path=resolve(input),actual=await realpath(path),s=await lstat(path);
 if(!s.isDirectory()||(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path))throw Error('Invalid review directory.');
 return path;
}
function validate(r){
 if(r?.schema!==1||r.kind!=='credential-bound-activation-observation'||!['incidentDigest','reviewDigest','snapshotDigest'].every(k=>hex(r[k]))||!account(r.operator)||!account(r.reviewer)||r.operator.id===r.reviewer.id||r.observationOnly!==true||r.freshCredentialsRequired!==true||r.distinctAccountsVerified!==true||!Object.keys(blocked).every(k=>r[k]===false)||typeof r.recordedAt!=='string'||!Number.isFinite(Date.parse(r.recordedAt)))throw Error('Invalid observation.');
}
export async function recordActivationIncidentObservation(directory,input,confirmation){
 if(confirmation!=='RETAIN ACTIVATION REVIEW OBSERVATION')throw Error('Explicit recording confirmation required.');
 const path=await root(directory);
 const result=await observeAuthenticatedActivationReview(input);
 validate(result);
 // Do not retain credentials, environment data or arbitrary adapter fields.
 const record={schema:1,kind:result.kind,incidentDigest:result.incidentDigest,reviewDigest:result.reviewDigest,snapshotDigest:result.snapshotDigest,operator:{id:result.operator.id,revisionDigest:result.operator.revisionDigest},reviewer:{id:result.reviewer.id,revisionDigest:result.reviewer.revisionDigest},recordedAt:result.recordedAt,observationOnly:true,freshCredentialsRequired:true,distinctAccountsVerified:true,...blocked};
 const bytes=Buffer.from(JSON.stringify(record)+'\n');
 const name='activation-review-'+record.incidentDigest+'-'+record.reviewDigest+'.json';
 if(await root(directory)!==path)throw Error('Review directory changed.');
 const f=await open(join(path,name),'wx',0o600);
 try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 if(process.platform!=='win32'){const d=await open(path,'r');try{await d.sync();}finally{await d.close();}}
 return {state:'activation-observation-retained',recordDigest:hash(bytes),incidentDigest:record.incidentDigest,reviewDigest:record.reviewDigest,freshCredentialsRequired:true,...blocked};
}

export async function revalidateActivationIncidentObservation(directory,input){
 const path=await root(directory);
 // Always authenticate again; a retained file alone proves no authorization.
 const fresh=await observeAuthenticatedActivationReview(input);
 validate(fresh);
 const name='activation-review-'+fresh.incidentDigest+'-'+fresh.reviewDigest+'.json';
 const target=join(path,name),before=await lstat(target),actual=await realpath(target);
 if(!before.isFile()||before.size<1||before.size>8192||(process.platform==='win32'?actual.toLowerCase()!==target.toLowerCase():actual!==target))throw Error('Invalid retained observation.');
 const f=await open(target,'r');
 let bytes;
 try{
  const a=await f.stat();
  if(a.dev!==before.dev||a.ino!==before.ino||a.size!==before.size||a.mtimeMs!==before.mtimeMs||a.ctimeMs!==before.ctimeMs)throw Error('Observation changed.');
  const buffer=Buffer.alloc(before.size+1);
  const {bytesRead}=await f.read(buffer,0,buffer.length,0),b=await f.stat();
  if(bytesRead!==before.size||b.size!==a.size||b.mtimeMs!==a.mtimeMs||b.ctimeMs!==a.ctimeMs)throw Error('Observation changed.');
  bytes=buffer.subarray(0,bytesRead);
 }finally{await f.close();}
 const saved=JSON.parse(bytes.toString('utf8'));
 validate(saved);
 if(!['incidentDigest','reviewDigest','snapshotDigest'].every(k=>saved[k]===fresh[k])||!['operator','reviewer'].every(k=>saved[k].id===fresh[k].id&&saved[k].revisionDigest===fresh[k].revisionDigest))throw Error('Retained observation stale or accounts changed.');
 const after=await lstat(target);
 if(after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||await root(directory)!==path)throw Error('Observation changed.');
 return {state:'activation-observation-matched',recordDigest:hash(bytes),incidentDigest:fresh.incidentDigest,reviewDigest:fresh.reviewDigest,freshCredentialsRequired:true,...blocked};
}
