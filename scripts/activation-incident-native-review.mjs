// Internal native adapter. No incident clearance, service start or database writes.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {open,lstat,realpath} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import {localConnectionConfig} from './writer-loss-offline-diagnostics.mjs';
import {recordActivationIncidentObservation,revalidateActivationIncidentObservation} from './activation-incident-review-record.mjs';
const run=promisify(execFile);
const scripts=dirname(fileURLToPath(import.meta.url));
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
async function plain(path,directory=false){
 const s=await lstat(path);
 if(!(directory?s.isDirectory():s.isFile())||!same(await realpath(path),path))throw Error('Invalid native recovery path.');
 return s;
}
async function bounded(path){
 const s=await plain(path);
 if(s.size<1||s.size>65536)throw Error('Invalid evidence size.');
 const f=await open(path,'r');
 try{
  const a=await f.stat(),buffer=Buffer.alloc(s.size+1);
  const {bytesRead}=await f.read(buffer,0,buffer.length,0),b=await f.stat();
  if(a.dev!==s.dev||a.ino!==s.ino||a.size!==s.size||bytesRead!==s.size||b.size!==a.size||b.mtimeMs!==s.mtimeMs||b.ctimeMs!==s.ctimeMs)throw Error('Evidence changed.');
  return buffer.subarray(0,bytesRead);
 }finally{await f.close();}
}
export async function nativeAuthenticatedActivationReview({recoveryId,operator,reviewer,mode,confirmation}){
 if(!['record','verify'].includes(mode)||confirmation!=='REVIEW ACTIVATION INCIDENT'||typeof recoveryId!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$/.test(recoveryId))throw Error('Explicit native review required.');
 const windows=process.platform==='win32';
 if(!windows&&process.platform!=='linux')throw Error('Unsupported platform.');
 if(windows&&!process.env.LOCALAPPDATA)throw Error('Missing desktop profile.');
 const state=windows?resolve(process.env.LOCALAPPDATA,'RS Nextward','ARS Distributor'):join(homedir(),'.local','share','ars-hardware');
 const control=windows?join(state,'desktop-control'):state;
 const runtime=join(state,windows?'runtime-prepared':'runtime');
 const folder=join(state,'update-recovery',recoveryId);
 for(const p of [state,control,runtime,folder,scripts])await plain(p,true);
 const helper=windows?join(scripts,'prepare-windows-runtime-activation.ps1'):join(scripts,'mint','prepare-runtime-activation.py');
 await plain(helper);
 const readReview=async()=>{
  await plain(helper);
  const command=windows?join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'):'/usr/bin/python3';
  const args=windows?['-NoProfile','-NonInteractive','-File',helper,'-RecoveryId',recoveryId,'-ReviewIncident']:[helper,folder,'--review-incident'];
  const {stdout}=await run(command,args,{cwd:dirname(scripts),timeout:900000,maxBuffer:65536,windowsHide:true});
  return JSON.parse(stdout.trim());
 };
 const configurationBytes=await bounded(join(runtime,'.env.local')),bindingBytes=await bounded(join(control,'database-binding.json'));
 const saved=JSON.parse(bindingBytes.toString('utf8')),expected={database:saved.database,systemIdentifier:saved.systemIdentifier,databaseOid:saved.databaseOid};
 const options=localConnectionConfig(dotenv.parse(configurationBytes).DATABASE_URL);
 if(options.database!==expected.database)throw Error('Database identity mismatch.');
 // Native preflight requires no other database clients. Connect only between reviews.
 const openClient=async()=>{
  const client=new pg.Client(options);
  client.on('error',()=>{});
  try{await client.connect();return client;}
  catch(error){await client.end().catch(()=>{});throw error;}
 };
 const input={openClient,expected,configurationBytes,bindingBytes,readReview,operator,reviewer,confirmation};
 return mode==='record'?await recordActivationIncidentObservation(control,input,'RETAIN ACTIVATION REVIEW OBSERVATION'):await revalidateActivationIncidentObservation(control,input);
}
