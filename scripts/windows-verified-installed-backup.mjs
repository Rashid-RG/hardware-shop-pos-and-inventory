// Internal composition for installed Windows maintenance. No CLI or removal permission.
// Caller retains the database session/table fence and validates recovery destination.
import {reviewCurrentWindowsMaintenanceInstallation} from './windows-maintenance-current-identity.mjs';
import {readProtectedMaintenanceClusterIdentity} from './maintenance-cluster-identity.mjs';
import {runProtectedWindowsBackup} from './windows-protected-backup-stage.mjs';
export async function runVerifiedInstalledWindowsBackup(client,scope,{root,destination,timeoutMs=900000}={}){
 if(process.platform!=='win32'||typeof scope?.assertActive!=='function'||!scope.signal||!scope.owner)throw Error('Verified Windows maintenance scope required.');
 const assertActive=async()=>{
  if(scope.signal.aborted)throw Error('Maintenance interrupted.');
  await scope.assertActive();
  if(scope.signal.aborted)throw Error('Maintenance interrupted.');
 };
 await assertActive();
 const identity=await reviewCurrentWindowsMaintenanceInstallation(root);
 const checkIdentity=async()=>{
  await assertActive();
  const current=await reviewCurrentWindowsMaintenanceInstallation(root);
  for(const key of ['installation','desktopSid','identityDigest','manifestDigest','executable','sha256']){
   if(current[key]!==identity[key])throw Error('Installed maintenance identity changed.');
  }
  await assertActive();
 };
 // Every native worker boundary must verify both original installation identity
 // and caller-owned database protection; never accept an alternate executable.
 const verifiedScope=Object.freeze({owner:scope.owner,signal:scope.signal,assertActive:checkIdentity});
 const clusterIdentity=await readProtectedMaintenanceClusterIdentity(client,verifiedScope);
 const result=await runProtectedWindowsBackup(verifiedScope,{root:identity.installation,destination,supervisor:identity.executable,clusterIdentity,timeoutMs});
 await checkIdentity();
 return Object.freeze({...result,installationIdentityDigest:identity.identityDigest,packageManifestDigest:identity.manifestDigest,supervisorSha256:identity.sha256,signatureVerified:false,applicationTreeReverified:false,applicationRemovalAllowed:false,databaseDeletionAllowed:false,activationAllowed:false,continuousExclusionVerified:false});
}
