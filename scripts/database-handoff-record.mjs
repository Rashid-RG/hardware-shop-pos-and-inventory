// Handoff journal preparation and inspection only. No live switch or restore.
import {open,lstat,realpath,readdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const valid=r=>r?.schema===1&&typeof r.id==='string'&&/^[a-f0-9-]{36}$/.test(r.id)&&
 r.phase==='prepared'&&hex(r.releaseDigest)&&hex(r.runtimeDigest)&&hex(r.maintenanceDigest)&&
 typeof r.createdAt==='string'&&Number.isFinite(Date.parse(r.createdAt))&&r.activationAllowed===false;
async function directory(path){
 const root=resolve(path);
 if(!(await lstat(root)).isDirectory())throw Error('Invalid handoff control directory.');
 const actual=await realpath(root);
 if(process.platform==='win32'?actual.toLowerCase()!==root.toLowerCase():actual!==root)throw Error('Linked handoff control directory.');
 return root;
}
export async function prepareHandoffRecord(path,binding,confirmation){
 if(confirmation!=='PREPARE HANDOFF')throw Error('Explicit preparation confirmation required.');
 const root=await directory(path);
 const record={schema:1,id:randomUUID(),phase:'prepared',releaseDigest:binding?.releaseDigest,runtimeDigest:binding?.runtimeDigest,maintenanceDigest:binding?.maintenanceDigest,createdAt:new Date().toISOString(),activationAllowed:false};
 if(!valid(record))throw Error('Invalid handoff evidence.');
 // Publish the blocking marker first; partial writes also block ordinary startup.
 const file=await open(join(root,'handoff-pending.json'),'wx',0o600);
 try{await file.writeFile(JSON.stringify(record)+'\n');await file.sync();}finally{await file.close();}
 // POSIX directory fsync makes the new entry durable; Windows requires native acceptance.
 if(process.platform!=='win32'){const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}}
 return {prepared:true,id:record.id,activationAllowed:false};
}
export async function inspectHandoffRecord(path){
 const root=await directory(path);
 const name='handoff-pending.json';
 const entries=await readdir(root);
 if(!entries.some(x=>process.platform==='win32'?x.toLowerCase()===name:x===name))return {state:'absent',activationAllowed:false,recoveryAllowed:false};
 try{
  const target=join(root,name);
  const stat=await lstat(target);
  if(!stat.isFile()||stat.size>8192)throw Error('Invalid marker.');
  const record=JSON.parse(await readFile(target,'utf8'));
  if(!valid(record))throw Error('Invalid record.');
  return {state:'prepared',id:record.id,createdAt:record.createdAt,requiresReview:true,activationAllowed:false,recoveryAllowed:false};
 }catch{return {state:'unreadable-or-invalid',requiresReview:true,activationAllowed:false,recoveryAllowed:false};}
}
