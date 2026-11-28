import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,rm,mkdir,symlink,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyWindowsBackupResult} from '../scripts/windows-maintenance-backup-result.mjs';

async function fixture(t){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'ars-backup-result-')));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const name='maintenance-result-'+'a'.repeat(32)+'.json';
 const archive='ars-hardware_pos-fixture.dump';
 const data=Buffer.alloc(4096,42);
 const sha256=createHash('sha256').update(data).digest('hex');
 const record={schema:1,kind:'windows-maintenance-worker-result',archive,sha256,applicationRemovalAllowed:false,databaseDeletionAllowed:false,activationAllowed:false,continuousExclusionVerified:false};
 await writeFile(join(dir,archive),data);
 const save=async(value=record)=>writeFile(join(dir,name),JSON.stringify(value));
 await save();
 const controller=new AbortController();
 let checks=0;
 const scope={signal:controller.signal,assertActive:async()=>{checks++;}};
 const verify=()=>verifyWindowsBackupResult(scope,dir,name);
 return {dir,name,archive,data,sha256,record,save,controller,scope,verify,checks:()=>checks};
}

test('backup result independently hashes archive and retains non-authorizing flags',async t=>{
 const f=await fixture(t);
 const result=await f.verify();
 assert.equal(result.archive,join(f.dir,f.archive));
 assert.equal(result.sha256,f.sha256);
 assert.match(result.resultDigest,/^[a-f0-9]{64}$/);
 assert.equal(f.checks(),2);
 for(const key of ['applicationRemovalAllowed','databaseDeletionAllowed','activationAllowed','continuousExclusionVerified'])assert.equal(result[key],false);
 assert.ok(Object.isFrozen(result));
});
test('backup result rejects malformed and authorizing records, invalid paths and wrong checksum',async t=>{
 const f=await fixture(t);
 for(const patch of [{schema:2},{kind:'other'},{archive:'../outside.dump'},{archive:'C:\\outside.dump'},{sha256:'bad'},{applicationRemovalAllowed:true},{databaseDeletionAllowed:true},{activationAllowed:true},{continuousExclusionVerified:true},{extra:true}]){
  await f.save({...f.record,...patch});
  await assert.rejects(f.verify(),/Invalid non-authorizing/);
 }
 await f.save({...f.record,sha256:'0'.repeat(64)});
 await assert.rejects(f.verify(),/checksum mismatch/);
 await writeFile(join(f.dir,f.name),'{');
 await assert.rejects(f.verify(),/Invalid backup result JSON/);
 await writeFile(join(f.dir,f.name),Buffer.alloc(65537));
 await assert.rejects(f.verify(),/Invalid maintenance result file/);
 await assert.rejects(verifyWindowsBackupResult(f.scope,f.dir,'../result.json'),/Invalid backup result request/);
});
test('backup result rejects corrupt, truncated, missing and non-regular archives',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.dir,f.archive),Buffer.alloc(4096,7));
 await assert.rejects(f.verify(),/checksum mismatch/);
 await writeFile(join(f.dir,f.archive),Buffer.alloc(100));
 await assert.rejects(f.verify(),/Invalid maintenance result file/);
 await unlink(join(f.dir,f.archive));
 await assert.rejects(f.verify(),{code:'ENOENT'});
 await mkdir(join(f.dir,f.archive));
 await assert.rejects(f.verify(),/Invalid maintenance result file/);
});
test('backup result rejects interrupted or lost database protection at both boundaries',async t=>{
 const f=await fixture(t);
 f.controller.abort();
 await assert.rejects(f.verify(),/Maintenance interrupted/);
 const g=await fixture(t);
 let checks=0;
 g.scope.assertActive=async()=>{if(++checks===2)throw Error('Fixture ownership lost.');};
 await assert.rejects(g.verify(),/Fixture ownership lost/);
});
test('backup result rejects symbolic link archive',async t=>{
 const f=await fixture(t);
 const target=join(f.dir,'other.dump');
 await writeFile(target,f.data);
 await unlink(join(f.dir,f.archive));
 try{await symlink(target,join(f.dir,f.archive),'file');}
 catch(e){if(process.platform==='win32'&&['EPERM','EACCES'].includes(e.code)){t.skip('Windows symlink privilege unavailable');return;}throw e;}
 await assert.rejects(f.verify(),/Invalid maintenance result file/);
});

test('archive verifier accepts matching database names and rejects cross-database results',async t=>{
 const f=await fixture(t);
 const legacy=await verifyWindowsBackupResult(f.scope,f.dir,f.name,'hardware_pos');
 assert.equal(legacy.archive,join(f.dir,f.archive));
 await assert.rejects(verifyWindowsBackupResult(f.scope,f.dir,f.name,'hardware_pos_ars'),/Invalid non-authorizing/);
 const pilot='ars-hardware_pos_ars-fixture.dump';
 await writeFile(join(f.dir,pilot),f.data);
 await f.save({...f.record,archive:pilot});
 const result=await verifyWindowsBackupResult(f.scope,f.dir,f.name,'hardware_pos_ars');
 assert.equal(result.archive,join(f.dir,pilot));
 assert.equal(result.sha256,f.sha256);
 await assert.rejects(verifyWindowsBackupResult(f.scope,f.dir,f.name,'hardware_pos'),/Invalid non-authorizing/);
 await assert.rejects(verifyWindowsBackupResult(f.scope,f.dir,f.name,'hardware_pos_ci'),/Unsupported backup result database/);
});
