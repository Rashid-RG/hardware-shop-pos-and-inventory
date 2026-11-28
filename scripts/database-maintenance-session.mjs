// Internal session lifecycle; no CLI, startup, deletion or removal authorization.
// The supplied client must be a fresh dedicated pg.Client, never a pooled client.
import {acquireHandoffGate,acquireMaintenanceTransactionFence,assertMaintenanceOwner,HANDOFF_CLASS,WRITER_ID} from './database-handoff-gate.mjs';

export async function withMaintenanceSession(client,expectedDatabase,work){
 if(!['hardware_pos','hardware_pos_ars','hardware_pos_ci'].includes(expectedDatabase)||typeof work!=='function'||typeof client?.connect!=='function'||typeof client?.end!=='function'||typeof client?.release==='function')throw Error('Dedicated managed maintenance session required.');
 const controller=new AbortController();
 let owner,active=false,failed=false,checking=false;
 const lose=()=>{failed=true;controller.abort();};
 client.on('error',lose);
 client.on('end',lose);
 const assertActive=async()=>{
  if(!active||failed||checking)throw Error('Maintenance session unavailable.');
  checking=true;
  try{
   await assertMaintenanceOwner(client,owner);
   if(failed||!active)throw Error('Maintenance session lost.');
   return owner;
  }catch(error){lose();throw error;}finally{checking=false;}
 };
 try{
  await client.connect();
  const db=await client.query('SELECT current_database() AS name');
  if(db.rows.length!==1||db.rows[0]?.name!==expectedDatabase||failed)throw Error('Unexpected maintenance database.');
  await acquireHandoffGate(client);
  const writer=await client.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[HANDOFF_CLASS,WRITER_ID]);
  if(writer.rows[0]?.acquired!==true||failed)throw Error('Application writer lease unavailable.');
  await acquireMaintenanceTransactionFence(client);
  owner=await assertMaintenanceOwner(client);
  if(owner.database!==expectedDatabase||failed)throw Error('Maintenance owner unavailable.');
  active=true;
  await assertActive();
  // Trusted internal stages must honor signal, check ownership at boundaries
  // and never release locks, reconnect, or execute destructive operations.
  const value=await work(Object.freeze({owner,signal:controller.signal,assertActive}));
  await assertActive();
  return value;
 }finally{
  active=false;
  controller.abort();
  try{await client.end();}finally{
   client.off('error',lose);
   client.off('end',lose);
  }
 }
}
