import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {reviewMaintenanceInstallation} from '../scripts/windows-maintenance-installation-binding.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const sid='S-1-5-21-100-200-300-1001';
const relative='installer-runtime/maintenance-supervisor.exe';
async function fixture(work){
 const home=await realpath(await mkdtemp(join(tmpdir(),'ars-installation-binding-')));
 try{
  const root=join(home,'project'),state=join(home,'state');
  await mkdir(join(root,'installer-runtime'),{recursive:true});
  await mkdir(state);
  const binary=Buffer.alloc(4096);binary.write('MZ');
  const executable=join(root,relative);
  await writeFile(executable,binary);
  const manifest=JSON.stringify({[relative]:{sha256:sha(binary),mode:420}});
  await writeFile(join(root,'PILOT-FILES.json'),manifest);
  const record={schema:1,kind:'windows-installation-identity-observation',installation:root,desktopSid:sid,packageManifestDigest:sha(manifest).toUpperCase(),applicationTreeDigest:'a'.repeat(64),entryCount:10,runtimeExcluded:true,installationOwnershipCertified:false,applicationRemovalAllowed:false,serviceRemovalAllowed:false,databaseDeletionAllowed:false};
  const path=join(state,'installation-identity.json');
  const save=async(value=record)=>writeFile(path,JSON.stringify(value));
  await save();
  await work({root,state,executable,binary,manifest,record,path,save});
 }finally{await rm(home,{recursive:true,force:true});}
}
test('maintenance installation binds supervisor to installation path, user and manifest without authorizing removal',()=>fixture(async f=>{
 const result=await reviewMaintenanceInstallation(f.root,f.state,sid);
 assert.equal(result.executable,f.executable);
 assert.equal(result.installation,f.root);
 assert.equal(result.desktopSid,sid);
 assert.equal(result.sha256,sha(f.binary));
 assert.equal(result.manifestDigest,sha(f.manifest));
 assert.equal(result.identityDigest,sha(await readFile(f.path)));
 for(const key of ['signatureVerified','installationOwnershipCertified','applicationTreeReverified','applicationRemovalAllowed','serviceRemovalAllowed','databaseDeletionAllowed'])assert.equal(result[key],false);
 assert.ok(Object.isFrozen(result));
}));
test('maintenance installation refuses wrong user, path, overlapping storage and invalid SID',()=>fixture(async f=>{
 await assert.rejects(reviewMaintenanceInstallation(f.root,f.state,'S-1-5-21-100-200-300-1002'),/identity does not match/);
 await assert.rejects(reviewMaintenanceInstallation(f.root,f.state,'invalid'),/desktop identity required/);
 await assert.rejects(reviewMaintenanceInstallation(f.root,join(f.root,'state'),sid),/overlap/);
 await assert.rejects(reviewMaintenanceInstallation(f.root,f.root,sid),/overlap/);
 await f.save({...f.record,installation:f.state});
 await assert.rejects(reviewMaintenanceInstallation(f.root,f.state,sid),/identity does not match/);
}));
test('maintenance installation rejects malformed or authorizing identity records',()=>fixture(async f=>{
 for(const change of [{schema:2},{kind:'other'},{entryCount:0},{entryCount:200001},{entryCount:1.5},{runtimeExcluded:false},{applicationTreeDigest:'invalid'},{packageManifestDigest:'invalid'},{installationOwnershipCertified:true},{applicationRemovalAllowed:true},{serviceRemovalAllowed:true},{databaseDeletionAllowed:true},{unexpected:true}]){
  await f.save({...f.record,...change});
  await assert.rejects(reviewMaintenanceInstallation(f.root,f.state,sid),/identity does not match/);
 }
 const missing={...f.record};delete missing.desktopSid;
 await f.save(missing);
 await assert.rejects(reviewMaintenanceInstallation(f.root,f.state,sid),/identity does not match/);
 await writeFile(f.path,'{');
 await assert.rejects(reviewMaintenanceInstallation(f.root,f.state,sid),SyntaxError);
}));
test('maintenance installation rejects changed binary, manifest and missing identity',()=>fixture(async f=>{
 const changed=Buffer.from(f.binary);changed[100]=1;
 await writeFile(f.executable,changed);
 await assert.rejects(reviewMaintenanceInstallation(f.root,f.state,sid),/integrity mismatch/);
 await writeFile(f.executable,f.binary);
 await writeFile(join(f.root,'PILOT-FILES.json'),f.manifest+' ');
 await assert.rejects(reviewMaintenanceInstallation(f.root,f.state,sid),/manifest identity mismatch/);
 await rm(f.path);
 await assert.rejects(reviewMaintenanceInstallation(f.root,f.state,sid),{code:'ENOENT'});
}));
test('maintenance installation rejects linked identity file',{skip:process.platform==='win32'},()=>fixture(async f=>{
 const other=join(f.state,'other.json');
 await writeFile(other,await readFile(f.path));
 await rm(f.path);
 await symlink(other,f.path);
 await assert.rejects(reviewMaintenanceInstallation(f.root,f.state,sid),/Invalid installation identity file/);
}));
