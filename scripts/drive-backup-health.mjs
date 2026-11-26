import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

async function readRecord(path) {
  try {
    const item=await lstat(path);
    if (!item.isFile() || item.size>65536) return {invalid:true};
    return {value:JSON.parse(await readFile(path,'utf8'))};
  } catch (error) {
    return error.code==='ENOENT' ? {absent:true} : {invalid:true};
  }
}
const validDate=value=>typeof value==='string' && Number.isFinite(Date.parse(value));

// Read-only diagnostic: a retained lock does not establish whether its owner is alive.
export async function inspectDriveBackupHealth(directory, now=Date.now()) {
  const status=await readRecord(join(directory,'drive-status.json'));
  const lock=await readRecord(join(directory,'.ars-drive-backup.lock'));
  const value=status.value;
  const verifiedAt=validDate(value?.verifiedAt) ? value.verifiedAt : null;
  const age=verifiedAt ? (now-Date.parse(verifiedAt))/3600000 : null;
  const stale=age===null || age<0 || age>36;
  let health;
  if (!lock.absent) health='running-or-interrupted';
  else if(status.invalid) health='status-unreadable';
  else if(status.absent) health='never-run';
  else if(['local','upload'].includes(value?.phase)) health='interrupted-or-unconfirmed';
  else if(['local-failed','upload-failed','recording-failed'].includes(value?.phase)) health=value.phase;
  else if(value?.phase==='verified' && verifiedAt) health=stale?'verification-overdue':'verified';
  else health='status-unreadable';
  return {schema:1,health,lastVerifiedAt:verifiedAt,verificationOverdue:stale,lockPresent:!lock.absent,requiresReview:health!=='verified',uploadAllowed:false};
}
