// Mint-only explicit incident rehearsal; never restores the operational database.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {open,lstat,realpath} from 'node:fs/promises';
import {verifyIncidentBackup} from './writer-loss-backup.mjs';
import {matchesRestoreReceipt} from './writer-loss-restore-receipt.mjs';
const run=promisify(execFile);
export function receiptFromReport(report,backup){
 if(report?.restoreTestPassed!==true||report.liveRestoreApproved!==false||report.backup!==backup.archive||report.sha256!==backup.archiveSha256)throw Error('Restore report does not match backup.');
 const receipt={schema:1,incidentDigest:backup.incidentDigest,archive:backup.archive,archiveSha256:backup.archiveSha256,isolation:report.isolation,liveVolumeMounted:report.liveVolumeMounted,publishedPort:report.publishedPort,restoreReportedPassed:true,startupAllowed:false,testedAt:report.testedAt,tableCounts:report.counts,uploadArchiveChecked:report.uploadArchiveChecked};
 if(!matchesRestoreReceipt(receipt,backup))throw Error('Restore report incomplete.');
 return receipt;
}
export async function runIncidentRestore(runtimeRoot,confirmation){
 if(process.platform!=='linux'||confirmation!=='RUN ISOLATED INCIDENT RESTORE')throw Error('Explicit Linux restore-test confirmation required.');
 const root=resolve(runtimeRoot);
 const backup=await verifyIncidentBackup(root);
 if(backup.state!=='archive-integrity-matched')throw Error('Verified incident archive required.');
 const folder=join(root,'writer-loss-evidence',backup.incidentDigest);
 if((await realpath(folder))!==folder||!(await lstat(folder)).isDirectory())throw Error('Invalid evidence directory.');
 const destination=join(folder,'isolated-restore-receipt.json');
 try{await lstat(destination);throw Error('Existing receipt must be retained.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const lock=await open(join(folder,'isolated-restore-in-progress.lock'),'wx',0o600);
 // Retain the attempt marker even on failure; no silent retry or evidence deletion.
 try{
  await lock.writeFile(JSON.stringify({schema:1,startedAt:new Date().toISOString(),pid:process.pid}));
  await lock.sync();
  const {stdout}=await run('python3',[fileURLToPath(new URL('./mint/disaster-recovery-test.py',import.meta.url)),join(root,'backups',backup.archive),'--receipt-json'],{timeout:3600000,maxBuffer:4*1024*1024});
  const lines=stdout.split(/\r?\n/).filter(x=>x.startsWith('ARS_RESTORE_REPORT='));
  if(lines.length!==1)throw Error('Restore report unavailable.');
  const receipt=receiptFromReport(JSON.parse(lines[0].slice('ARS_RESTORE_REPORT='.length)),backup);
  const after=await verifyIncidentBackup(root);
  if(!matchesRestoreReceipt(receipt,after))throw Error('Backup evidence changed.');
  const file=await open(destination,'wx',0o600);
  try{await file.writeFile(JSON.stringify(receipt)+'\n');await file.sync();}finally{await file.close();}
  const dir=await open(folder,'r');try{await dir.sync();}finally{await dir.close();}
  return {receiptRecorded:true,restoreTestReportedPassed:true,startupAllowed:false,recoveryAllowed:false};
 }finally{await lock.close();}
}
