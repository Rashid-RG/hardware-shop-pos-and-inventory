// Inspect retained isolated restore evidence. Never executes a restore or starts POS.
import {lstat,open,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {verifyIncidentBackup} from './writer-loss-backup.mjs';
const blocked={startupAllowed:false,recoveryAllowed:false,restoreExecutionVerified:false};
const tables=['products','customers','sales_transactions','sales_transaction_items','purchase_orders','purchase_order_items','supplier_payments','customer_credit_payments'];
async function readReceipt(path){
 const s=await lstat(path);
 if(!s.isFile()||s.size<1||s.size>16384)throw Error('Invalid receipt.');
 const actual=await realpath(path);
 if(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path)throw Error('Linked receipt.');
 const f=await open(path,'r');
 try{
  const a=await f.stat();
  if(a.dev!==s.dev||a.ino!==s.ino||a.size!==s.size)throw Error('Receipt changed.');
  const bytes=Buffer.alloc(s.size+1);
  const {bytesRead}=await f.read(bytes,0,bytes.length,0);
  const b=await f.stat();
  if(bytesRead!==s.size||b.size!==s.size||b.mtimeMs!==s.mtimeMs||b.ctimeMs!==s.ctimeMs)throw Error('Receipt changed.');
  return JSON.parse(bytes.subarray(0,bytesRead).toString('utf8'));
 }finally{await f.close();}
}
export function matchesRestoreReceipt(r,backup){
 return r?.schema===1&&backup?.state==='archive-integrity-matched'&&
 /^[a-f0-9]{64}$/.test(backup.incidentDigest??'')&&/^[a-f0-9]{64}$/.test(backup.archiveSha256??'')&&
 r.incidentDigest===backup.incidentDigest&&r.archive===backup.archive&&r.archiveSha256===backup.archiveSha256&&
 r.isolation==='separate-postgres-instance'&&r.liveVolumeMounted===false&&r.publishedPort===false&&
 r.restoreReportedPassed===true&&r.startupAllowed===false&&
 typeof r.testedAt==='string'&&Number.isFinite(Date.parse(r.testedAt))&&
 r.tableCounts&&tables.every(k=>Object.hasOwn(r.tableCounts,k)&&Number.isSafeInteger(r.tableCounts[k])&&r.tableCounts[k]>=0)&&
 (!backup.uploadsIncluded||r.uploadArchiveChecked===true);
}
export async function inspectIncidentRestoreReceipt(runtimeRoot){
 const root=resolve(runtimeRoot);
 try{
  const backup=await verifyIncidentBackup(root);
  if(backup.state!=='archive-integrity-matched')return {state:'backup-unverified',...blocked};
  const folder=join(root,'writer-loss-evidence',backup.incidentDigest);
  let receipt;
  try{receipt=await readReceipt(join(folder,'isolated-restore-receipt.json'));}
  catch(e){if(e.code==='ENOENT')return {state:'restore-receipt-missing',...blocked};throw e;}
  if(!matchesRestoreReceipt(receipt,backup))throw Error('Receipt mismatch.');
  const after=await verifyIncidentBackup(root);
  if(!matchesRestoreReceipt(receipt,after))throw Error('Backup changed.');
  return {state:'restore-receipt-matched',reportedTestedAt:receipt.testedAt,...blocked};
 }catch{return {state:'restore-receipt-invalid',...blocked};}
}
