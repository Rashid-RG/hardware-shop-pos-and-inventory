// Internal observation of installation identity; not authorization to remove files.
// The trusted caller must establish the current Windows SID independently.
import {lstat,realpath,open} from 'node:fs/promises';
import {resolve,join,isAbsolute,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {reviewInstalledSupervisor} from './windows-maintenance-supervisor-integrity.mjs';
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const nested=(a,b)=>{const r=relative(a,b);return !r||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep));};
const stable=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function readIdentity(path){
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||st.size<2||st.size>65536||!same(await realpath(path),path))throw Error('Invalid installation identity file.');
 const file=await open(path,'r');
 try{
  if(!stable(st,await file.stat()))throw Error('Installation identity changed.');
  const raw=await file.readFile();
  if(raw.length!==st.size||!stable(st,await file.stat())||!stable(st,await lstat(path))||!same(await realpath(path),path))throw Error('Installation identity changed.');
  return raw;
 }finally{await file.close();}
}
export async function reviewMaintenanceInstallation(root,state,currentSid){
 if(typeof root!=='string'||typeof state!=='string'||!isAbsolute(root)||!isAbsolute(state)||typeof currentSid!=='string'||!/^S-1-\d+(?:-\d+){1,15}$/.test(currentSid))throw Error('Recorded installation and desktop identity required.');
 const project=resolve(root),storage=resolve(state);
 if(nested(project,storage)||nested(storage,project))throw Error('Installation and state overlap.');
 for(const folder of [project,storage]){
  const st=await lstat(folder);
  if(!st.isDirectory()||st.isSymbolicLink()||!same(await realpath(folder),folder))throw Error('Invalid installation identity directory.');
 }
 const path=join(storage,'installation-identity.json');
 const raw=await readIdentity(path);
 const record=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));
 const fields=['schema','kind','installation','desktopSid','packageManifestDigest','applicationTreeDigest','entryCount','runtimeExcluded','installationOwnershipCertified','applicationRemovalAllowed','serviceRemovalAllowed','databaseDeletionAllowed'];
 if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).length!==fields.length||fields.some(k=>!Object.hasOwn(record,k))||record.schema!==1||record.kind!=='windows-installation-identity-observation'||typeof record.installation!=='string'||!same(record.installation,project)||record.desktopSid!==currentSid||! /^[a-fA-F0-9]{64}$/.test(record.packageManifestDigest||'')||! /^[a-f0-9]{64}$/.test(record.applicationTreeDigest||'')||!Number.isSafeInteger(record.entryCount)||record.entryCount<1||record.entryCount>200000||record.runtimeExcluded!==true||fields.slice(8).some(k=>record[k]!==false))throw Error('Installation identity does not match maintenance runtime.');
 const supervisor=await reviewInstalledSupervisor(project,record.packageManifestDigest);
 if(!raw.equals(await readIdentity(path)))throw Error('Installation identity changed.');
 return Object.freeze({...supervisor,installation:project,desktopSid:currentSid,identityDigest:createHash('sha256').update(raw).digest('hex'),installationOwnershipCertified:false,applicationTreeReverified:false,serviceRemovalAllowed:false});
}
