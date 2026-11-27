// Internal transaction scope for trusted read-only maintenance stages.
// Caller must supply the SAME dedicated client owned by withMaintenanceSession.
// No removal, activation, or database deletion authorization.
import {assertMaintenanceOwner} from './database-handoff-gate.mjs';
const tablesSql="SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename";
const ident=s=>'"'+s.replaceAll('"','""')+'"';
export async function withMaintenanceTableFence(client,session,work){
 if(typeof work!=='function'||typeof session?.assertActive!=='function'||!session.owner||!session.signal)throw Error('Protected maintenance scope required.');
 const verify=async()=>{
  await session.assertActive();
  await assertMaintenanceOwner(client,session.owner);
  if(session.signal.aborted)throw Error('Maintenance interrupted.');
 };
 await verify();
 let begun=false;
 try{
  await client.query('BEGIN');
  begun=true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='0'");
  const {rows}=await client.query(tablesSql);
  if(!rows.length||rows.some(r=>r.schemaname!=='public'||typeof r.tablename!=='string'||!r.tablename))throw Error('No valid managed public tables.');
  await client.query('LOCK TABLE '+rows.map(r=>ident(r.schemaname)+'.'+ident(r.tablename)).join(',')+' IN SHARE MODE NOWAIT');
  const activity=await client.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') OR EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) AS busy");
  if(activity.rows.length!==1||activity.rows[0].busy!==false)throw Error('Other database clients or prepared transactions detected.');
  const snapshot=JSON.stringify(rows);
  const assertFence=async()=>{
   await verify();
   if(JSON.stringify((await client.query(tablesSql)).rows)!==snapshot)throw Error('Maintenance table set changed.');
   const held=await client.query("SELECT count(DISTINCT c.oid)::int AS count FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace WHERE l.pid=pg_backend_pid() AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND l.locktype='relation' AND l.mode='ShareLock' AND l.granted AND n.nspname='public' AND c.relkind IN ('r','p')");
   if(held.rows.length!==1||held.rows[0].count!==rows.length)throw Error('Maintenance table locks not verified.');
   if(session.signal.aborted)throw Error('Maintenance interrupted.');
  };
  await assertFence();
  const result=await work(Object.freeze({signal:session.signal,owner:session.owner,assertActive:assertFence}));
  await assertFence();
  return result;
 }finally{
  if(begun)await client.query('ROLLBACK');
 }
}
