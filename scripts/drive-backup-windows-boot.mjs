import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
const exec=promisify(execFile);

// Windows CIM boot time is diagnostic evidence, not authorization to unlock.
export async function windowsBootEvidence() {
  if(process.platform!=='win32') return null;
  try {
    const root=process.env.SystemRoot;
    if(!root || !win32.isAbsolute(root)) return null;
    const command="$ErrorActionPreference='Stop'; $os=Get-CimInstance -ClassName Win32_OperatingSystem; $id=(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid; [ordered]@{bootUtc=$os.LastBootUpTime.ToUniversalTime().ToString('o');machine=$id} | ConvertTo-Json -Compress";
    const {stdout}=await exec(win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,maxBuffer:4096});
    const value=JSON.parse(stdout);
    if(typeof value.machine!=='string'||!value.machine.trim()||typeof value.bootUtc!=='string'||!Number.isFinite(Date.parse(value.bootUtc))) return null;
    return {schema:1,hostDigest:createHash('sha256').update(value.machine.toLowerCase()).digest('hex'),bootUtc:new Date(value.bootUtc).toISOString()};
  } catch {return null;}
}
export function compareWindowsBoot(record,current,startedAt) {
  const valid=x=>x?.schema===1 && typeof x.hostDigest==='string' && /^[a-f0-9]{64}$/.test(x.hostDigest) && typeof x.bootUtc==='string' && Number.isFinite(Date.parse(x.bootUtc));
  if(!valid(record)||!valid(current)||!Number.isFinite(Date.parse(startedAt))) return 'unavailable';
  if(record.hostDigest!==current.hostDigest) return 'different-host';
  const old=Date.parse(record.bootUtc), now=Date.parse(current.bootUtc), start=Date.parse(startedAt);
  if(old>start) return 'inconsistent';
  if(old===now) return 'same-boot';
  if(now>start && now>old) return 'later-boot-observed';
  return 'inconsistent';
}
