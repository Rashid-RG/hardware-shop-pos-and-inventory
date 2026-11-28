// Windows final archive wrapper: holds the application lease and table SHARE locks
// while the fixed local backup script executes. Never starts a POS or switches a database.
import pg from 'pg';
import {withMaintenanceSession} from './database-maintenance-session.mjs';
import {withMaintenanceTableFence} from './database-maintenance-table-fence.mjs';
import {resolveWindowsMaintenanceDatabase} from './windows-maintenance-database-config.mjs';
import {runVerifiedInstalledWindowsBackup} from './windows-verified-installed-backup.mjs';
import dotenv from 'dotenv';
import {readFileSync,realpathSync,openSync,writeFileSync,fsyncSync,closeSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fingerprintPublicTables,assertFingerprintMatch} from './uninstall-table-fingerprints.mjs';
import {join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
async function main(){
 const uninstall=process.argv[3]==='--uninstall-manifest';
 if(process.platform!=='win32'||process.argv.length!==(uninstall?4:3)||process.env.ARS_RUNTIME_ROOT!==undefined) throw Error('Unsupported maintenance runtime.');
 const destination=realpathSync(process.argv[2]);
 const evidence=()=>{
  if(!process.env.LOCALAPPDATA)throw Error('Local application state unavailable.');
  const state=join(process.env.LOCALAPPDATA,'RS Nextward','ARS Distributor');
  const control=join(state,'desktop-control');
  const read=name=>{
   const path=join(control,name);
   const st=lstatSync(path);
   if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>65536||realpathSync(path).toLowerCase()!==resolve(path).toLowerCase())throw Error('Invalid maintenance evidence.');
   const raw=readFileSync(path);
   return {value:JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')),digest:createHash('sha256').update(raw).digest('hex').toUpperCase()};
  };
  const h=read('maintenance.json'),p=read('maintenance-shutdown.json');
  const a=h.value,b=p.value;
  if(a.schema!==1||b.schema!==1||a.purpose!=='pre-uninstall backup'||b.purpose!==a.purpose||typeof a.project!=='string'||typeof b.project!=='string'||a.project.toLowerCase()!==root.toLowerCase()||b.project.toLowerCase()!==root.toLowerCase()||!/^[a-f0-9]{32}$/.test(a.uninstallId)||b.uninstallId!==a.uninstallId||a.shutdownVerified!==false||b.shutdownVerified!==true||a.pid!==b.pid||!Number.isInteger(a.pid)||a.pid<1||a.startedUtc!==b.startedUtc||a.requestedAt!==b.requestedAt||[a,b].some(r=>['applicationRemovalAllowed','databaseDeletionAllowed','activationApproved'].some(k=>r[k]!==false))||destination.toLowerCase()!==join(state,'uninstall-recovery',a.uninstallId).toLowerCase())throw Error('Matching non-authorizing shutdown evidence required.');
  return {uninstallId:a.uninstallId,holdDigest:h.digest,shutdownDigest:p.digest};
 };
 const shutdown=uninstall?evidence():null;
 const config=resolveWindowsMaintenanceDatabase(dotenv.parse(readFileSync(join(root,'.env.local'))));
 const client=new pg.Client(config.connection);
 const interrupted=new AbortController();
 const interrupt=()=>interrupted.abort();
 process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
 try{
  const archive=await withMaintenanceSession(client,config.database,session=>withMaintenanceTableFence(client,session,async fence=>{
   const signal=AbortSignal.any([fence.signal,interrupted.signal]);
   const assertActive=async()=>{
    if(signal.aborted)throw Error('Maintenance backup interrupted.');
    await fence.assertActive();
    if(signal.aborted)throw Error('Maintenance backup interrupted.');
   };
   const scope=Object.freeze({owner:fence.owner,signal,assertActive});
   await assertActive();
   const before=uninstall?await fingerprintPublicTables(client):null;
   if(uninstall&&JSON.stringify(evidence())!==JSON.stringify(shutdown))throw Error('Shutdown evidence changed before protected backup.');
   await assertActive();
   const result=await runVerifiedInstalledWindowsBackup(scope,{root,destination});
   await assertActive();
   if(uninstall){
    assertFingerprintMatch(before,await fingerprintPublicTables(client));
    if(JSON.stringify(evidence())!==JSON.stringify(shutdown))throw Error('Shutdown evidence changed during protected backup.');
    await assertActive();
    const manifest={...shutdown,schema:1,kind:'windows-uninstall-table-manifest',archive:basename(result.archive),dumpSha256:result.sha256,tables:before,locksObserved:true,applicationRemovalAllowed:false,continuousExclusionVerified:false};
    const fd=openSync(join(destination,'uninstall-table-manifest.json'),'wx',0o600);
    try{writeFileSync(fd,JSON.stringify(manifest)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
   }
   await assertActive();
   return result.archive;
  }));
  if(interrupted.signal.aborted)throw Error('Maintenance backup interrupted.');
  console.log('ARS_ARCHIVE='+archive);
 }finally{
  process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
 }
}
main().catch(()=>{console.error('Protected Windows maintenance backup failed. No activation authorized.');process.exitCode=1;});
