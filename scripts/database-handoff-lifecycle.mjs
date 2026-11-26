// Append-only rehearsal journal; no runtime switch, startup, or recovery permission.
import {open,lstat,realpath,readdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const transitions=Object.freeze({
 prepared:['verified','aborted'],
 verified:['switch-rehearsed','aborted'],
 'switch-rehearsed':['candidate-verified','rollback-rehearsed'],
 'candidate-verified':['completed-rehearsal','rollback-rehearsed'],
 'rollback-rehearsed':['completed-rehearsal'],
 aborted:[],
 'completed-rehearsal':[]
});
async function plainRead(p){
 const s=await lstat(p);
 if(!s.isFile()||s.size>8192)throw Error('Invalid journal evidence.');
 return readFile(p,'utf8');
}
async function inspect(path){
 const root=resolve(path);
 const real=await realpath(root);
 if(!(await lstat(root)).isDirectory()||(process.platform==='win32'?real.toLowerCase()!==root.toLowerCase():real!==root))throw Error('Invalid journal directory.');
 const raw=await plainRead(join(root,'handoff-pending.json'));
 const marker=JSON.parse(raw);
 if(marker.schema!==1||marker.phase!=='prepared'||marker.activationAllowed!==false||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(marker.id)||![marker.releaseDigest,marker.runtimeDigest,marker.maintenanceDigest].every(hex))throw Error('Invalid preparation marker.');
 const files=(await readdir(root)).filter(x=>x.toLowerCase().startsWith('handoff-stage-')).sort();
 let phase='prepared',previous=hash(raw),sequence=0;
 for(const name of files){
  sequence++;
  if(name!=='handoff-stage-'+String(sequence).padStart(4,'0')+'.json'||sequence>16)throw Error('Unexpected journal sequence.');
  const text=await plainRead(join(root,name));
  const r=JSON.parse(text);
  if(r.schema!==1||r.id!==marker.id||r.sequence!==sequence||r.previousDigest!==previous||!transitions[phase].includes(r.phase)||!hex(r.evidenceDigest)||r.activationAllowed!==false||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt)))throw Error('Invalid stage evidence.');
  previous=hash(text);phase=r.phase;
 }
 return {root,id:marker.id,phase,sequence,previous};
}
export async function inspectHandoffLifecycle(path){
 try{const r=await inspect(path);return {state:r.phase,id:r.id,sequence:r.sequence,requiresReview:true,activationAllowed:false,recoveryAllowed:false};}
 catch{return {state:'unreadable-or-invalid',requiresReview:true,activationAllowed:false,recoveryAllowed:false};}
}
export async function appendHandoffStage(path,phase,evidenceDigest,confirmation){
 if(confirmation!=='RECORD REHEARSAL STAGE'||!hex(evidenceDigest))throw Error('Explicit rehearsal evidence required.');
 const current=await inspect(path);
 if(!transitions[current.phase].includes(phase))throw Error('Invalid lifecycle transition.');
 const sequence=current.sequence+1;
 const record={schema:1,id:current.id,sequence,phase,previousDigest:current.previous,evidenceDigest,createdAt:new Date().toISOString(),activationAllowed:false};
 const name='handoff-stage-'+String(sequence).padStart(4,'0')+'.json';
 const file=await open(join(current.root,name),'wx',0o600);
 try{await file.writeFile(JSON.stringify(record)+'\n');await file.sync();}finally{await file.close();}
 if(process.platform!=='win32'){const dir=await open(current.root,'r');try{await dir.sync();}finally{await dir.close();}}
 return {recorded:true,phase,sequence,activationAllowed:false};
}

const terminal=phase=>phase==='aborted'||phase==='completed-rehearsal';
async function readClosure(current){
 const raw=await plainRead(join(current.root,'handoff-closure.json'));
 const c=JSON.parse(raw);
 if(c.schema!==1||c.id!==current.id||c.finalPhase!==current.phase||c.sequence!==current.sequence||c.finalDigest!==current.previous||!terminal(current.phase)||c.activationAllowed!==false||c.startupAllowed!==false||c.recoveryAllowed!==false||typeof c.closedAt!=='string'||!Number.isFinite(Date.parse(c.closedAt)))throw Error('Closure evidence differs from journal.');
 return c;
}
export async function recordHandoffClosure(path,confirmation){
 if(confirmation!=='RECORD REHEARSAL CLOSURE')throw Error('Explicit closure confirmation required.');
 const current=await inspect(path);
 if(!terminal(current.phase))throw Error('Lifecycle is not terminal.');
 const receipt={schema:1,id:current.id,finalPhase:current.phase,sequence:current.sequence,finalDigest:current.previous,closedAt:new Date().toISOString(),activationAllowed:false,startupAllowed:false,recoveryAllowed:false};
 const file=await open(join(current.root,'handoff-closure.json'),'wx',0o600);
 try{await file.writeFile(JSON.stringify(receipt)+'\n');await file.sync();}finally{await file.close();}
 if(process.platform!=='win32'){const dir=await open(current.root,'r');try{await dir.sync();}finally{await dir.close();}}
 const verified=await inspect(path);
 await readClosure(verified);
 return {closureRecorded:true,maintenanceRetained:true,activationAllowed:false,startupAllowed:false,recoveryAllowed:false};
}
export async function inspectHandoffClosure(path){
 const blocked={requiresReview:true,activationAllowed:false,startupAllowed:false,recoveryAllowed:false};
 try{
  const current=await inspect(path);
  const entries=await readdir(current.root);
  if(!entries.some(x=>x.toLowerCase()==='handoff-closure.json'))return {state:terminal(current.phase)?'closure-not-recorded':'incomplete',...blocked};
  await readClosure(current);
  return {state:'closure-matched',finalPhase:current.phase,...blocked};
 }catch{return {state:'unreadable-or-invalid',...blocked};}
}
