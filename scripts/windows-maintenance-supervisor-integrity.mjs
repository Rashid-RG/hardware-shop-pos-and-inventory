// Internal installed binary review. A local manifest is not a digital signature.
// Never executes the binary or authorizes destructive maintenance.
import {lstat,realpath,open} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
const relative='installer-runtime/maintenance-supervisor.exe';
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const unchanged=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function readStable(path,min,max){
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||st.size<min||st.size>max||!same(await realpath(path),path))throw Error('Invalid installed maintenance file.');
 const handle=await open(path,'r');
 try{
  if(!unchanged(st,await handle.stat()))throw Error('Installed maintenance file changed.');
  const data=await handle.readFile();
  if(data.length!==st.size||!unchanged(st,await handle.stat())||!unchanged(st,await lstat(path))||!same(await realpath(path),path))throw Error('Installed maintenance file changed.');
  return data;
 }finally{await handle.close();}
}
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function reviewInstalledSupervisor(root,expectedManifestDigest){
 if(typeof root!=='string'||!isAbsolute(root)||! /^[a-fA-F0-9]{64}$/.test(expectedManifestDigest||''))throw Error('Recorded installation manifest identity required.');
 const folder=resolve(root);
 for(const path of [folder,join(folder,'installer-runtime')]){
  const st=await lstat(path);
  if(!st.isDirectory()||st.isSymbolicLink()||!same(await realpath(path),path))throw Error('Invalid installed maintenance directory.');
 }
 const manifestPath=join(folder,'PILOT-FILES.json');
 const raw=await readStable(manifestPath,2,16777216);
 const digest=sha(raw);
 if(digest!==expectedManifestDigest.toLowerCase())throw Error('Installation manifest identity mismatch.');
 const manifest=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||Object.keys(manifest).filter(k=>k.toLowerCase()===relative).length!==1||!Object.hasOwn(manifest,relative)||! /^[a-f0-9]{64}$/.test(manifest[relative]?.sha256||''))throw Error('Installed supervisor manifest record required.');
 const executable=join(folder,relative);
 const binary=await readStable(executable,1024,16777216);
 if(binary[0]!==77||binary[1]!==90||sha(binary)!==manifest[relative].sha256)throw Error('Installed supervisor integrity mismatch.');
 if(!raw.equals(await readStable(manifestPath,2,16777216)))throw Error('Installation manifest changed.');
 return Object.freeze({executable,sha256:sha(binary),manifestDigest:digest,signatureVerified:false,applicationRemovalAllowed:false,databaseDeletionAllowed:false});
}
