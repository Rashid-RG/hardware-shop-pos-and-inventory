import { readFile, lstat, open, realpath, mkdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const bootPattern=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function currentLinuxBootId() {
  if(process.platform!=='linux') return null;
  try {
    const id=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();
    return bootPattern.test(id)?id:null;
  } catch {return null;}
}
export function recoveryEligible(record,bootId) {
  return !!(record?.schema===1 && typeof record.bootId==='string' && bootPattern.test(record.bootId) &&
    typeof bootId==='string' && bootPattern.test(bootId) && record.bootId.toLowerCase()!==bootId.toLowerCase() &&
    Number.isSafeInteger(record.pid) && record.pid>0 && typeof record.startedAt==='string' &&
    Number.isFinite(Date.parse(record.startedAt)));
}
async function readLock(file) {
  const item=await lstat(file);
  if(!item.isFile()||item.size>4096) throw new Error('Invalid retained lock.');
  return JSON.parse(await readFile(file,'utf8'));
}
// Only a proven previous Linux boot qualifies. Same-boot PID absence is not proof.
export async function recoverPreviousBootLock(directory,confirmation) {
  if(confirmation!=='RECOVER PREVIOUS BOOT') throw new Error('Explicit recovery confirmation required.');
  const bootId=await currentLinuxBootId();
  if(!bootId) throw new Error('Previous boot verification unavailable.');
  const root=await realpath(directory);
  const guard=join(root,'.ars-drive-recovery.lock');
  const lock=join(root,'.ars-drive-backup.lock');
  const handle=await open(guard,'wx',0o600);
  try {
    const first=await readLock(lock);
    if(!recoveryEligible(first,bootId)) throw new Error('Lock cannot be proven to belong to a previous boot.');
    const evidence=join(root,'.ars-drive-recovered-'+randomUUID());
    await mkdir(evidence,{mode:0o700});
    const second=await readLock(lock);
    if(JSON.stringify(first)!==JSON.stringify(second)) throw new Error('Retained lock changed.');
    // Atomic move retains original bytes; destination is private and newly created.
    await rename(lock,join(evidence,'previous-boot.lock'));
    return {schema:1,lockRecovered:true,evidenceRetained:true,retryStarted:false,uploadStarted:false};
  } finally {
    await handle.close();
    await unlink(guard);
  }
}
