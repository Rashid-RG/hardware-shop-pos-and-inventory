// Maintenance-only helper. Does not change database configuration or terminate clients.
import pg from 'pg';
import { acquireHandoffGate, acquireMaintenanceTransactionFence, assertMaintenanceOwner } from '../database-handoff-gate.mjs';
import { readFileSync, realpathSync, lstatSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const project=realpathSync(process.cwd());
const state=resolve(process.env.HOME,'.local/share/ars-hardware');
const sha=b=>createHash('sha256').update(b).digest('hex');
function evidence(path){
  const s=lstatSync(path);
  if(!s.isFile()||s.size<1||s.size>65536||realpathSync(path)!==path)throw Error('Invalid maintenance evidence.');
  const raw=readFileSync(path);
  const z=lstatSync(path);
  if(raw.length!==s.size||z.ino!==s.ino||z.dev!==s.dev||z.mtimeMs!==s.mtimeMs||z.ctimeMs!==s.ctimeMs)throw Error('Evidence changed.');
  return raw;
}
const holdPath=resolve(state,'maintenance-hold.json');
const holdRaw=evidence(holdPath);
const hold=JSON.parse(holdRaw);
const uninstall=process.argv[3]==='--uninstall';
if(process.argv.length!==(uninstall?4:3)||hold.purpose!==(uninstall?'pre-uninstall backup':'pre-update backup')||hold.previousProject!==project||hold.version!==process.argv[2])throw Error('Matching maintenance hold required.');
if(uninstall&&(!/^[a-f0-9]{32}$/.test(hold.uninstallId)||hold.applicationRemovalAllowed!==false))throw Error('Non-authorizing uninstall hold required.');
const shutdownPath=resolve(state,'uninstall-shutdown.json');
const shutdownRaw=uninstall?evidence(shutdownPath):null;
if(uninstall){
  const p=JSON.parse(shutdownRaw);
  if(hold.schema!==1||hold.databaseDeletionAllowed!==false||p.schema!==1||p.kind!=='mint-uninstall-shutdown-observation'||p.previousProject!==project||p.uninstallId!==hold.uninstallId||p.holdDigest!==sha(holdRaw)||p.serviceStopped!==true||p.ordinaryStartupBlocked!==true||p.databaseClientsAbsentAtCheck!==true||['applicationRemovalAllowed','databaseDeletionAllowed','continuousExclusionVerified','finalUninstallBackupVerified'].some(k=>p[k]!==false))throw Error('Matching protected shutdown required.');
}
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
  await acquireMaintenanceTransactionFence(client);
  const maintenanceOwner=await assertMaintenanceOwner(client);
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='0'");
  const {rows}=await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  if(!rows.length)throw Error('No managed tables found.');
  const ident=x=>'"'+x.replaceAll('"','""')+'"';
  // SHARE conflicts with ordinary INSERT/UPDATE/DELETE and table DDL, but allows pg_dump reads.
  await client.query('LOCK TABLE '+rows.map(r=>ident(r.schemaname)+'.'+ident(r.tablename)).join(',')+' IN SHARE MODE NOWAIT');
  const before=await client.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'");
  if(before.rows[0].count!==0|| (await client.query('SELECT count(*)::int AS count FROM pg_prepared_xacts WHERE database=current_database()')).rows[0].count!==0)throw Error('Other database clients detected.');
  let output='';
  await new Promise((ok,fail)=>{
    child=spawn('python3',[uninstall?'scripts/mint/prepare-uninstall-backup.py':'scripts/mint/prepare-update-backup.py',process.argv[2]],{cwd:project,stdio:['ignore','pipe','inherit'],detached:true});
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>65536){failure=Error('Unexpected backup output');stopChild();}});
    const timer=setTimeout(()=>{failure=Error('Maintenance backup timed out');stopChild();},900000);
    child.once('error',err=>{clearTimeout(timer);fail(err);});
    child.once('exit',code=>{clearTimeout(timer);failure||code!==0?fail(failure||Error('Backup failed')):ok();});
  });
  if(failure)throw failure;
  const after=await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  if(JSON.stringify(rows)!==JSON.stringify(after.rows))throw Error('Database table set changed during backup.');
  const matches=output.split(/\r?\n/).filter(x=>x.startsWith('Pinned recovery archive: '));
  if(matches.length!==1)throw Error('Missing unique recovery archive');
  const folder=matches[0].slice('Pinned recovery archive: '.length);
  if(realpathSync(folder)!==folder||dirname(folder)!==resolve(state,uninstall?'uninstall-recovery':'update-recovery')||!lstatSync(folder).isDirectory())throw Error('Unexpected recovery folder.');
  const metaPath=resolve(folder,'recovery.json'),metaRaw=evidence(metaPath),meta=JSON.parse(metaRaw);
  if(meta.version!==hold.version||meta.previousProject!==project||meta.activationApproved!==false||!/^ars-mint-[A-Za-z0-9_-]+\.dump$/.test(meta.archive))throw Error('Recovery metadata mismatch.');
  if(uninstall&&(meta.kind!=='mint-final-uninstall-backup'||meta.uninstallId!==hold.uninstallId||meta.applicationRemovalAllowed!==false||meta.restoreTestPassed!==false||meta.shutdownDigest!==sha(shutdownRaw)))throw Error('Uninstall backup metadata mismatch.');
  const identity=await client.query("SELECT current_database() AS database,system_identifier::text AS system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid FROM pg_control_system()");
  const db=identity.rows[0];
  if(identity.rows.length!==1||db.database!=='hardware_pos_ars'||!/^\d{1,20}$/.test(db.system_identifier)||!/^\d{1,10}$/.test(db.database_oid))throw Error('Database identity unavailable.');
  const locks=await client.query("SELECT count(DISTINCT objid)::int AS count FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=1642958133 AND objid IN (1,2,3) AND objsubid=2 AND mode='ExclusiveLock' AND granted");
  if(locks.rows[0]?.count!==3||failure||sha(evidence(holdPath))!==sha(holdRaw)||sha(evidence(metaPath))!==sha(metaRaw))throw Error('Protected backup evidence changed.');
  await assertMaintenanceOwner(client,maintenanceOwner);
  const receipt={schema:1,kind:'mint-maintenance-backup-observation',holdDigest:sha(holdRaw),recoveryDigest:sha(metaRaw),archive:meta.archive,version:hold.version,database:db.database,systemIdentifier:db.system_identifier,databaseOid:db.database_oid,recordedAt:new Date().toISOString(),locksObserved:true,activationAllowed:false,continuousExclusionVerified:false};
  if(uninstall&&sha(evidence(shutdownPath))!==sha(shutdownRaw))throw Error('Shutdown evidence changed.');
  if(uninstall)Object.assign(receipt,{kind:'mint-uninstall-backup-observation',shutdownDigest:sha(shutdownRaw),uninstallId:hold.uninstallId,applicationRemovalAllowed:false,finalUninstallBackupVerified:false});
  const fd=openSync(resolve(folder,'maintenance-backup-receipt.json'),'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(receipt)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  const dir=openSync(folder,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
  await assertMaintenanceOwner(client,maintenanceOwner);
  await client.query('ROLLBACK');
  if(failure)throw failure;
  console.log(matches[0]);
  console.log('Application writer lease and existing public table SHARE locks were held during backup.');
}finally{
  await client.end().catch(()=>{});
}
