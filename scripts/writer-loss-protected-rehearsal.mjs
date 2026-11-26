// Dedicated disposable PostgreSQL session rehearsal. No live recovery or marker clearance.
import {assertGateOwner,HANDOFF_CLASS} from './database-handoff-gate.mjs';
export async function rehearseProtectedRecovery(client,{gateId,writerId}){
 if(![gateId,writerId].every(n=>Number.isInteger(n)&&n>=10&&n<=2147483647)||gateId===writerId)throw Error('Disposable lock keys required.');
 let lost=false;
 const onError=()=>{lost=true;};
 client.on('error',onError);
 try{
  const identity=await client.query("SELECT current_database() AS database, pg_backend_pid() AS pid, backend_start::text AS started FROM pg_stat_activity WHERE pid=pg_backend_pid()");
  const owner=identity.rows[0];
  if(identity.rows.length!==1||owner?.database!=='hardware_pos_ci')throw Error('Disposable CI database required.');
  for(const id of [gateId,writerId]){
   const lock=await client.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[HANDOFF_CLASS,id]);
   if(lock.rows[0]?.acquired!==true)throw Error('Recovery lock unavailable.');
  }
  const verify=async()=>{
   if(lost)throw Error('Recovery connection lost.');
   for(const lockId of [gateId,writerId])await assertGateOwner(client,owner,{lockClass:HANDOFF_CLASS,lockId});
   if(lost)throw Error('Recovery connection lost.');
  };
  await verify();
  const activity=await client.query("SELECT count(*)::integer AS other_sessions FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'");
  if(activity.rows.length!==1||!Number.isSafeInteger(activity.rows[0]?.other_sessions)||activity.rows[0].other_sessions<0)throw Error('Invalid recovery activity observation.');
  await verify();
  return {state:'protected-rehearsal-observed',otherSessions:activity.rows[0].other_sessions,ownershipObservedBeforeAndAfter:true,continuousExclusionVerified:false,startupAllowed:false,recoveryAllowed:false};
 }finally{
  // End the dedicated session even on partial acquisition; never return it to a pool.
  try{await client.end();}finally{client.off('error',onError);}
 }
}
