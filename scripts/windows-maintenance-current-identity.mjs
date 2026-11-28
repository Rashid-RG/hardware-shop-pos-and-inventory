// Obtain the current Windows process user SID independently of the saved identity.
// No caller-provided executable, script, shell text, or SID override.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {reviewMaintenanceInstallation} from './windows-maintenance-installation-binding.mjs';
const run=promisify(execFile);
export function parseWindowsProcessSid(output){
 if(typeof output!=='string'||output.length>256)throw Error('Invalid Windows user identity response.');
 const sid=output.trim();
 if(!/^S-1-\d+(?:-\d+){1,15}$/.test(sid))throw Error('Invalid Windows user identity response.');
 return sid;
}
export async function getWindowsProcessSid(){
 if(process.platform!=='win32')throw Error('Windows user identity requires Windows.');
 const system=process.env.SystemRoot;
 if(typeof system!=='string'||! /^[A-Za-z]:\\[^\\\r\n]+(?:\\[^\\\r\n]+)*$/.test(system))throw Error('Windows system directory unavailable.');
 const exe=resolve(join(system,'System32','WindowsPowerShell','v1.0','powershell.exe'));
 const st=await lstat(exe);
 if(!st.isFile()||st.isSymbolicLink()||(await realpath(exe)).toLowerCase()!==exe.toLowerCase())throw Error('Invalid Windows identity executable.');
 let result;
 try{
  result=await run(exe,['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; [Console]::WriteLine([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)"],{windowsHide:true,shell:false,timeout:10000,maxBuffer:4096,encoding:'utf8'});
 }catch{throw Error('Windows process user identity unavailable.');}
 if(result.stderr.trim())throw Error('Windows process user identity unavailable.');
 return parseWindowsProcessSid(result.stdout);
}
export async function reviewCurrentWindowsMaintenanceInstallation(root){
 if(process.platform!=='win32'||typeof process.env.LOCALAPPDATA!=='string'||! /^[A-Za-z]:\\/.test(process.env.LOCALAPPDATA))throw Error('Windows installation state unavailable.');
 const state=join(process.env.LOCALAPPDATA,'RS Nextward','ARS Distributor');
 const sid=await getWindowsProcessSid();
 const result=await reviewMaintenanceInstallation(root,state,sid);
 if(await getWindowsProcessSid()!==sid)throw Error('Windows process user identity changed.');
 return result;
}
