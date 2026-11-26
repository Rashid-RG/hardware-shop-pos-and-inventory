// Incident-bound archive integrity inspection only; never restores a database.
import {lstat,realpath,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyWriterLossArtifacts} from './writer-loss-artifacts.mjs';
import {inspectWriterLoss} from './writer-loss-inspection.mjs';
import {verifyBackup} from './verify-backup.mjs';
const blocked={startupAllowed:false,recoveryAllowed:false,restoreTestPassed:false};
async function plain(path,dir=false){
 const s=await lstat(path);
 if(dir?!s.isDirectory():!s.isFile())throw Error('Invalid archive path.');
 const actual=await realpath(path);
 if(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path)throw Error('Linked archive path.');
 return s;
}
async function digest(path,limit=Infinity){
 const before=await plain(path);
 if(before.size<1||before.size>limit)throw Error('Invalid file size.');
 const f=await open(path,'r');
 try{
  const s=await f.stat();
  if(s.dev!==before.dev||s.ino!==before.ino||s.size!==before.size)throw Error('File changed.');
  const hash=createHash('sha256');
  const chunks=[];
  let total=0;
  for await(const chunk of f.createReadStream({autoClose:false})){
   total+=chunk.length;
   if(total>before.size)throw Error('File grew.');
   hash.update(chunk);
   if(limit!==Infinity)chunks.push(chunk);
  }
  const after=await f.stat();
  if(total!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('File changed.');
  return {sha256:hash.digest('hex'),data:limit!==Infinity?Buffer.concat(chunks):undefined};
 }finally{await f.close();}
}
export async function verifyIncidentBackup(runtimeRoot){
 const root=resolve(runtimeRoot);
 try{
  const incident=await inspectWriterLoss(root);
  if(incident.state!=='reconciliation-required'||(await verifyWriterLossArtifacts(root)).state!=='artifact-integrity-matched')return {state:'evidence-unavailable',...blocked};
  const evidence=join(root,'writer-loss-evidence',incident.incidentDigest,'recoverableBackup.json');
  const review=join(root,'.ars-writer-loss-review.json');
  const evidenceFile=await digest(evidence,4*1024*1024);
  const reviewFile=await digest(review,8192);
  const r=JSON.parse(reviewFile.data.toString('utf8'));
  const e=JSON.parse(evidenceFile.data.toString('utf8'));
  if(r.incidentDigest!==incident.incidentDigest||r.evidence?.recoverableBackup!==evidenceFile.sha256||e.incidentDigest!==incident.incidentDigest||e.category!=='recoverableBackup'||e.schema!==1||!/^ars-[A-Za-z0-9_-]+\.dump$/.test(e.archive??'')||! /^[a-f0-9]{64}$/.test(e.archiveSha256??''))throw Error('Invalid backup evidence.');
  const folder=join(root,'backups');
  await plain(folder,true);
  const archive=join(folder,e.archive);
  const base=archive.slice(0,-5);
  const companions=[archive,archive+'.sha256'];
  if(e.archive.includes('-v2-'))companions.push(base+'.manifest.json',base+'.manifest.json.sha256');
  const zip=base+'-uploads.zip';
  let assets=e.archive.endsWith('-with-uploads.dump');
  for(const p of [zip,zip+'.sha256']){
   try{await plain(p);assets=true;}catch(err){if(err.code!=='ENOENT')throw err;}
  }
  if(assets)companions.push(zip,zip+'.sha256');
  for(const p of companions)await plain(p);
  if((await digest(archive)).sha256!==e.archiveSha256)throw Error('Archive fingerprint mismatch.');
  await verifyBackup(archive);
  if((await digest(archive)).sha256!==e.archiveSha256||(await digest(evidence,4*1024*1024)).sha256!==evidenceFile.sha256||(await digest(review,8192)).sha256!==reviewFile.sha256||(await inspectWriterLoss(root)).incidentDigest!==incident.incidentDigest)throw Error('Evidence changed.');
  return {state:'archive-integrity-matched',archive:e.archive,uploadsIncluded:assets,...blocked};
 }catch{return {state:'archive-unverified',...blocked};}
}
