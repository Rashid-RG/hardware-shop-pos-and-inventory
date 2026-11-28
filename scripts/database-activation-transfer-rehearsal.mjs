// Disposable activation rehearsal: hold the coordinator gate across both child writers.
// No production connection or pointer mutation.
import pg from 'pg';
import {randomInt} from 'node:crypto';
import {assertGateOwner,HANDOFF_CLASS} from './database-handoff-gate.mjs';
import {rehearseChildWriter} from './database-handoff-child-writer.mjs';
export async function rehearseActivationTransfer(connection,binding,{failCandidate=false}={}){
 const url=new URL(connection);
 if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/hardware_pos_ci'||!['postgres:','postgresql:'].includes(url.protocol)||url.search||url.hash)throw Error('Disposable CI database required.');
 if(!['releaseDigest','runtimeDigest','maintenanceDigest'].every(k=>typeof binding?.[k]==='string'&&/^[a-f0-9]{64}$/.test(binding[k])))throw Error('Verified fixture binding required.');
 const ids=new Set();while(ids.size<3)ids.add(randomInt(10,2147483647));
 const [gateId,writerId,fenceId]=ids;
 const options={connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:5000,options:'-c default_transaction_read_only=on'};
 const coordinator=new pg.Client(options),rival=new pg.Client(options);
 let lost=false;
 for(const c of [coordinator,rival])c.on('error',()=>{lost=true;});
 try{
  await coordinator.connect();await rival.connect();
  const identity=async c=>(await c.query("SELECT current_database() AS database,pg_backend_pid() AS pid,backend_start::text AS started,system_identifier::text AS cluster,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid FROM pg_stat_activity,pg_control_system() WHERE pid=pg_backend_pid()")).rows[0];
  const owner=await identity(coordinator),other=await identity(rival);
  if(owner?.database!=='hardware_pos_ci'||other?.database!==owner.database||other.cluster!==owner.cluster||other.oid!==owner.oid||other.pid===owner.pid)throw Error('Fixture identity mismatch.');
  const lock=async(c,id)=>(await c.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[HANDOFF_CLASS,id])).rows[0]?.acquired===true;
  if(!await lock(coordinator,gateId))throw Error('Gate unavailable.');
  const check=async()=>{
   if(lost)throw Error('Fixture connection lost.');
   await assertGateOwner(coordinator,owner,{lockClass:HANDOFF_CLASS,lockId:gateId});
   if(await lock(rival,gateId))throw Error('Rival acquired gate.');
   if(lost)throw Error('Fixture connection lost.');
  };
  // A queued independent contender must remain blocked throughout both transfers.
  const observer=new pg.Client(options);
  observer.on('error',()=>{lost=true;});
  let queued;
  try{
   await observer.connect();
   const waiting=await identity(observer);
   if(waiting.cluster!==owner.cluster||waiting.oid!==owner.oid||waiting.pid===owner.pid||waiting.pid===other.pid)throw Error('Observer identity mismatch.');
   let acquired=false,failed=false;
   queued=observer.query('SELECT pg_advisory_lock($1::integer,$2::integer)',[HANDOFF_CLASS,gateId]).then(()=>{acquired=true;},()=>{failed=true;});
   const assertWaiting=async()=>{
    const r=await coordinator.query("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=$1::oid AND objid=$2::oid AND objsubid=2 AND pid=$3::integer AND mode='ExclusiveLock' AND NOT granted) AS waiting",[HANDOFF_CLASS,gateId,waiting.pid]);
    if(acquired||failed||lost||r.rows[0]?.waiting!==true)throw Error('Queued gate exclusion not observed.');
   };
   // Wait for PostgreSQL to register the contender, rather than assuming IPC timing.
   let registered=false;
   for(let attempt=0;attempt<100;attempt++){
    try{await assertWaiting();registered=true;break;}catch(e){if(acquired||failed||lost)throw e;await new Promise(resolve=>setTimeout(resolve,10));}
   }
   if(!registered)throw Error('Queued contender not registered.');
   await check();
  for(const purpose of ['candidate','rollback']){
   const result=await rehearseChildWriter(coordinator,url.toString(),{gateId,writerId,fenceId},{...binding,purpose},{failAfterAcquisition:failCandidate&&purpose==='candidate'});
   if(failCandidate&&purpose==='candidate'&&result.forcedFailureObserved!==true)throw Error('Candidate failure was not observed.');
   if(result.childHeldWriterAndFence!==true||result.authorizationVerified!==true||result.liveStartupAllowed!==false)throw Error('Fixture writer transfer failed.');
   await check();
   await assertWaiting();
   // Both child leases must have been released before the next phase.
   for(const id of [writerId,fenceId]){
    let released=false;
    for(let attempt=0;attempt<100;attempt++){
     if(await lock(coordinator,id)){released=true;break;}
     await check();
     await assertWaiting();
     await new Promise(resolve=>setTimeout(resolve,25));
    }
    if(!released)throw Error('Child lease remains held.');
    if((await coordinator.query('SELECT pg_advisory_unlock($1::integer,$2::integer) AS released',[HANDOFF_CLASS,id])).rows[0]?.released!==true)throw Error('Fixture lease release failed.');
   }
  }
  await check();
  await assertWaiting();
  // Release only after both child leases are gone; the queued contender must then acquire.
  if((await coordinator.query('SELECT pg_advisory_unlock($1::integer,$2::integer) AS released',[HANDOFF_CLASS,gateId])).rows[0]?.released!==true)throw Error('Coordinator gate release failed.');
  await queued;
  if(!acquired||failed||lost)throw Error('Queued contender did not acquire after release.');
  await assertGateOwner(observer,waiting,{lockClass:HANDOFF_CLASS,lockId:gateId});
  }finally{await observer.end();if(queued)await queued;}
  return {candidateWriterRehearsed:true,rollbackWriterRehearsed:true,...(failCandidate?{candidateFailureObserved:true}:{}),gateObservedAcrossTransitions:true,liveStartupAllowed:false,activationAllowed:false,continuousExclusionVerified:false};
 }finally{await Promise.allSettled([rival.end(),coordinator.end()]);}
}
