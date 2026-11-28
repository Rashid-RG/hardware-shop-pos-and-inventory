import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareWindowsContinuousRecoveryMetadata} from '../scripts/windows-continuous-recovery-metadata.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
async function fixture(t,database='hardware_pos'){
 const base=await realpath(await mkdtemp(join(tmpdir(),'ars-metadata-')));
 t.after(()=>rm(base,{recursive:true,force:true}));
 const id='a'.repeat(32),root=join(base,'runtime'),control=join(base,'control'),destination=join(base,id);
 for(const path of [root,control,destination])await mkdir(path);
 const name='ars-'+database+'-20261127-120000-123-'+id+'-with-uploads.dump';
 const archive=join(destination,name),zip=archive.slice(0,-5)+'-uploads.zip',manifestPath=join(destination,'uninstall-table-manifest.json');
 const save=async(path,data)=>{const raw=Buffer.from(JSON.stringify(data));await writeFile(path,raw);return hash(raw);};
 const hold={schema:1,uninstallId:id,project:root,purpose:'pre-uninstall backup',shutdownVerified:false,pid:123,startedUtc:'12345',requestedAt:'fixture',applicationRemovalAllowed:false,databaseDeletionAllowed:false,activationApproved:false};
 const holdDigest=(await save(join(control,'maintenance.json'),hold)).toUpperCase();
 const shutdownDigest=(await save(join(control,'maintenance-shutdown.json'),{...hold,shutdownVerified:true})).toUpperCase();
 const dump=Buffer.alloc(2048,7),uploads=Buffer.from('disposable upload fixture');
 await writeFile(archive,dump);await writeFile(zip,uploads);
 await writeFile(archive+'.sha256',hash(dump)+'  '+name+'\n');
 await writeFile(zip+'.sha256',hash(uploads)+'\n');
 const manifest={schema:1,kind:'windows-uninstall-table-manifest',uninstallId:id,sourceDatabase:database,archive:name,holdDigest,shutdownDigest,dumpSha256:hash(dump),locksObserved:true,applicationRemovalAllowed:false,continuousExclusionVerified:false};
 await save(manifestPath,manifest);
 const backup={database,archive,manifestPath,uninstallId:id,sha256:hash(dump),applicationRemovalAllowed:false,databaseDeletionAllowed:false,continuousExclusionVerified:false};
 const controller=new AbortController(),scope={owner:{database},signal:controller.signal,assertActive:async()=>{}};
 const target=join(destination,'recovery.json');
 return {backup,scope,controller,target,archive,zip,manifestPath,manifest,save,run:()=>prepareWindowsContinuousRecoveryMetadata(scope,backup,{root,destination,control})};
}
for(const database of ['hardware_pos','hardware_pos_ars'])test('metadata records matching protected backup: '+database,async t=>{
 const f=await fixture(t,database),result=await f.run();
 const record=JSON.parse(await readFile(f.target,'utf8'));
 assert.equal(record.sourceDatabase,database);
 assert.equal(record.archiveDigests[record.archive],f.backup.sha256);
 assert.equal(Object.keys(record.archiveDigests).length,5);
 assert.equal(result.database,database);
 assert.ok(Object.isFrozen(result));
 for(const key of ['applicationRemovalAllowed','databaseDeletionAllowed','continuousExclusionVerified','restoreTestPassed','finalUninstallBackupVerified'])assert.equal(record[key],false);
});
test('existing recovery metadata is never overwritten',async t=>{
 const f=await fixture(t);await writeFile(f.target,'preserve existing evidence');
 await assert.rejects(f.run(),{code:'EEXIST'});
 assert.equal(await readFile(f.target,'utf8'),'preserve existing evidence');
});
test('corrupt database archive prevents metadata publication',async t=>{
 const f=await fixture(t);await writeFile(f.archive,'changed');
 await assert.rejects(f.run(),/Recovery archive checksum mismatch/);
 await assert.rejects(lstat(f.target),{code:'ENOENT'});
});
test('corrupt upload archive prevents metadata publication',async t=>{
 const f=await fixture(t);await writeFile(f.zip,'changed');
 await assert.rejects(f.run(),/Recovery archive checksum mismatch/);
 await assert.rejects(lstat(f.target),{code:'ENOENT'});
});
test('manifest database mismatch prevents metadata publication',async t=>{
 const f=await fixture(t);await f.save(f.manifestPath,{...f.manifest,sourceDatabase:'hardware_pos_ars'});
 await assert.rejects(f.run(),/Protected manifest mismatch/);
 await assert.rejects(lstat(f.target),{code:'ENOENT'});
});
test('aborted or lost maintenance scope prevents metadata publication',async t=>{
 const f=await fixture(t);f.controller.abort();
 await assert.rejects(f.run(),/Recovery interrupted/);
 await assert.rejects(lstat(f.target),{code:'ENOENT'});
 const g=await fixture(t);let checks=0;
 g.scope.assertActive=async()=>{if(++checks===2)throw Error('Protection lost.');};
 await assert.rejects(g.run(),/Protection lost/);
 await assert.rejects(lstat(g.target),{code:'ENOENT'});
});
