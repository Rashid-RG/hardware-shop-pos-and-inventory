// Internal stage only. Does not acquire/release the caller's database locks.
// The supervisor executable must be supplied by a trusted runtime coordinator
// after installation identity and binary integrity verification.
import {randomUUID} from 'node:crypto';
import {lstat,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {runWindowsMaintenanceWorker} from './windows-maintenance-supervisor-adapter.mjs';
import {verifyWindowsBackupResult} from './windows-maintenance-backup-result.mjs';

const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
async function canonical(path,directory){
 if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))throw Error('Absolute maintenance path required.');
 const normalized=resolve(path),st=await lstat(normalized);
 if(st.isSymbolicLink()||!(directory?st.isDirectory():st.isFile())||!same(await realpath(normalized),normalized))throw Error('Invalid maintenance path.');
 return normalized;
}
export async function runProtectedWindowsBackup(scope,{root,destination,supervisor,timeoutMs=900000}={}){
 if(process.platform!=='win32'||typeof scope?.assertActive!=='function'||!scope.signal)throw Error('Protected Windows backup scope required.');
 const ownerDatabase=scope.owner?.database;
 const database=ownerDatabase;
 if(!['hardware_pos','hardware_pos_ars'].includes(database))throw Error('Unsupported protected backup database.');
 const verify=async()=>{await scope.assertActive();if(scope.signal.aborted||scope.owner?.database!==ownerDatabase)throw Error('Maintenance interrupted or database identity changed.');};
 await verify();
 const runtime=await canonical(root,true);
 const folder=await canonical(destination,true);
 const executable=await canonical(supervisor,false);
 const worker=await canonical(join(runtime,'scripts','windows-maintenance-backup-worker.ps1'),false);
 const powershell=await canonical(join(process.env.SystemRoot||'', 'System32','WindowsPowerShell','v1.0','powershell.exe'),false);
 const resultName='maintenance-result-'+randomUUID().replaceAll('-','')+'.json';
 try{
  await lstat(join(folder,resultName));
  throw Error('Maintenance result already exists.');
 }catch(error){if(error.code!=='ENOENT')throw error;}
 await verify();
 await runWindowsMaintenanceWorker(scope,executable,powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',worker,'-Destination',folder,'-ResultName',resultName,'-Database',database],{cwd:runtime,timeoutMs});
 const result=await verifyWindowsBackupResult(scope,folder,resultName,database);
 await verify();
 // Keep the result record for recovery review. No automatic deletion or retry.
 return Object.freeze({...result,resultName});
}
