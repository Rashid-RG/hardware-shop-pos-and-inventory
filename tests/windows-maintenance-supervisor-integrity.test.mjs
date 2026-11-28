import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {reviewInstalledSupervisor} from '../scripts/windows-maintenance-supervisor-integrity.mjs';

const relative='installer-runtime/maintenance-supervisor.exe';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(work){
 const root=await realpath(await mkdtemp(join(tmpdir(),'ars-supervisor-integrity-')));
 try{
  await mkdir(join(root,'installer-runtime'));
  const executable=join(root,relative),manifestPath=join(root,'PILOT-FILES.json');
  const binary=Buffer.alloc(4096);binary.write('MZ');
  await writeFile(executable,binary);
  const record={sha256:sha(binary),mode:420};
  const manifest=async(value)=>{const raw=JSON.stringify(value);await writeFile(manifestPath,raw);return sha(raw);};
  const digest=await manifest({[relative]:record});
  await work({root,executable,manifestPath,binary,record,manifest,digest});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('installed supervisor review binds binary to previously recorded manifest',()=>fixture(async f=>{
 const result=await reviewInstalledSupervisor(f.root,f.digest.toUpperCase());
 assert.equal(result.executable,f.executable);
 assert.equal(result.sha256,f.record.sha256);
 assert.equal(result.manifestDigest,f.digest);
 assert.equal(result.signatureVerified,false);
 assert.equal(result.applicationRemovalAllowed,false);
 assert.equal(result.databaseDeletionAllowed,false);
 assert.ok(Object.isFrozen(result));
}));
test('installed supervisor review rejects tampered binaries and replaced manifests',()=>fixture(async f=>{
 const modified=Buffer.from(f.binary);modified[200]=42;
 await writeFile(f.executable,modified);
 await assert.rejects(reviewInstalledSupervisor(f.root,f.digest),/integrity mismatch/);
 await f.manifest({[relative]:{sha256:sha(modified),mode:420}});
 await assert.rejects(reviewInstalledSupervisor(f.root,f.digest),/manifest identity mismatch/);
}));
test('installed supervisor review rejects missing, malformed and ambiguous manifest entries',()=>fixture(async f=>{
 for(const value of [{},{[relative.toUpperCase()]:f.record},{[relative]:f.record,[relative.toUpperCase()]:f.record},{[relative]:{sha256:'invalid'}}]){
  const digest=await f.manifest(value);
  await assert.rejects(reviewInstalledSupervisor(f.root,digest),/manifest record required/);
 }
 await assert.rejects(reviewInstalledSupervisor(f.root,'invalid'),/identity required/);
 await assert.rejects(reviewInstalledSupervisor('relative',f.digest),/identity required/);
}));
test('installed supervisor review rejects non-executable and missing payloads',()=>fixture(async f=>{
 const invalid=Buffer.alloc(4096);
 await writeFile(f.executable,invalid);
 const digest=await f.manifest({[relative]:{sha256:sha(invalid),mode:420}});
 await assert.rejects(reviewInstalledSupervisor(f.root,digest),/integrity mismatch/);
 await rm(f.executable);
 await assert.rejects(reviewInstalledSupervisor(f.root,digest),{code:'ENOENT'});
}));
test('installed supervisor review rejects linked executable and runtime directory',{skip:process.platform==='win32'},()=>fixture(async f=>{
 const other=join(f.root,'other.exe');
 await writeFile(other,f.binary);
 await rm(f.executable);
 await symlink(other,f.executable);
 await assert.rejects(reviewInstalledSupervisor(f.root,f.digest),/Invalid installed maintenance file/);
 await rm(join(f.root,'installer-runtime'),{recursive:true});
 await mkdir(join(f.root,'other-runtime'));
 await writeFile(join(f.root,'other-runtime','maintenance-supervisor.exe'),f.binary);
 await symlink(join(f.root,'other-runtime'),join(f.root,'installer-runtime'),'dir');
 await assert.rejects(reviewInstalledSupervisor(f.root,f.digest),/Invalid installed maintenance directory/);
}));
