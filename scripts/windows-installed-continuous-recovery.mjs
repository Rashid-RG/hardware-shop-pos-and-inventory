// Internal installed recovery lifecycle. No CLI, GUI, live restore or removal.
// Caller must first create the private recovery directory and verified shutdown hold.
import pg from 'pg';
import dotenv from 'dotenv';
import {lstat,realpath,readFile,readdir} from 'node:fs/promises';
import {join,resolve,dirname,basename,isAbsolute} from 'node:path';
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
export async function runInstalledWindowsContinuousRecovery({root,destination,signal}={}){
 if(process.platform!=='win32'||!signal||typeof signal.addEventListener!=='function'||signal.aborted||typeof process.env.LOCALAPPDATA!=='string'||!isAbsolute(process.env.LOCALAPPDATA)||['ARS_RUNTIME_ROOT','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'].some(k=>process.env[k]!==undefined))throw Error('Unsupported recovery environment.');
 const runtime=await canonical(root,true);
 const folder=await canonical(destination,true);
 const state=await canonical(join(process.env.LOCALAPPDATA,'RS Nextward','ARS Distributor'),true);
 const recoveryRoot=await canonical(join(state,'uninstall-recovery'),true);
 const control=await canonical(join(state,'desktop-control'),true);
 if(!same(dirname(folder),recoveryRoot)||! /^[a-f0-9]{32}$/.test(basename(folder)))throw Error('Managed recovery directory required.');
 if((await readdir(folder)).length!==0)throw Error('Existing recovery evidence must be retained.');
 const identity=await reviewCurrentWindowsMaintenanceInstallation(runtime);
 const checkIdentity=async()=>{
  if(signal.aborted)throw Error('Recovery interrupted.');
  const current=await reviewCurrentWindowsMaintenanceInstallation(runtime);
  for(const key of ['installation','desktopSid','identityDigest','manifestDigest','executable','sha256'])if(current[key]!==identity[key])throw Error('Recovery installation identity changed.');
 };
 const configPath=await canonical(join(runtime,'.env.local'),false);
 const config=resolveWindowsMaintenanceDatabase(dotenv.parse(await readFile(configPath)));
 const client=new pg.Client(config.connection);
 const check=async scope=>{await scope.assertActive();await checkIdentity();await scope.assertActive();};
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
