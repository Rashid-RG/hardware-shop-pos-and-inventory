// Internal orchestration contract. Only trusted non-destructive stage callbacks.
import {withMaintenanceSession} from './database-maintenance-session.mjs';
import {withMaintenanceTableFence} from './database-maintenance-table-fence.mjs';
export async function withProtectedWindowsRecovery(client,database,{signal,backup,prepare,restore,review}={}){
 if(!['hardware_pos','hardware_pos_ars'].includes(database)||![backup,prepare,restore,review].every(f=>typeof f==='function')||!signal||typeof signal.addEventListener!=='function')throw Error('Invalid protected recovery request.');
 if(signal.aborted)throw Error('Recovery interrupted.');
 return withMaintenanceSession(client,database,session=>withMaintenanceTableFence(client,session,async fence=>{
  const combined=AbortSignal.any([signal,fence.signal]);
  const assertActive=async()=>{
   if(combined.aborted)throw Error('Recovery interrupted.');
   await fence.assertActive();
   if(combined.aborted)throw Error('Recovery interrupted.');
  };
  const scope=Object.freeze({owner:fence.owner,signal:combined,assertActive});
  await assertActive();
  const archive=await backup(scope);
  await assertActive();
  const metadata=await prepare(scope,archive);
  await assertActive();
  const restored=await restore(scope,metadata);
  await assertActive();
  if(restored?.restoreObservationVerified!==true||restored.database!==database||restored.applicationRemovalAllowed!==false||restored.databaseDeletionAllowed!==false||restored.continuousExclusionVerified!==false)throw Error('Verified non-authorizing restore evidence required.');
  const result=await review(scope,metadata,restored);
  await assertActive();
  if(result?.restoreObservationMatched!==true||['applicationRemovalAllowed','databaseDeletionAllowed','serviceRemovalAllowed','uninstalled','finalUninstallBackupVerified','continuousExclusionVerified'].some(k=>result[k]!==false))throw Error('Invalid final recovery review.');
  return Object.freeze({database,restoreObservationDigest:restored.observationDigest,finalReviewMatched:true,sharedProtectionScopeObserved:true,applicationRemovalAllowed:false,databaseDeletionAllowed:false,serviceRemovalAllowed:false,activationAllowed:false,uninstalled:false,finalUninstallBackupVerified:false,continuousExclusionVerified:false});
 }));
}
