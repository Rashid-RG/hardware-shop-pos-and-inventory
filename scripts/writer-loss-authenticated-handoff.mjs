// Protected observation of a retained review. Never clears maintenance or starts POS.
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import {localConnectionConfig} from './writer-loss-offline-diagnostics.mjs';
import {revalidateAuthenticatedReview} from './writer-loss-authenticated-review.mjs';
import {inspectRecoveryReconciliation} from './writer-loss-reconciliation-summary.mjs';
import {inspectReconciliationEvidence} from './writer-loss-reconciliation-evidence.mjs';
import {HANDOFF_CLASS,HANDOFF_ID,WRITER_ID,TRANSACTION_FENCE_ID,assertGateOwner} from './database-handoff-gate.mjs';
const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,continuousExclusionVerified:false,independenceVerified:false};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const keys=['business','financial','stockPayables','partnerPayroll','partner','imports','payroll','inventory'];
export function matchesProtectedObservation(review,evidence,current){
 return review?.state==='credential-bound-review-matched'&&hex(review.reviewDigest)&&review.recoveryAllowed===false&&evidence?.state==='evidence-matched'&&hex(evidence.evidenceDigest)&&evidence.allSectionsAvailable===true&&current?.consistentAcrossSections===true&&current.allSectionsAvailable===true&&current.recoveryAllowed===false&&keys.every(k=>['selected-checks-match','estimate-review'].includes(evidence.sections?.[k])&&current.sections?.[k]===evidence.sections[k]);
}
async function readConfig(root){
 const path=join(root,'.env.local'),s=await lstat(path),actual=await realpath(path);
 if(!s.isFile()||s.size<1||s.size>65536||(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path))throw Error('Invalid configuration.');
 const f=await open(path,'r');
 try{
  const a=await f.stat(),buf=Buffer.alloc(s.size+1);
  if(a.dev!==s.dev||a.ino!==s.ino||a.size!==s.size)throw Error('Configuration changed.');
  const {bytesRead}=await f.read(buf,0,buf.length,0),z=await f.stat();
  if(bytesRead!==s.size||z.size!==s.size||z.mtimeMs!==s.mtimeMs||z.ctimeMs!==s.ctimeMs)throw Error('Configuration changed.');
  const raw=buf.subarray(0,bytesRead);
  return {digest:createHash('sha256').update(raw).digest('hex'),options:localConnectionConfig(dotenv.parse(raw).DATABASE_URL)};
 }finally{await f.close();}
}
export async function observeAuthenticatedHandoff(runtimeRoot,expected,operator,reviewer,confirmation){
 if(confirmation!=='OBSERVE PROTECTED RECOVERY')throw Error('Explicit confirmation required.');
 let client,lost=false;
 try{
  if(typeof runtimeRoot!=='string'||!isAbsolute(runtimeRoot))throw Error('Absolute runtime required.');
  const root=resolve(runtimeRoot),actual=await realpath(root),s=await lstat(root);
  if(!s.isDirectory()||(process.platform==='win32'?actual.toLowerCase()!==root.toLowerCase():actual!==root))throw Error('Invalid runtime.');
  const config=await readConfig(root);
  if(config.options.database!==expected?.database||! /^[0-9]{1,20}$/.test(expected?.systemIdentifier??'')||! /^[0-9]{1,10}$/.test(expected?.databaseOid??''))throw Error('Trusted identity required.');
  client=new pg.Client(config.options);
  client.on('error',()=>{lost=true;});
  await client.connect();
  const identity=await client.query("SELECT current_database() AS database,system_identifier::text AS system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,pg_backend_pid() AS pid,backend_start::text AS started,current_setting('default_transaction_read_only')='on' AS read_only FROM pg_control_system(),pg_stat_activity WHERE pid=pg_backend_pid()");
  const owner=identity.rows[0];
  if(identity.rows.length!==1||owner.database!==expected.database||owner.system_identifier!==expected.systemIdentifier||owner.database_oid!==expected.databaseOid||owner.read_only!==true)throw Error('Identity mismatch.');
  const ids=[HANDOFF_ID,WRITER_ID,TRANSACTION_FENCE_ID];
  for(const id of ids){
   const r=await client.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[HANDOFF_CLASS,id]);
   if(r.rows[0]?.acquired!==true)throw Error('Maintenance exclusion unavailable.');
  }
  const verify=async()=>{
   if(lost)throw Error('Connection lost.');
   for(const lockId of ids)await assertGateOwner(client,owner,{lockClass:HANDOFF_CLASS,lockId});
   if(lost)throw Error('Connection lost.');
  };
  await verify();
  const evidence=await inspectReconciliationEvidence(root);
  const review=await revalidateAuthenticatedReview(root,expected,operator,reviewer);
  const current=await inspectRecoveryReconciliation(client,expected);
  if(!matchesProtectedObservation(review,evidence,current))throw Error('Reconciliation or review changed.');
  const finalEvidence=await inspectReconciliationEvidence(root);
  const finalReview=await revalidateAuthenticatedReview(root,expected,operator,reviewer);
  if(finalEvidence.evidenceDigest!==evidence.evidenceDigest||finalReview.reviewDigest!==review.reviewDigest||(await readConfig(root)).digest!==config.digest||!matchesProtectedObservation(finalReview,finalEvidence,current))throw Error('Review changed.');
  const activity=await client.query("SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') AS others,(SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared,(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','MEMBER') FROM pg_roles WHERE rolname=current_user) AS visible");
  if(activity.rows.length!==1||activity.rows[0].others!==0||activity.rows[0].prepared!==0||activity.rows[0].visible!==true)throw Error('Database activity requires review.');
  await verify();
  return {state:'protected-review-observed',reviewDigest:review.reviewDigest,evidenceDigest:evidence.evidenceDigest,ownershipObservedBeforeAndAfter:true,otherSessionsObserved:0,preparedTransactionsObserved:0,sectionStatusesMatched:true,locksReleasedOnExit:true,...blocked};
 }catch{return {state:'protected-review-unavailable',...blocked};}
 finally{if(client)await client.end().catch(()=>{});}
}
