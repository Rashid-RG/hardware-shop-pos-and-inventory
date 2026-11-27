// Maintenance-only helper. Does not change database configuration or terminate clients.
import pg from 'pg';
import {withMaintenanceSession} from '../database-maintenance-session.mjs';
import {withMaintenanceTableFence} from '../database-maintenance-table-fence.mjs';
import {runMaintenanceChild} from '../database-maintenance-child.mjs';
import { readFileSync, realpathSync, lstatSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
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
const interruption=new AbortController();
const interrupt=()=>interruption.abort();
process.on('SIGTERM',interrupt);
process.on('SIGINT',interrupt);
try{
 const message=await withMaintenanceSession(client,'hardware_pos_ars',session=>withMaintenanceTableFence(client,session,async fence=>{
  const signal=AbortSignal.any([fence.signal,interruption.signal]);
  const assertActive=async()=>{
   if(signal.aborted)throw Error('Backup interrupted.');
   await fence.assertActive();
   if(signal.aborted)throw Error('Backup interrupted.');
  };
  const scope=Object.freeze({owner:fence.owner,signal,assertActive});
  const output=await runMaintenanceChild(scope,'python3',[uninstall?'scripts/mint/prepare-uninstall-backup.py':'scripts/mint/prepare-update-backup.py',process.argv[2]],{cwd:project,timeoutMs:900000,maxOutput:65536});
  await assertActive();
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
  if(locks.rows[0]?.count!==3||signal.aborted||sha(evidence(holdPath))!==sha(holdRaw)||sha(evidence(metaPath))!==sha(metaRaw))throw Error('Protected backup evidence changed.');
  await assertActive();
  const receipt={schema:1,kind:'mint-maintenance-backup-observation',holdDigest:sha(holdRaw),recoveryDigest:sha(metaRaw),archive:meta.archive,version:hold.version,database:db.database,systemIdentifier:db.system_identifier,databaseOid:db.database_oid,recordedAt:new Date().toISOString(),locksObserved:true,activationAllowed:false,continuousExclusionVerified:false};
  if(uninstall&&sha(evidence(shutdownPath))!==sha(shutdownRaw))throw Error('Shutdown evidence changed.');
  if(uninstall)Object.assign(receipt,{kind:'mint-uninstall-backup-observation',shutdownDigest:sha(shutdownRaw),uninstallId:hold.uninstallId,applicationRemovalAllowed:false,finalUninstallBackupVerified:false});
  const fd=openSync(resolve(folder,'maintenance-backup-receipt.json'),'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(receipt)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  const dir=openSync(folder,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
  await assertActive();
  return matches[0];
 }));
 if(interruption.signal.aborted)throw Error('Backup interrupted.');
 console.log(message);
 console.log('Application writer lease and existing public table SHARE locks were held during backup.');
}finally{
 process.off('SIGTERM',interrupt);
 process.off('SIGINT',interrupt);
}
