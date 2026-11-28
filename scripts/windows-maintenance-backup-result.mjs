// Read-only verification of the native worker's non-authorizing result.
// The coordinator must keep the protected database session active.
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function readStable(folder,name,min,max,consume){
 const path=join(folder,name);
 const before=await lstat(path);
 if(!before.isFile()||before.isSymbolicLink()||before.size<min||before.size>max||!samePath(await realpath(path),path))throw Error('Invalid maintenance result file.');
 const file=await open(path,'r');
 try{
  if(!sameFile(before,await file.stat()))throw Error('Maintenance result file changed.');
  const value=await consume(file,before.size);
  if(!sameFile(before,await file.stat())||!sameFile(before,await lstat(path))||!samePath(await realpath(path),path))throw Error('Maintenance result file changed.');
  return value;
 }finally{await file.close();}
}
export async function verifyWindowsBackupResult(scope,destination,resultName,expectedDatabase='hardware_pos'){
 if(!['hardware_pos','hardware_pos_ars'].includes(expectedDatabase))throw Error('Unsupported backup result database.');
 const archivePattern=new RegExp('^ars-'+expectedDatabase+'-[A-Za-z0-9_-]+\\.dump
 if(typeof scope?.assertActive!=='function'||!scope.signal||typeof destination!=='string'||!isAbsolute(destination)||typeof resultName!=='string'||!/^maintenance-result-[a-f0-9]{32}\.json$/.test(resultName))throw Error('Invalid backup result request.');
 const verify=async()=>{await scope.assertActive();if(scope.signal.aborted)throw Error('Maintenance interrupted.');};
 await verify();
 const folder=resolve(destination),st=await lstat(folder);
 if(!st.isDirectory()||st.isSymbolicLink()||!samePath(await realpath(folder),folder))throw Error('Invalid recovery destination.');
 const raw=await readStable(folder,resultName,1,65536,async(file,size)=>{
  const buf=Buffer.alloc(size);
  let offset=0;
  while(offset<size){const {bytesRead}=await file.read(buf,offset,size-offset,offset);if(!bytesRead)throw Error('Incomplete backup result.');offset+=bytesRead;}
  return buf;
 });
 let record;
 try{record=JSON.parse(raw.toString('utf8'));}catch{throw Error('Invalid backup result JSON.');}
 const fields=['schema','kind','archive','sha256','applicationRemovalAllowed','databaseDeletionAllowed','activationAllowed','continuousExclusionVerified'];
 if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).length!==fields.length||fields.some(k=>!Object.hasOwn(record,k))||record.schema!==1||record.kind!=='windows-maintenance-worker-result'||typeof record.archive!=='string'||!archivePattern.test(record.archive)||typeof record.sha256!=='string'||! /^[a-f0-9]{64}$/.test(record.sha256)||fields.slice(4).some(k=>record[k]!==false))throw Error('Invalid non-authorizing backup result.');
 const digest=await readStable(folder,record.archive,1024,Number.MAX_SAFE_INTEGER,async(file)=>{
  const hash=createHash('sha256');
  for await(const chunk of file.createReadStream({autoClose:false})){
   if(scope.signal.aborted)throw Error('Maintenance interrupted.');
   hash.update(chunk);
  }
  return hash.digest('hex');
 });
 if(digest!==record.sha256)throw Error('Backup archive checksum mismatch.');
 // Re-read the small result to detect replacement during archive hashing.
 const again=await readStable(folder,resultName,1,65536,file=>file.readFile());
 if(!raw.equals(again))throw Error('Backup result changed.');
 await verify();
 return Object.freeze({archive:join(folder,record.archive),sha256:digest,resultDigest:createHash('sha256').update(raw).digest('hex'),applicationRemovalAllowed:false,databaseDeletionAllowed:false,activationAllowed:false,continuousExclusionVerified:false});
}
);
 if(typeof scope?.assertActive!=='function'||!scope.signal||typeof destination!=='string'||!isAbsolute(destination)||typeof resultName!=='string'||!/^maintenance-result-[a-f0-9]{32}\.json$/.test(resultName))throw Error('Invalid backup result request.');
 const verify=async()=>{await scope.assertActive();if(scope.signal.aborted)throw Error('Maintenance interrupted.');};
 await verify();
 const folder=resolve(destination),st=await lstat(folder);
 if(!st.isDirectory()||st.isSymbolicLink()||!samePath(await realpath(folder),folder))throw Error('Invalid recovery destination.');
 const raw=await readStable(folder,resultName,1,65536,async(file,size)=>{
  const buf=Buffer.alloc(size);
  let offset=0;
  while(offset<size){const {bytesRead}=await file.read(buf,offset,size-offset,offset);if(!bytesRead)throw Error('Incomplete backup result.');offset+=bytesRead;}
  return buf;
 });
 let record;
 try{record=JSON.parse(raw.toString('utf8'));}catch{throw Error('Invalid backup result JSON.');}
 const fields=['schema','kind','archive','sha256','applicationRemovalAllowed','databaseDeletionAllowed','activationAllowed','continuousExclusionVerified'];
 if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).length!==fields.length||fields.some(k=>!Object.hasOwn(record,k))||record.schema!==1||record.kind!=='windows-maintenance-worker-result'||typeof record.archive!=='string'||!/^ars-hardware_pos-[A-Za-z0-9_-]+\.dump$/.test(record.archive)||typeof record.sha256!=='string'||! /^[a-f0-9]{64}$/.test(record.sha256)||fields.slice(4).some(k=>record[k]!==false))throw Error('Invalid non-authorizing backup result.');
 const digest=await readStable(folder,record.archive,1024,Number.MAX_SAFE_INTEGER,async(file)=>{
  const hash=createHash('sha256');
  for await(const chunk of file.createReadStream({autoClose:false})){
   if(scope.signal.aborted)throw Error('Maintenance interrupted.');
   hash.update(chunk);
  }
  return hash.digest('hex');
 });
 if(digest!==record.sha256)throw Error('Backup archive checksum mismatch.');
 // Re-read the small result to detect replacement during archive hashing.
 const again=await readStable(folder,resultName,1,65536,file=>file.readFile());
 if(!raw.equals(again))throw Error('Backup result changed.');
 await verify();
 return Object.freeze({archive:join(folder,record.archive),sha256:digest,resultDigest:createHash('sha256').update(raw).digest('hex'),applicationRemovalAllowed:false,databaseDeletionAllowed:false,activationAllowed:false,continuousExclusionVerified:false});
}
