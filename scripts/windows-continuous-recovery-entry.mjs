// Internal command bridge; requires a previously prepared shutdown and folder.
// Never starts/stops POS, removes software, or restores into the live database.
import {realpath,readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname,basename,isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {runInstalledWindowsContinuousRecovery} from './windows-installed-continuous-recovery.mjs';
async function main(){
 if(process.platform!=='win32'||process.argv.length!==5||!process.env.LOCALAPPDATA||!isAbsolute(process.env.LOCALAPPDATA))throw Error('Invalid recovery request.');
 const [destination,holdDigest,shutdownDigest]=process.argv.slice(2);
 if(!isAbsolute(destination)||![holdDigest,shutdownDigest].every(x=>/^[A-F0-9]{64}$/.test(x)))throw Error('Invalid preparation evidence.');
 const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
 const state=join(process.env.LOCALAPPDATA,'RS Nextward','ARS Distributor');
 const folder=await realpath(destination);
 if(folder.toLowerCase()!==resolve(destination).toLowerCase()||dirname(folder).toLowerCase()!==join(state,'uninstall-recovery').toLowerCase()||!/^[a-f0-9]{32}$/.test(basename(folder)))throw Error('Managed recovery directory required.');
 const check=async()=>{
  for(const [name,digest] of [['maintenance.json',holdDigest],['maintenance-shutdown.json',shutdownDigest]]){
   const path=join(state,'desktop-control',name),st=await lstat(path);
   if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>65536||(await realpath(path)).toLowerCase()!==path.toLowerCase())throw Error('Invalid shutdown evidence.');
   if(createHash('sha256').update(await readFile(path)).digest('hex').toUpperCase()!==digest)throw Error('Prepared shutdown evidence changed.');
  }
 };
 const controller=new AbortController(),interrupt=()=>controller.abort();
 process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
 try{
  await check();
  const result=await runInstalledWindowsContinuousRecovery({root,destination:folder,signal:controller.signal});
  await check();
  if(controller.signal.aborted||result.finalReviewMatched!==true||result.sharedProtectionScopeObserved!==true||!/^[a-f0-9]{64}$/.test(result.restoreObservationDigest)||['applicationRemovalAllowed','databaseDeletionAllowed','serviceRemovalAllowed','activationAllowed','uninstalled','finalUninstallBackupVerified','continuousExclusionVerified'].some(k=>result[k]!==false))throw Error('Invalid recovery result.');
  console.log('ARS_RECOVERY='+JSON.stringify({...result,uninstallId:basename(folder)}));
 }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
}
main().catch(()=>{console.error('Continuous recovery failed. Existing evidence retained; no activation authorized.');process.exitCode=1;});
