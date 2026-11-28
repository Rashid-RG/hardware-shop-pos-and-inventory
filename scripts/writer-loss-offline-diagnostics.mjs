// Offline recovery diagnostics. No server startup, data changes or clearance.
import {lstat,realpath,readFile} from 'node:fs/promises';
import {isAbsolute,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import {inspectRecoveryPreflight} from './writer-loss-recovery-preflight.mjs';
import {inspectWriterLoss} from './writer-loss-inspection.mjs';
import {inspectRecoveryReconciliation} from './writer-loss-reconciliation-summary.mjs';
export function localConnectionConfig(value){
 const u=new URL(value);
 const port=Number(u.port);
 const database=u.pathname.slice(1);
 const allowed=(port===5433&&database==='hardware_pos')||(port===5434&&database==='hardware_pos_ars');
 if(!allowed||!['postgres:','postgresql:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.search||u.hash||!u.username||!u.password)throw Error('Unsupported local database configuration.');
 return {host:u.hostname==='[::1]'?'::1':u.hostname,port,database,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:false,connectionTimeoutMillis:5000,query_timeout:5000,options:'-c default_transaction_read_only=on -c statement_timeout=5000'};
}
async function plain(path,directory){
 const s=await lstat(path);
 if(directory?!s.isDirectory():!s.isFile()||s.size>65536)throw Error('Invalid runtime path.');
 const actual=await realpath(path);
 if(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path)throw Error('Linked runtime path.');
}
export async function offlineRecoveryDiagnostics(runtimeRoot,expected){
 const blocked={startupAllowed:false,recoveryAllowed:false};
 let client;
 try{
  if(typeof runtimeRoot!=='string'||!isAbsolute(runtimeRoot))throw Error('Explicit absolute runtime required.');
  const root=resolve(runtimeRoot);
  await plain(root,true);
  const incident=await inspectWriterLoss(root);
  if(incident.state!=='reconciliation-required')return {state:incident.state==='absent'?'no-incident-record':'incident-invalid',...blocked};
  if(typeof expected?.systemIdentifier!=='string'||!/^[0-9]{1,20}$/.test(expected.systemIdentifier)||typeof expected?.databaseOid!=='string'||!/^[0-9]{1,10}$/.test(expected.databaseOid))throw Error('Independently verified identity required.');
  const config=join(root,'.env.local');
  await plain(config,false);
  const options=localConnectionConfig(dotenv.parse(await readFile(config)).DATABASE_URL);
  if(expected.database!==options.database)throw Error('Database name mismatch.');
  client=new pg.Client(options);
  client.on('error',()=>{});
  await client.connect();
  const preflight=await inspectRecoveryPreflight(root,client,expected);
  if(preflight.checks?.databaseIdentityMatched!==true)return preflight;
  const reconciliation=await inspectRecoveryReconciliation(client,expected);
  const final=await inspectWriterLoss(root);
  if(final.incidentDigest!==incident.incidentDigest)return {state:'incident-invalid',...blocked};
  return {...preflight,reconciliation};
 }catch{return {state:'offline-diagnostics-unavailable',...blocked};}
 finally{if(client)await client.end().catch(()=>{});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [root,database,systemIdentifier,databaseOid]=process.argv.slice(2);
 const result=await offlineRecoveryDiagnostics(root,{database,systemIdentifier,databaseOid});
 process.stdout.write(JSON.stringify(result)+'\n');
 process.exitCode=result.state==='preflight-matched-review-required'?0:1;
}
