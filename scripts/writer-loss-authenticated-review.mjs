// Credential-bound observation, never an authorization to start or restore.
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import {localConnectionConfig} from './writer-loss-offline-diagnostics.mjs';
import {verifyOfflineRecoveryPair} from './writer-loss-offline-auth.mjs';
import {inspectReviewDecision} from './writer-loss-review-decision.mjs';
const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,independenceVerified:false};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const validAccount=a=>typeof a?.id==='string'&&a.id.length>0&&a.id.length<=254&&hex(a.revisionDigest);
export function matchesAuthenticatedReview(record,decision,pair){
 return record?.schema===1&&record.kind==='credential-bound-review'&&decision?.state==='review-decision-matched'&&decision.decision==='Review accepted'&&hex(decision.decisionDigest)&&record.decisionDigest===decision.decisionDigest&&pair?.state==='distinct-admin-credentials-verified'&&pair.credentialsVerified===true&&pair.distinctAccountsVerified===true&&pair.recoveryAllowed===false&&validAccount(record.operator)&&validAccount(record.reviewer)&&record.operator.id!==record.reviewer.id&&['operator','reviewer'].every(k=>record[k].id===pair[k]?.id&&record[k].revisionDigest===pair[k]?.revisionDigest)&&typeof record.recordedAt==='string'&&Number.isFinite(Date.parse(record.recordedAt))&&record.observationOnly===true&&Object.keys(blocked).every(k=>record[k]===false);
}
async function rootPath(input){
 if(typeof input!=='string'||!isAbsolute(input))throw Error('Absolute runtime required.');
 const root=resolve(input),actual=await realpath(root),s=await lstat(root);
 if(!s.isDirectory()||(process.platform==='win32'?actual.toLowerCase()!==root.toLowerCase():actual!==root))throw Error('Invalid runtime.');
 return root;
}
async function readBounded(path,max){
 const s=await lstat(path),actual=await realpath(path);
 if(!s.isFile()||s.size<1||s.size>max||(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path))throw Error('Invalid file.');
 const f=await open(path,'r');
 try{
  const a=await f.stat(),buffer=Buffer.alloc(s.size+1);
  if(a.dev!==s.dev||a.ino!==s.ino||a.size!==s.size)throw Error('File changed.');
  const {bytesRead}=await f.read(buffer,0,buffer.length,0),z=await f.stat();
  if(bytesRead!==s.size||z.size!==s.size||z.mtimeMs!==s.mtimeMs||z.ctimeMs!==s.ctimeMs)throw Error('File changed.');
  return buffer.subarray(0,bytesRead);
 }finally{await f.close();}
}
const digest=b=>createHash('sha256').update(b).digest('hex');
async function verify(root,expected,operator,reviewer){
 const path=join(root,'.env.local'),raw=await readBounded(path,65536),config=dotenv.parse(raw);
 const options=localConnectionConfig(config.DATABASE_URL);
 if(expected?.database!==options.database)throw Error('Database mismatch.');
 const client=new pg.Client(options);
 client.on('error',()=>{});
 try{
  await client.connect();
  const pair=await verifyOfflineRecoveryPair(client,expected,config,operator,reviewer);
  if(pair.state!=='distinct-admin-credentials-verified'||digest(await readBounded(path,65536))!==digest(raw))throw Error('Credential or configuration verification failed.');
  return pair;
 }finally{await client.end().catch(()=>{});}
}
export async function recordAuthenticatedReview(runtimeRoot,expected,input,confirmation){
 if(confirmation!=='RECORD AUTHENTICATED REVIEW'||!hex(input?.decisionDigest))throw Error('Explicit decision confirmation required.');
 const root=await rootPath(runtimeRoot),decision=await inspectReviewDecision(root);
 if(decision.decisionDigest!==input.decisionDigest||decision.decision!=='Review accepted')throw Error('Accepted retained decision required.');
 const pair=await verify(root,expected,input.operator,input.reviewer);
 const record={schema:1,kind:'credential-bound-review',decisionDigest:input.decisionDigest,operator:pair.operator,reviewer:pair.reviewer,recordedAt:new Date().toISOString(),observationOnly:true,...blocked};
 if(!matchesAuthenticatedReview(record,await inspectReviewDecision(root),pair))throw Error('Decision changed.');
 const file=await open(join(root,'.ars-authenticated-review.json'),'wx',0o600);
 try{await file.writeFile(JSON.stringify(record)+'\n');await file.sync();}finally{await file.close();}
 if(process.platform!=='win32'){const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}}
 return {state:'credential-bound-review-recorded',freshCredentialsRequired:true,...blocked};
}
export async function revalidateAuthenticatedReview(runtimeRoot,expected,operator,reviewer){
 try{
  const root=await rootPath(runtimeRoot),path=join(root,'.ars-authenticated-review.json'),raw=await readBounded(path,8192),record=JSON.parse(raw.toString('utf8'));
  const decision=await inspectReviewDecision(root),pair=await verify(root,expected,operator,reviewer);
  if(!matchesAuthenticatedReview(record,decision,pair)||digest(await readBounded(path,8192))!==digest(raw)||(await inspectReviewDecision(root)).decisionDigest!==decision.decisionDigest)throw Error('Review changed.');
  return {state:'credential-bound-review-matched',reviewDigest:digest(raw),freshCredentialsRequired:true,...blocked};
 }catch{return {state:'credential-bound-review-unavailable',freshCredentialsRequired:true,...blocked};}
}
