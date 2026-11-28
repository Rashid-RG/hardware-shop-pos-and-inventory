// Disposable database only. No production lock keys, application startup or writes.
import {assertGateOwner} from './database-handoff-gate.mjs';
export async function acquireRehearsalWriter(client,owner,{lockClass,gateId,writerId}){
 const db=await client.query('SELECT current_database() AS name');
 if(db.rows[0]?.name!=='hardware_pos_ci')throw Error('Disposable CI database required.');
 if(lockClass!==1642958133||![gateId,writerId].every(x=>Number.isInteger(x)&&x>=10&&x<=2147483647)||gateId===writerId)throw Error('Disposable lock keys required.');
 const options={lockClass,lockId:gateId};
 await assertGateOwner(client,owner,options);
 const result=await client.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[lockClass,writerId]);
 if(result.rows[0]?.acquired!==true)throw Error('Candidate writer lease unavailable.');
 try{
  await assertGateOwner(client,owner,options);
  return {writerLeaseAcquired:true,liveStartupAllowed:false};
 }catch(error){
  // This helper requires a dedicated pg.Client, never a pooled connection.
  // Destroy the session instead of returning a potentially locked connection.
  await client.end().catch(()=>{});
  throw error;
 }
}
