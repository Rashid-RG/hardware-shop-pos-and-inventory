// Maintenance-only helper. Does not change database configuration or terminate clients.
import pg from 'pg';
import { acquireHandoffGate } from '../database-handoff-gate.mjs';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const project=realpathSync(process.cwd());
const state=resolve(process.env.HOME,'.local/share/ars-hardware');
const hold=JSON.parse(readFileSync(resolve(state,'maintenance-hold.json'),'utf8'));
if(hold.purpose!=='pre-update backup'||hold.previousProject!==project||hold.version!==process.argv[2])throw Error('Matching maintenance hold required.');
const lines=readFileSync(resolve(project,'.env.local'),'utf8').split(/\r?\n/);
const urls=lines.filter(x=>x.startsWith('DATABASE_URL='));
if(urls.length!==1)throw Error('Unique local database configuration required.');
const url=new URL(urls[0].slice(13));
if(url.hostname!=='127.0.0.1'||url.port!=='5434'||url.pathname!=='/hardware_pos_ars'||url.username!=='ars')throw Error('Not the managed local database.');
const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,query_timeout:15000});
let child, failure;
function stopChild(){if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}}
process.on('SIGTERM',()=>{failure=Error('Backup interrupted');stopChild();});
process.on('SIGINT',()=>{failure=Error('Backup interrupted');stopChild();});
client.on('error',err=>{failure=err;stopChild();});
try{
  await client.connect();
  await acquireHandoffGate(client);
  // Same session advisory key as server.ts: exclude cooperating server startups
  // before enumerating tables and retain the lease through the entire backup.
  const lease=await client.query('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired',[1642958133,1]);
  if(lease.rows[0]?.acquired!==true) throw Error('Application writer still owns the database.');
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='0'");
  const {rows}=await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  if(!rows.length)throw Error('No managed tables found.');
  const ident=x=>'"'+x.replaceAll('"','""')+'"';
  // SHARE conflicts with ordinary INSERT/UPDATE/DELETE and table DDL, but allows pg_dump reads.
  await client.query('LOCK TABLE '+rows.map(r=>ident(r.schemaname)+'.'+ident(r.tablename)).join(',')+' IN SHARE MODE NOWAIT');
  const before=await client.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'");
  if(before.rows[0].count!==0)throw Error('Other database clients detected.');
  let output='';
  await new Promise((ok,fail)=>{
    child=spawn('python3',['scripts/mint/prepare-update-backup.py',process.argv[2]],{cwd:project,stdio:['ignore','pipe','inherit'],detached:true});
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>65536){failure=Error('Unexpected backup output');stopChild();}});
    const timer=setTimeout(()=>{failure=Error('Maintenance backup timed out');stopChild();},900000);
    child.once('error',err=>{clearTimeout(timer);fail(err);});
    child.once('exit',code=>{clearTimeout(timer);failure||code!==0?fail(failure||Error('Backup failed')):ok();});
  });
  if(failure)throw failure;
  const after=await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  if(JSON.stringify(rows)!==JSON.stringify(after.rows))throw Error('Database table set changed during backup.');
  await client.query('ROLLBACK');
  const matches=output.split(/\r?\n/).filter(x=>x.startsWith('Pinned recovery archive: '));
  if(matches.length!==1)throw Error('Missing unique recovery archive');
  console.log(matches[0]);
  console.log('Application writer lease and existing public table SHARE locks were held during backup.');
}finally{
  await client.end().catch(()=>{});
}
