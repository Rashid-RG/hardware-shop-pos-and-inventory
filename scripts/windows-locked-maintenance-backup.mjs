// Windows final archive wrapper: holds the application lease and table SHARE locks
// while the fixed local backup script executes. Never starts a POS or switches a database.
import pg from 'pg';
import { acquireHandoffGate, acquireMaintenanceTransactionFence } from './database-handoff-gate.mjs';
import dotenv from 'dotenv';
import {readFileSync,realpathSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
async function main(){
 if(process.platform!=='win32'||process.argv.length!==3||process.env.ARS_RUNTIME_ROOT!==undefined) throw Error('Unsupported maintenance runtime.');
 const destination=realpathSync(process.argv[2]);
 const config=dotenv.parse(readFileSync(join(root,'.env.local')));
 const url=new URL(config.DATABASE_URL);
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.port!=='5433'||url.pathname!=='/hardware_pos'||url.search||url.hash||!url.username||!url.password) throw Error('Unsupported database configuration.');
 const client=new pg.Client({host:url.hostname==='[::1]'?'::1':url.hostname,port:5433,database:'hardware_pos',user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:false,connectionTimeoutMillis:5000,query_timeout:15000});
 let failure,child;
 const interrupt=()=>{failure=Error('Maintenance backup interrupted.');};
 process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
 client.on('error',()=>{failure=Error('Database protection connection lost.');});
 try{
  await client.connect();
  await acquireHandoffGate(client);
  const lease=await client.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[1642958133,1]);
  if(lease.rows[0]?.acquired!==true) throw Error('Application writer still owns database.');
  await acquireMaintenanceTransactionFence(client);
 await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='0'");
  const tables=()=>client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const {rows}=await tables();
  if(!rows.length) throw Error('No public tables.');
  const ident=x=>'"'+x.replaceAll('"','""')+'"';
  await client.query('LOCK TABLE '+rows.map(r=>ident(r.schemaname)+'.'+ident(r.tablename)).join(',')+' IN SHARE MODE NOWAIT');
  const activity=await client.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') OR EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) AS busy");
  if(activity.rows[0]?.busy!==false||failure) throw Error('Other database clients or prepared transactions detected.');
  let output='';
  await new Promise((ok,fail)=>{
   child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'scripts','backup-local-postgres.ps1'),'-Destination',destination,'-OutputArchive'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','ignore']});
   child.stdout.on('data',chunk=>{if(output.length<1048576)output+=chunk.toString();else failure=Error('Unexpected backup output.');});
   child.once('error',fail);
   child.once('close',code=>code===0&&!failure?ok():fail(failure||Error('Backup failed.')));
  });
  if(failure||JSON.stringify(rows)!==JSON.stringify((await tables()).rows)) throw Error('Maintenance evidence changed.');
  const paths=output.split(/\r?\n/).filter(l=>l.startsWith('ARS_ARCHIVE='));
  if(paths.length!==1||dirname(resolve(paths[0].slice(12))).toLowerCase()!==destination.toLowerCase()) throw Error('Unexpected archive location.');
  await client.query('ROLLBACK');
  if(failure) throw failure;
  console.log(paths[0]);
 }finally{
  await client.end().catch(()=>{});
  process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
 }
}
main().catch(()=>{console.error('Protected Windows maintenance backup failed. No activation authorized.');process.exitCode=1;});
