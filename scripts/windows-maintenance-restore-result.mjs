// Independently compare the restore observation with on-disk recovery evidence.
// Read-only; this verifies evidence consistency, not continuous writer exclusion.
import {open,lstat,realpath} from 'node:fs/promises';
import {join,resolve,basename,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const stable=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,names)=>object(x)&&Object.keys(x).length===names.length&&names.every(n=>Object.hasOwn(x,n));
const flags=['applicationRemovalAllowed','databaseDeletionAllowed','serviceRemovalAllowed','uninstalled','finalUninstallBackupVerified','continuousExclusionVerified'];
async function readEvidence(path,max,signal,json=false){
 const before=await lstat(path);
 if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>max||!same(await realpath(path),path))throw Error('Invalid restoration evidence file.');
 const file=await open(path,'r');
 try{
  if(!stable(before,await file.stat()))throw Error('Restoration evidence changed.');
  const hash=createHash('sha256'),chunks=[];
  for await(const chunk of file.createReadStream({autoClose:false})){
   if(signal.aborted)throw Error('Restoration interrupted.');
   hash.update(chunk);if(json)chunks.push(chunk);
  }
  if(!stable(before,await file.stat())||!stable(before,await lstat(path))||!same(await realpath(path),path))throw Error('Restoration evidence changed.');
  const digest=hash.digest('hex');
  if(!json)return {digest};
  return {digest,value:JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''))};
 }finally{await file.close();}
}
export async function verifyWindowsRestoreEvidence(scope,{destination,control}={}){
 const database=scope?.owner?.database;
 if(!['hardware_pos','hardware_pos_ars'].includes(database)||typeof scope.assertActive!=='function'||!scope.signal||![destination,control].every(p=>typeof p==='string'&&isAbsolute(p)))throw Error('Invalid restoration verification scope.');
 const verify=async()=>{await scope.assertActive();if(scope.signal.aborted||scope.owner?.database!==database)throw Error('Restoration interrupted or identity changed.');};
 await verify();
 const folder=resolve(destination),state=resolve(control),id=basename(folder);
 if(!/^[a-f0-9]{32}$/.test(id))throw Error('Invalid recovery identity.');
 for(const p of [folder,state]){const st=await lstat(p);if(!st.isDirectory()||st.isSymbolicLink()||!same(await realpath(p),p))throw Error('Invalid restoration evidence directory.');}
 const read=(p,max=65536,json=true)=>readEvidence(p,max,scope.signal,json);
 const paths={hold:join(state,'maintenance.json'),proof:join(state,'maintenance-shutdown.json'),meta:join(folder,'recovery.json'),observation:join(folder,'uninstall-restore-test.json'),manifest:join(folder,'uninstall-table-manifest.json')};
 const records={};
 for(const [key,path] of Object.entries(paths))records[key]=await read(path,key==='manifest'?16777216:65536);
 const {meta,observation,manifest,hold,proof}=Object.fromEntries(Object.entries(records).map(([k,v])=>[k,v.value]));
 const archive=meta?.archive;
 if(typeof archive!=='string'||!new RegExp('^ars-'+database+'-[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-f0-9]{32}-with-uploads\\.dump$').test(archive))throw Error('Restore archive identity mismatch.');
 if([meta,manifest,hold,proof,observation].some(x=>!object(x)||x.schema!==1||x.uninstallId!==id)||meta.kind!=='windows-final-uninstall-backup'||manifest.kind!=='windows-uninstall-table-manifest'||observation.kind!=='windows-uninstall-restore-observation'||meta.sourceDatabase!==database||manifest.sourceDatabase!==database||manifest.archive!==archive)throw Error('Restore evidence identity mismatch.');
 if(flags.some(k=>observation[k]!==false)||['isolatedRestorePassed','allPublicTableFingerprintsMatched','uploadArchiveReadable'].some(k=>observation[k]!==true)||!Number.isSafeInteger(observation.restoredTableCount)||observation.restoredTableCount<5||!Number.isSafeInteger(observation.uploadMemberCount)||observation.uploadMemberCount<0)throw Error('Invalid non-authorizing restoration observation.');
 if(!object(manifest.tables)||Object.keys(manifest.tables).length!==observation.restoredTableCount||['products','customers','sales_transactions','sales_transaction_items','customer_credit_payments'].some(k=>!Object.hasOwn(manifest.tables,k)))throw Error('Restored table evidence mismatch.');
 if(hold.shutdownVerified!==false||proof.shutdownVerified!==true||hold.purpose!=='pre-uninstall backup'||proof.purpose!==hold.purpose||[hold,proof].some(x=>x.applicationRemovalAllowed!==false||x.databaseDeletionAllowed!==false||x.activationApproved!==false)||manifest.locksObserved!==true||manifest.continuousExclusionVerified!==false||manifest.applicationRemovalAllowed!==false||['restoreTestPassed','finalUninstallBackupVerified','applicationRemovalAllowed','databaseDeletionAllowed','continuousExclusionVerified'].some(k=>meta[k]!==false))throw Error('Invalid protection evidence.');
 const evidence=Object.fromEntries(['hold','proof','meta'].map(k=>[k,records[k].digest.toUpperCase()]));
 if(!keys(observation.evidenceDigests,Object.keys(evidence))||Object.entries(evidence).some(([k,v])=>observation.evidenceDigests[k]!==v)||[meta,manifest].some(x=>x.holdDigest!==evidence.hold||x.shutdownDigest!==evidence.proof))throw Error('Restore shutdown evidence mismatch.');
 const zip=archive.slice(0,-5)+'-uploads.zip';
 const names=[archive,archive+'.sha256',zip,zip+'.sha256','uninstall-table-manifest.json'];
 if(!keys(meta.archiveDigests,names)||!keys(observation.archiveMemberDigests,names))throw Error('Incomplete restoration archive evidence.');
 const digests={};
 for(const name of names){
  const digest=name==='uninstall-table-manifest.json'?records.manifest.digest:(await read(join(folder,name),Number.MAX_SAFE_INTEGER,false)).digest;
  if(meta.archiveDigests[name]!==digest||observation.archiveMemberDigests[name]!==digest)throw Error('Restoration archive evidence mismatch.');
  digests[name]=digest;
 }
 if(observation.archiveSha256!==digests[archive]||manifest.dumpSha256!==digests[archive])throw Error('Restoration archive checksum mismatch.');
 for(const [key,path] of Object.entries(paths)){if((await read(path,key==='manifest'?16777216:65536)).digest!==records[key].digest)throw Error('Restoration evidence changed.');}
 await verify();
 return Object.freeze({database,uninstallId:id,observationDigest:records.observation.digest,archiveSha256:digests[archive],restoreObservationVerified:true,applicationRemovalAllowed:false,databaseDeletionAllowed:false,activationAllowed:false,continuousExclusionVerified:false});
}
