// Internal installed recovery lifecycle. No CLI, GUI, live restore or removal.
// Caller must first create the private recovery directory and verified shutdown hold.
import pg from 'pg';
import dotenv from 'dotenv';
import {lstat,realpath,readFile,readdir,open} from 'node:fs/promises';
import {join,resolve,dirname,basename,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {resolveWindowsMaintenanceDatabase} from './windows-maintenance-database-config.mjs';
import {reviewCurrentWindowsMaintenanceInstallation} from './windows-maintenance-current-identity.mjs';
import {withProtectedWindowsRecovery} from './windows-continuous-recovery.mjs';
import {runWindowsContinuousBackupStage} from './windows-continuous-backup-stage.mjs';
import {prepareWindowsContinuousRecoveryMetadata} from './windows-continuous-recovery-metadata.mjs';
import {runVerifiedInstalledWindowsRestore} from './windows-verified-installed-restore.mjs';
import {verifyWindowsRestoreEvidence} from './windows-maintenance-restore-result.mjs';
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
async function canonical(path,directory){
 if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))throw Error('Absolute recovery path required.');
 const p=resolve(path),st=await lstat(p);
 if(st.isSymbolicLink()||!(directory?st.isDirectory():st.isFile())||!same(await realpath(p),p))throw Error('Invalid recovery path.');
 return p;
}
export async function assertPreparedShutdownEvidence({runtime,folder,control,signal,holdDigest,shutdownDigest}={}){
  if(!signal||![runtime,folder,control].every(p=>typeof p==="string"&&isAbsolute(p))||![holdDigest,shutdownDigest].every(x=>typeof x==="string"&&/^[A-F0-9]{64}$/.test(x)))throw Error("Invalid shutdown verification request.");
  if(signal.aborted)throw Error('Recovery interrupted.');
  for(const [name,expected] of [['maintenance.json',holdDigest],['maintenance-shutdown.json',shutdownDigest]]){
   const path=await canonical(join(control,name),false);
   const before=await lstat(path);
   if(before.size<1||before.size>65536)throw Error('Invalid shutdown evidence.');
   const stable=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
   const handle=await open(path,'r');
   try{
    if(!stable(before,await handle.stat()))throw Error('Prepared shutdown evidence changed.');
    const raw=Buffer.alloc(before.size);
    const {bytesRead}=await handle.read(raw,0,raw.length,0);
    if(bytesRead!==raw.length||!stable(before,await handle.stat())||!stable(before,await lstat(path))||!same(await realpath(path),path)||createHash('sha256').update(raw).digest('hex').toUpperCase()!==expected)throw Error('Prepared shutdown evidence changed.');
    const record=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));
    if(record.uninstallId!==basename(folder)||typeof record.project!=='string'||!same(record.project,runtime)||record.shutdownVerified!==(name==='maintenance-shutdown.json')||['applicationRemovalAllowed','databaseDeletionAllowed','activationApproved'].some(k=>record[k]!==false))throw Error('Prepared shutdown identity mismatch.');
   }finally{await handle.close();}
  }
  if(signal.aborted)throw Error('Recovery interrupted.');
}

export async function runInstalledWindowsContinuousRecovery({root,destination,signal,holdDigest,shutdownDigest}={}){
 if(process.platform!=='win32'||!signal||typeof signal.addEventListener!=='function'||signal.aborted||typeof process.env.LOCALAPPDATA!=='string'||!isAbsolute(process.env.LOCALAPPDATA)||['ARS_RUNTIME_ROOT','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'].some(k=>process.env[k]!==undefined))throw Error('Unsupported recovery environment.');
 if(![holdDigest,shutdownDigest].every(x=>typeof x==='string'&&/^[A-F0-9]{64}$/.test(x)))throw Error('Original preparation digests required.');
 const runtime=await canonical(root,true);
 const folder=await canonical(destination,true);
 const state=await canonical(join(process.env.LOCALAPPDATA,'RS Nextward','ARS Distributor'),true);
 const recoveryRoot=await canonical(join(state,'uninstall-recovery'),true);
 const control=await canonical(join(state,'desktop-control'),true);
 if(!same(dirname(folder),recoveryRoot)||! /^[a-f0-9]{32}$/.test(basename(folder)))throw Error('Managed recovery directory required.');
 if((await readdir(folder)).length!==0)throw Error('Existing recovery evidence must be retained.');
 const checkShutdown=()=>assertPreparedShutdownEvidence({runtime,folder,control,signal,holdDigest,shutdownDigest});
 await checkShutdown();
 const identity=await reviewCurrentWindowsMaintenanceInstallation(runtime);
 const checkIdentity=async()=>{
  if(signal.aborted)throw Error('Recovery interrupted.');
  const current=await reviewCurrentWindowsMaintenanceInstallation(runtime);
  for(const key of ['installation','desktopSid','identityDigest','manifestDigest','executable','sha256'])if(current[key]!==identity[key])throw Error('Recovery installation identity changed.');
 };
 const configPath=await canonical(join(runtime,'.env.local'),false);
 const config=resolveWindowsMaintenanceDatabase(dotenv.parse(await readFile(configPath)));
 const client=new pg.Client(config.connection);
 const check=async scope=>{await scope.assertActive();await checkIdentity();await checkShutdown();await scope.assertActive();};
 return withProtectedWindowsRecovery(client,config.database,{
  signal,
  backup:async scope=>{
   await check(scope);
   const result=await runWindowsContinuousBackupStage(client,scope,{root:runtime,destination:folder});
   await check(scope);
   return result;
  },
  prepare:async(scope,backup)=>{
   await check(scope);
   return prepareWindowsContinuousRecoveryMetadata(scope,backup,{root:runtime,destination:folder,control});
  },
  restore:async(scope,metadata)=>{
   await check(scope);
   if(metadata.database!==config.database||metadata.destination!==folder||metadata.uninstallId!==basename(folder))throw Error('Recovery metadata identity changed.');
   return runVerifiedInstalledWindowsRestore(scope,{root:runtime,destination:folder});
  },
  review:async(scope,metadata,restored)=>{
   await check(scope);
   const evidence=await verifyWindowsRestoreEvidence(scope,{destination:folder,control});
   if(evidence.restoreObservationVerified!==true||evidence.database!==config.database||evidence.uninstallId!==metadata.uninstallId||evidence.observationDigest!==restored.observationDigest||evidence.archiveSha256!==restored.archiveSha256)throw Error('Restoration evidence changed before final review.');
   await check(scope);
   return Object.freeze({restoreObservationMatched:true,applicationRemovalAllowed:false,databaseDeletionAllowed:false,serviceRemovalAllowed:false,uninstalled:false,finalUninstallBackupVerified:false,continuousExclusionVerified:false});
  }
 });
}
