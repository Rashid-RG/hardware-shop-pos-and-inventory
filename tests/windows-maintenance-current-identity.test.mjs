import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseWindowsProcessSid,getWindowsProcessSid,reviewCurrentWindowsMaintenanceInstallation} from '../scripts/windows-maintenance-current-identity.mjs';

test('Windows process SID parser accepts one bounded SID and rejects ambiguous output',()=>{
 for(const value of ['S-1-5-18','S-1-5-21-100-200-300-1001']){
  assert.equal(parseWindowsProcessSid(value+'\r\n'),value);
 }
 for(const value of [null,123,'','username','S-2-5-18','S-1-5','S-1-5-18\nS-1-5-19','SID: S-1-5-18','S-1-5-18 error','S-1-5-'+ '1'.repeat(257)]){
  assert.throws(()=>parseWindowsProcessSid(value),/Invalid Windows user identity response/);
 }
});
test('non-Windows runtime cannot obtain or review Windows process identity',{skip:process.platform==='win32'},async()=>{
 await assert.rejects(getWindowsProcessSid(),/requires Windows/);
 await assert.rejects(reviewCurrentWindowsMaintenanceInstallation(process.cwd()),/state unavailable/);
});
const native=process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted';
test('native current user identity agrees with whoami and binds disposable installation evidence',{skip:!native,timeout:60000},async()=>{
 const whoami=join(process.env.SystemRoot,'System32','whoami.exe');
 const output=execFileSync(whoami,['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:4096});
 const matches=output.match(/S-1-\d+(?:-\d+){1,15}/g);
 assert.equal(matches?.length,1);
 const sid=await getWindowsProcessSid();
 assert.equal(sid,matches[0]);
 const home=await realpath(await mkdtemp(join(tmpdir(),'ars-current-identity-')));
 const previous=process.env.LOCALAPPDATA;
 const sha=b=>createHash('sha256').update(b).digest('hex');
 try{
  process.env.LOCALAPPDATA=join(home,'local');
  const root=join(home,'project');
  const state=join(process.env.LOCALAPPDATA,'RS Nextward','ARS Distributor');
  const name='installer-runtime/maintenance-supervisor.exe';
  await mkdir(join(root,'installer-runtime'),{recursive:true});
  await mkdir(state,{recursive:true});
  const binary=Buffer.alloc(4096);binary.write('MZ');
  await writeFile(join(root,name),binary);
  const manifest=JSON.stringify({[name]:{sha256:sha(binary),mode:420}});
  await writeFile(join(root,'PILOT-FILES.json'),manifest);
  const record={schema:1,kind:'windows-installation-identity-observation',installation:root,desktopSid:sid,packageManifestDigest:sha(manifest),applicationTreeDigest:'a'.repeat(64),entryCount:10,runtimeExcluded:true,installationOwnershipCertified:false,applicationRemovalAllowed:false,serviceRemovalAllowed:false,databaseDeletionAllowed:false};
  const path=join(state,'installation-identity.json');
  await writeFile(path,JSON.stringify(record));
  const result=await reviewCurrentWindowsMaintenanceInstallation(root);
  assert.equal(result.desktopSid,sid);
  assert.equal(result.sha256,sha(binary));
  assert.equal(result.applicationRemovalAllowed,false);
  assert.equal(result.applicationTreeReverified,false);
  await writeFile(path,JSON.stringify({...record,desktopSid:sid==='S-1-5-18'?'S-1-5-19':'S-1-5-18'}));
  await assert.rejects(reviewCurrentWindowsMaintenanceInstallation(root),/identity does not match/);
 }finally{
  if(previous===undefined)delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA=previous;
  await rm(home,{recursive:true,force:true});
 }
});
