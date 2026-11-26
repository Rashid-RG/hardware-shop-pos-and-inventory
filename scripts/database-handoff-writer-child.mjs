// Fixed CI fixture: owns its own disposable database session, never loads POS.
import pg from 'pg';
import {acquireRehearsalWriter} from './database-handoff-writer-rehearsal.mjs';
import {assertGateOwner,HANDOFF_CLASS} from './database-handoff-gate.mjs';
let client,phase='challenge';
const stop=async code=>{phase='stopped';try{await client?.end();}finally{process.exit(code);}};
process.on('disconnect',()=>void stop(1));
process.on('message',async m=>{
 try{
  if(m?.schema!==1)throw Error('Invalid message.');
  if(phase==='challenge'&&m.type==='challenge'){
   phase='accepted';
   process.send({schema:1,type:'proof',token:m.token,binding:{...m.binding,candidatePid:process.pid}});
  }else if(phase==='accepted'&&m.type==='accepted'){
   phase='connecting';
   const u=new URL(m.connection);
   if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/hardware_pos_ci'||!['postgres:','postgresql:'].includes(u.protocol)||u.search||u.hash)throw Error('Disposable database required.');
   const {gateId,writerId,fenceId}=m.keys;
   if(![gateId,writerId,fenceId].every(n=>Number.isInteger(n)&&n>=10&&n<=2147483647)||new Set([gateId,writerId,fenceId]).size!==3)throw Error('Disposable keys required.');
   client=new pg.Client({connectionString:u.toString(),connectionTimeoutMillis:5000,query_timeout:5000,options:'-c default_transaction_read_only=on'});
   client.on('error',()=>void stop(1));
   await client.connect();
   const r=await client.query("SELECT current_database() AS database,pg_backend_pid() AS pid,backend_start::text AS started,system_identifier::text AS cluster,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid FROM pg_stat_activity,pg_control_system() WHERE pid=pg_backend_pid()");
   const owner=r.rows[0];
   if(r.rows.length!==1||owner.database!=='hardware_pos_ci'||owner.cluster!==m.owner.cluster||owner.oid!==m.owner.oid)throw Error('Identity mismatch.');
   await acquireRehearsalWriter(client,m.owner,{lockClass:HANDOFF_CLASS,gateId,writerId});
   const fence=await client.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[HANDOFF_CLASS,fenceId]);
   if(fence.rows[0]?.acquired!==true)throw Error('Fence unavailable.');
   await assertGateOwner(client,m.owner,{lockClass:HANDOFF_CLASS,lockId:gateId});
   phase='holding';
   process.send({schema:1,type:'holding',owner});
  }else if(phase==='holding'&&m.type==='release'){await stop(0);}
  else throw Error('Invalid phase.');
 }catch{await stop(1);}
});
