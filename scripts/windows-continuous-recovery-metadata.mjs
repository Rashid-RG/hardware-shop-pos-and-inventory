// Internal recovery metadata stage; retains the caller's maintenance scope.
// Creates only a new recovery.json; never overwrites existing recovery evidence.
import {open,lstat,realpath} from 'node:fs/promises';
import {join,resolve,basename,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const stable=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function readStable(path,signal,max,collect=false){
 const before=await lstat(path);
 if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>max||!same(await realpath(path),path))throw Error('Invalid recovery metadata input.');
 const file=await open(path,'r');
 try{
  if(!stable(before,await file.stat()))throw Error('Recovery input changed.');
  const hash=createHash('sha256'),chunks=[];
  let count=0;
  for await(const chunk of file.createReadStream({autoClose:false})){
   if(signal.aborted)throw Error('Recovery interrupted.');
   count+=chunk.length;
   if(count>max)throw Error('Recovery input too large.');
   hash.update(chunk);if(collect)chunks.push(chunk);
  }
  if(count!==before.size||!stable(before,await file.stat())||!stable(before,await lstat(path))||!same(await realpath(path),path))throw Error('Recovery input changed.');
  return {digest:hash.digest('hex'),raw:collect?Buffer.concat(chunks):undefined};
 }finally{await file.close();}
}
const parse=r=>JSON.parse(r.raw.toString('utf8').replace(/^\uFEFF/,''));
export async function prepareWindowsContinuousRecoveryMetadata(scope,backup,{root,destination,control}={}){
 const database=scope?.owner?.database;
 if(!['hardware_pos','hardware_pos_ars'].includes(database)||typeof scope.assertActive!=='function'||!scope.signal||![root,destination,control].every(p=>typeof p==='string'&&isAbsolute(p))||backup?.database!==database||['applicationRemovalAllowed','databaseDeletionAllowed','continuousExclusionVerified'].some(k=>backup[k]!==false))throw Error('Protected backup evidence required.');
 const check=async()=>{await scope.assertActive();if(scope.signal.aborted||scope.owner.database!==database)throw Error('Recovery interrupted.');};
 await check();
 root=resolve(root);destination=resolve(destination);control=resolve(control);
 for(const p of [root,destination,control]){const st=await lstat(p);if(!st.isDirectory()||st.isSymbolicLink()||!same(await realpath(p),p))throw Error('Invalid recovery directory.');}
 const id=basename(destination),archive=basename(backup.archive);
 if(!/^[a-f0-9]{32}$/.test(id)||backup.uninstallId!==id||!same(dirname(backup.archive),destination)||!new RegExp('^ars-'+database+'-[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-f0-9]{32}-with-uploads\\.dump$').test(archive)||!same(backup.manifestPath,join(destination,'uninstall-table-manifest.json')))throw Error('Recovery archive identity mismatch.');
 const read=(p,max,collect=false)=>readStable(p,scope.signal,max,collect);
 const holdPath=join(control,'maintenance.json'),proofPath=join(control,'maintenance-shutdown.json');
 const h=await read(holdPath,65536,true),p=await read(proofPath,65536,true),m=await read(backup.manifestPath,16777216,true);
 const hold=parse(h),proof=parse(p),manifest=parse(m),holdDigest=h.digest.toUpperCase(),shutdownDigest=p.digest.toUpperCase();
 if([hold,proof].some(r=>r.schema!==1||r.uninstallId!==id||typeof r.project!=='string'||!same(r.project,root)||r.purpose!=='pre-uninstall backup'||['applicationRemovalAllowed','databaseDeletionAllowed','activationApproved'].some(k=>r[k]!==false))||hold.shutdownVerified!==false||proof.shutdownVerified!==true||!Number.isSafeInteger(hold.pid)||hold.pid<1||hold.pid!==proof.pid||hold.startedUtc!==proof.startedUtc||hold.requestedAt!==proof.requestedAt)throw Error('Shutdown evidence mismatch.');
 if(manifest.schema!==1||manifest.kind!=='windows-uninstall-table-manifest'||manifest.uninstallId!==id||manifest.sourceDatabase!==database||manifest.archive!==archive||manifest.holdDigest!==holdDigest||manifest.shutdownDigest!==shutdownDigest||manifest.dumpSha256!==backup.sha256||manifest.locksObserved!==true||manifest.applicationRemovalAllowed!==false||manifest.continuousExclusionVerified!==false)throw Error('Protected manifest mismatch.');
 const zip=archive.slice(0,-5)+'-uploads.zip',archiveDigests={};
 for(const name of [archive,zip]){
  await check();
  const data=await read(join(destination,name),Number.MAX_SAFE_INTEGER);
  const side=await read(join(destination,name+'.sha256'),4096,true);
  const [checksum,...filename]=side.raw.toString('utf8').trim().split(/\s+/);
  if(checksum.toLowerCase()!==data.digest||(filename.length&&filename.join(' ')!==name))throw Error('Recovery archive checksum mismatch.');
  archiveDigests[name]=data.digest;archiveDigests[name+'.sha256']=side.digest;
 }
 if(archiveDigests[archive]!==backup.sha256)throw Error('Protected backup checksum mismatch.');
 archiveDigests['uninstall-table-manifest.json']=m.digest;
 for(const [path,record,max] of [[holdPath,h,65536],[proofPath,p,65536],[backup.manifestPath,m,16777216]])if((await read(path,max)).digest!==record.digest)throw Error('Recovery evidence changed.');
 await check();
 const metadata={schema:1,kind:'windows-final-uninstall-backup',uninstallId:id,previousProject:root,sourceDatabase:database,archive,archiveDigests,holdDigest,shutdownDigest,restoreTestPassed:false,finalUninstallBackupVerified:false,applicationRemovalAllowed:false,databaseDeletionAllowed:false,continuousExclusionVerified:false};
 const target=join(destination,'recovery.json'),raw=Buffer.from(JSON.stringify(metadata)+'\n');
 const file=await open(target,'wx',0o600);
 try{await file.writeFile(raw);await file.sync();}finally{await file.close();}
 if((await read(target,65536)).digest!==createHash('sha256').update(raw).digest('hex'))throw Error('Recovery metadata changed.');
 await check();
 return Object.freeze({destination,database,uninstallId:id,metadataPath:target,applicationRemovalAllowed:false,databaseDeletionAllowed:false,continuousExclusionVerified:false});
}
