// Internal protected uninstall backup stage for the continuous coordinator.
// No connection acquisition, transaction release, live restore or deletion.
import {open,lstat,realpath} from 'node:fs/promises';
import {join,resolve,basename,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {fingerprintPublicTables,assertFingerprintMatch} from './uninstall-table-fingerprints.mjs';
import {runVerifiedInstalledWindowsBackup} from './windows-verified-installed-backup.mjs';

async function readShutdown(root,destination){
 const state=join(process.env.LOCALAPPDATA,'RS Nextward','ARS Distributor');
 const control=join(state,'desktop-control');
 const read=async name=>{
  const path=join(control,name),st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>65536||(await realpath(path)).toLowerCase()!==path.toLowerCase())throw Error('Invalid shutdown evidence.');
  const handle=await open(path,'r');
  try{
   const raw=await handle.readFile();
   const after=await handle.stat();
   if(raw.length!==st.size||after.size!==st.size||after.mtimeMs!==st.mtimeMs||after.ino!==st.ino||after.dev!==st.dev)throw Error('Shutdown evidence changed.');
   return {record:JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')),digest:createHash('sha256').update(raw).digest('hex').toUpperCase()};
  }finally{await handle.close();}
 };
 const h=await read('maintenance.json'),p=await read('maintenance-shutdown.json');
 const a=h.record,b=p.record;
 if(a.schema!==1||b.schema!==1||a.purpose!=='pre-uninstall backup'||b.purpose!==a.purpose||typeof a.project!=='string'||typeof b.project!=='string'||a.project.toLowerCase()!==root.toLowerCase()||b.project.toLowerCase()!==root.toLowerCase()||!/^[a-f0-9]{32}$/.test(a.uninstallId)||b.uninstallId!==a.uninstallId||a.shutdownVerified!==false||b.shutdownVerified!==true||a.pid!==b.pid||!Number.isInteger(a.pid)||a.pid<1||a.startedUtc!==b.startedUtc||a.requestedAt!==b.requestedAt||[a,b].some(r=>['applicationRemovalAllowed','databaseDeletionAllowed','activationApproved'].some(k=>r[k]!==false))||destination.toLowerCase()!==join(state,'uninstall-recovery',a.uninstallId).toLowerCase())throw Error('Matching non-authorizing shutdown evidence required.');
 return {uninstallId:a.uninstallId,holdDigest:h.digest,shutdownDigest:p.digest};
}
export async function runWindowsContinuousBackupStage(client,scope,{root,destination}={}){
 if(process.platform!=='win32'||typeof process.env.LOCALAPPDATA!=='string'||!isAbsolute(process.env.LOCALAPPDATA)||process.env.ARS_RUNTIME_ROOT!==undefined||typeof scope?.assertActive!=='function'||!scope.signal||!['hardware_pos','hardware_pos_ars'].includes(scope.owner?.database)||![root,destination].every(p=>typeof p==='string'&&isAbsolute(p)))throw Error('Protected Windows recovery scope required.');
 const database=scope.owner.database;
 const check=async()=>{await scope.assertActive();if(scope.signal.aborted||scope.owner.database!==database)throw Error('Recovery interrupted.');};
 await check();
 root=resolve(root);destination=resolve(destination);
 for(const path of [root,destination]){const st=await lstat(path);if(!st.isDirectory()||st.isSymbolicLink()||(await realpath(path)).toLowerCase()!==path.toLowerCase())throw Error('Invalid recovery directory.');}
 const shutdown=await readShutdown(root,destination);
 const unchanged=async()=>{if(JSON.stringify(await readShutdown(root,destination))!==JSON.stringify(shutdown))throw Error('Shutdown evidence changed.');};
 const manifestPath=join(destination,'uninstall-table-manifest.json');
 try{await lstat(manifestPath);throw Error('Existing recovery manifest must be retained.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const before=await fingerprintPublicTables(client);
 await check();await unchanged();
 const backup=await runVerifiedInstalledWindowsBackup(scope,{root,destination});
 await check();
 if(dirname(backup.archive).toLowerCase()!==destination.toLowerCase()||!new RegExp('^ars-'+database+'-[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-f0-9]{32}-with-uploads\\.dump$').test(basename(backup.archive)))throw Error('Complete matching backup required.');
 assertFingerprintMatch(before,await fingerprintPublicTables(client));
 await unchanged();await check();
 const manifest={...shutdown,schema:1,kind:'windows-uninstall-table-manifest',sourceDatabase:database,archive:basename(backup.archive),dumpSha256:backup.sha256,tables:before,locksObserved:true,applicationRemovalAllowed:false,continuousExclusionVerified:false};
 const handle=await open(manifestPath,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(manifest)+'\n');await handle.sync();}finally{await handle.close();}
 await unchanged();await check();
 return Object.freeze({...backup,database,manifestPath,uninstallId:shutdown.uninstallId,applicationRemovalAllowed:false,databaseDeletionAllowed:false,continuousExclusionVerified:false});
}
