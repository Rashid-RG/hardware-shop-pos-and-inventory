// Disposable CI only: transfer writer and fence while coordinator retains gate.
import {assertGateOwner,HANDOFF_CLASS} from './database-handoff-gate.mjs';
import {acquireRehearsalWriter} from './database-handoff-writer-rehearsal.mjs';
import {rehearsePrivateHandoff} from './database-handoff-ipc.mjs';
export async function rehearseFencedTransfer(coordinator,candidate,rollback,rival,{gateId,writerId,fenceId,binding,failCandidate=false}){
 if(!['releaseDigest','runtimeDigest','maintenanceDigest'].every(k=>typeof binding?.[k]==='string'&&/^[a-f0-9]{64}$/.test(binding[k])))throw Error('Rehearsal binding required.');
 const ids=[gateId,writerId,fenceId];
 if(!ids.every(n=>Number.isInteger(n)&&n>=10&&n<=2147483647)||new Set(ids).size!==3||new Set([coordinator,candidate,rollback,rival]).size!==4)throw Error('Distinct disposable sessions and keys required.');
 const clients=[coordinator,candidate,rollback,rival];
 let lost=false;
 const onError=()=>{lost=true;};
 for(const c of clients)c.on('error',onError);
 const lock=async(c,id)=>(await c.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[HANDOFF_CLASS,id])).rows[0]?.acquired===true;
 const unlock=async(c,id)=>{
  if((await c.query('SELECT pg_advisory_unlock($1::integer,$2::integer) AS released',[HANDOFF_CLASS,id])).rows[0]?.released!==true)throw Error('Lease release not verified.');
 };
 try{
  const owners=[];
  for(const c of clients){
   const r=await c.query("SELECT current_database() AS database,pg_backend_pid() AS pid,backend_start::text AS started,system_identifier::text AS cluster,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid FROM pg_stat_activity,pg_control_system() WHERE pid=pg_backend_pid()");
   const o=r.rows[0];
   if(r.rows.length!==1||o?.database!=='hardware_pos_ci'||!Number.isInteger(o.pid)||!o.started||!o.cluster||!o.oid)throw Error('Disposable CI database required.');
   owners.push(o);
  }
  if(new Set(owners.map(o=>o.pid)).size!==4||owners.some(o=>o.cluster!==owners[0].cluster||o.oid!==owners[0].oid))throw Error('Session identity mismatch.');
  const verifyGate=async()=>{
   if(lost)throw Error('Connection lost.');
   await assertGateOwner(coordinator,owners[0],{lockClass:HANDOFF_CLASS,lockId:gateId});
   if(await lock(rival,gateId))throw Error('Rival acquired gate.');
   if(lost)throw Error('Connection lost.');
  };
  for(const id of ids)if(!await lock(coordinator,id))throw Error('Initial exclusion unavailable.');
  await verifyGate();
  const authorize=async purpose=>{
   await verifyGate();
   const proof=await rehearsePrivateHandoff({...binding,purpose});
   if(proof.authorizationVerified!==true||proof.liveStartupAllowed!==false)throw Error('Private startup proof unavailable.');
   await verifyGate();
  };
  await authorize('candidate');
  await unlock(coordinator,writerId);
  await acquireRehearsalWriter(candidate,owners[0],{lockClass:HANDOFF_CLASS,gateId,writerId});
  if(await lock(candidate,fenceId))throw Error('Fence released prematurely.');
  await unlock(coordinator,fenceId);
  if(!await lock(candidate,fenceId))throw Error('Candidate fence unavailable.');
  await assertGateOwner(coordinator,owners[1],{lockClass:HANDOFF_CLASS,lockId:writerId});
  await assertGateOwner(coordinator,owners[1],{lockClass:HANDOFF_CLASS,lockId:fenceId});
  await verifyGate();
  if(failCandidate){
   await candidate.end();
   await verifyGate();
   await authorize('rollback');
   await acquireRehearsalWriter(rollback,owners[0],{lockClass:HANDOFF_CLASS,gateId,writerId});
   if(!await lock(rollback,fenceId))throw Error('Rollback fence unavailable.');
   await assertGateOwner(coordinator,owners[2],{lockClass:HANDOFF_CLASS,lockId:writerId});
   await assertGateOwner(coordinator,owners[2],{lockClass:HANDOFF_CLASS,lockId:fenceId});
   await verifyGate();
  }
  return {state:failCandidate?'rollback-rehearsed':'candidate-rehearsed',gateObservedThroughoutChecks:true,writerAndFenceVerified:true,privateFixtureAuthorizationVerified:true,fixtureIsDatabaseWriter:false,liveStartupAllowed:false,recoveryAllowed:false,continuousExclusionVerified:false};
 }finally{
  for(const c of [candidate,rollback,rival,coordinator]){try{await c.end();}catch{}finally{c.off('error',onError);}}
 }
}
