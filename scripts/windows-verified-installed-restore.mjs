// Internal isolated restore execution. Caller owns the protected database session.
// Never restores into the live database or grants removal/activation permission.
import {lstat,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute,basename,dirname} from 'node:path';
import {reviewCurrentWindowsMaintenanceInstallation} from './windows-maintenance-current-identity.mjs';
import {runWindowsMaintenanceWorker} from './windows-maintenance-supervisor-adapter.mjs';

const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
async function canonical(path,directory){
 if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))throw Error('Absolute restoration path required.');
 const normalized=resolve(path),st=await lstat(normalized);
 if(st.isSymbolicLink()||!(directory?st.isDirectory():st.isFile())||!same(await realpath(normalized),normalized))throw Error('Invalid restoration path.');
 return normalized;
}
export async function runVerifiedInstalledWindowsRestore(scope,{root,destination,timeoutMs=900000}={}){
 if(process.platform!=='win32'||typeof scope?.assertActive!=='function'||!scope.signal)throw Error('Protected Windows restore scope required.');
 const database=scope.owner?.database;
 if(!['hardware_pos','hardware_pos_ars'].includes(database))throw Error('Unsupported protected restore database.');
 const assertActive=async()=>{
  if(scope.signal.aborted||scope.owner?.database!==database)throw Error('Restore interrupted or database identity changed.');
  await scope.assertActive();
  if(scope.signal.aborted||scope.owner?.database!==database)throw Error('Restore interrupted or database identity changed.');
 };
 await assertActive();
 const identity=await reviewCurrentWindowsMaintenanceInstallation(root);
 const checkIdentity=async()=>{
  await assertActive();
  const current=await reviewCurrentWindowsMaintenanceInstallation(root);
  for(const key of ['installation','desktopSid','identityDigest','manifestDigest','executable','sha256']){
   if(current[key]!==identity[key])throw Error('Installed restoration identity changed.');
  }
  await assertActive();
 };
 const verifiedScope=Object.freeze({owner:scope.owner,signal:scope.signal,assertActive:checkIdentity});
 const runtime=await canonical(identity.installation,true);
 const folder=await canonical(destination,true);
 const recoveryRoot=await canonical(join(process.env.LOCALAPPDATA,'RS Nextward','ARS Distributor','uninstall-recovery'),true);
 if(!same(dirname(folder),recoveryRoot)||! /^[a-f0-9]{32}$/.test(basename(folder)))throw Error('Managed recovery directory required.');
 const worker=await canonical(join(runtime,'scripts','windows-maintenance-restore-worker.ps1'),false);
 const executable=await canonical(identity.executable,false);
 const powershell=await canonical(join(process.env.SystemRoot||'','System32','WindowsPowerShell','v1.0','powershell.exe'),false);
 const observationPath=join(folder,'uninstall-restore-test.json');
 try{
  await lstat(observationPath);
  throw Error('Existing restore observation must be retained.');
 }catch(error){if(error.code!=='ENOENT')throw error;}
 await checkIdentity();
 await runWindowsMaintenanceWorker(verifiedScope,executable,powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',worker,'-RecoveryFolder',folder,'-SourceDatabase',database],{cwd:runtime,timeoutMs});
 await checkIdentity();
 // Observation existence is not a verified restore result. A separate verifier
 // must independently check the record and all recovery evidence before use.
 const observation=await canonical(observationPath,false);
 await checkIdentity();
 return Object.freeze({observation,database,installationIdentityDigest:identity.identityDigest,packageManifestDigest:identity.manifestDigest,supervisorSha256:identity.sha256,workerCompleted:true,restoreObservationVerified:false,signatureVerified:false,applicationTreeReverified:false,applicationRemovalAllowed:false,databaseDeletionAllowed:false,activationAllowed:false,continuousExclusionVerified:false});
}
