import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyWindowsRestoreEvidence} from '../scripts/windows-maintenance-restore-result.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
const flags={applicationRemovalAllowed:false,databaseDeletionAllowed:false,serviceRemovalAllowed:false,uninstalled:false,finalUninstallBackupVerified:false,continuousExclusionVerified:false};
async function fixture(t,database='hardware_pos'){
 const root=await realpath(await mkdtemp(join(tmpdir(),'ars-restore-evidence-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const id='a'.repeat(32),destination=join(root,id),control=join(root,'control');
 await mkdir(destination);await mkdir(control);
 const archive='ars-'+database+'-20261127-120000-123-'+id+'-with-uploads.dump';
 const zip=archive.slice(0,-5)+'-uploads.zip';
 const save=async(path,data)=>{const raw=Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(data));await writeFile(path,raw);return hash(raw);};
 const common={schema:1,uninstallId:id};
 const hold={...common,purpose:'pre-uninstall backup',shutdownVerified:false,applicationRemovalAllowed:false,databaseDeletionAllowed:false,activationApproved:false};
 const proof={...hold,shutdownVerified:true};
 const holdDigest=(await save(join(control,'maintenance.json'),hold)).toUpperCase();
 const shutdownDigest=(await save(join(control,'maintenance-shutdown.json'),proof)).toUpperCase();
 const archiveDigests={};
 for(const name of [archive,archive+'.sha256',zip,zip+'.sha256'])archiveDigests[name]=await save(join(destination,name),Buffer.from('disposable fixture '+name));
 const tables=Object.fromEntries(['products','customers','sales_transactions','sales_transaction_items','customer_credit_payments'].map(k=>[k,{rows:1,sha256:'a'.repeat(64)}]));
 const manifest={...common,kind:'windows-uninstall-table-manifest',sourceDatabase:database,archive,holdDigest,shutdownDigest,dumpSha256:archiveDigests[archive],tables,locksObserved:true,applicationRemovalAllowed:false,continuousExclusionVerified:false};
 archiveDigests['uninstall-table-manifest.json']=await save(join(destination,'uninstall-table-manifest.json'),manifest);
 const meta={...common,kind:'windows-final-uninstall-backup',sourceDatabase:database,archive,holdDigest,shutdownDigest,archiveDigests,restoreTestPassed:false,finalUninstallBackupVerified:false,applicationRemovalAllowed:false,databaseDeletionAllowed:false,continuousExclusionVerified:false};
 const metaDigest=(await save(join(destination,'recovery.json'),meta)).toUpperCase();
 const observation={...common,kind:'windows-uninstall-restore-observation',archiveSha256:archiveDigests[archive],isolatedRestorePassed:true,allPublicTableFingerprintsMatched:true,uploadArchiveReadable:true,restoredTableCount:5,uploadMemberCount:0,evidenceDigests:{hold:holdDigest,proof:shutdownDigest,meta:metaDigest},archiveMemberDigests:archiveDigests,...flags};
 const saveObservation=patch=>save(join(destination,'uninstall-restore-test.json'),{...observation,...patch});
 await saveObservation({});
 const controller=new AbortController();
 const scope={owner:{database},signal:controller.signal,assertActive:async()=>{}};
 return {destination,control,archive,zip,scope,controller,saveObservation,verify:()=>verifyWindowsRestoreEvidence(scope,{destination,control})};
}
for(const database of ['hardware_pos','hardware_pos_ars'])test('restore evidence accepts matching '+database+' fixture without granting removal',async t=>{
 const f=await fixture(t,database);
 const result=await f.verify();
 assert.equal(result.database,database);
 assert.equal(result.restoreObservationVerified,true);
 assert.match(result.observationDigest,/^[a-f0-9]{64}$/);
 for(const key of ['applicationRemovalAllowed','databaseDeletionAllowed','activationAllowed','continuousExclusionVerified'])assert.equal(result[key],false);
 assert.ok(Object.isFrozen(result));
});
test('restore evidence rejects changed database identity and unsupported scope',async t=>{
 const f=await fixture(t);
 f.scope.owner.database='hardware_pos_ars';
 await assert.rejects(f.verify(),/Restore archive identity mismatch/);
 f.scope.owner.database='hardware_pos_ci';
 await assert.rejects(f.verify(),/Invalid restoration verification scope/);
});
test('restore evidence rejects unsafe or incomplete observations',async t=>{
 const f=await fixture(t);
 for(const patch of [{applicationRemovalAllowed:true},{continuousExclusionVerified:true},{isolatedRestorePassed:false},{restoredTableCount:4},{uploadMemberCount:-1}]){
  await f.saveObservation(patch);
  await assert.rejects(f.verify(),/Invalid non-authorizing restoration observation/);
 }
 await f.saveObservation({restoredTableCount:6});
 await assert.rejects(f.verify(),/Restored table evidence mismatch/);
 await f.saveObservation({archiveMemberDigests:{}});
 await assert.rejects(f.verify(),/Incomplete restoration archive evidence/);
});
test('restore evidence rejects modified database or upload archives and missing files',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.destination,f.zip),'changed');
 await assert.rejects(f.verify(),/Restoration archive evidence mismatch/);
 await writeFile(join(f.destination,f.archive),'changed');
 await assert.rejects(f.verify(),/Restoration archive evidence mismatch/);
 await unlink(join(f.control,'maintenance.json'));
 await assert.rejects(f.verify(),{code:'ENOENT'});
});
test('restore evidence rejects aborted and lost maintenance scope',async t=>{
 const f=await fixture(t);
 f.controller.abort();
 await assert.rejects(f.verify(),/Restoration interrupted/);
 const g=await fixture(t);
 let checks=0;
 g.scope.assertActive=async()=>{if(++checks===2)throw Error('Fixture protection lost.');};
 await assert.rejects(g.verify(),/Fixture protection lost/);
});
