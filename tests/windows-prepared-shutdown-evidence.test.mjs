import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assertPreparedShutdownEvidence} from '../scripts/windows-installed-continuous-recovery.mjs';
async function fixture(t){
 const base=await realpath(await mkdtemp(join(tmpdir(),'ars-shutdown-evidence-')));
 t.after(()=>rm(base,{recursive:true,force:true}));
 const id='a'.repeat(32),runtime=join(base,'runtime'),folder=join(base,id),control=join(base,'control');
 for(const p of [runtime,folder,control])await mkdir(p);
 const controller=new AbortController();
 const record={uninstallId:id,project:runtime,shutdownVerified:false,applicationRemovalAllowed:false,databaseDeletionAllowed:false,activationApproved:false};
 const args={runtime,folder,control,signal:controller.signal};
 const save=async(name,value)=>{const raw=JSON.stringify(value);await writeFile(join(control,name),raw);return createHash('sha256').update(raw).digest('hex').toUpperCase();};
 args.holdDigest=await save('maintenance.json',record);
 args.shutdownDigest=await save('maintenance-shutdown.json',{...record,shutdownVerified:true});
 return {args,record,save,controller,run:()=>assertPreparedShutdownEvidence(args)};
}
test('matching original shutdown evidence accepted repeatedly',async t=>{const f=await fixture(t);await f.run();await f.run();});
test('changed hold and proof rejected against original digest',async t=>{
 for(const name of ['maintenance.json','maintenance-shutdown.json']){
  const f=await fixture(t);await f.run();await f.save(name,{...f.record,changed:true});
  await assert.rejects(f.run(),/Prepared shutdown evidence changed/);
 }
});
test('matching checksum does not override recovery identity or authorization',async t=>{
 for(const change of [{uninstallId:'b'.repeat(32)},{project:'wrong'},{shutdownVerified:true},{applicationRemovalAllowed:true},{databaseDeletionAllowed:true},{activationApproved:true}]){
  const f=await fixture(t);f.args.holdDigest=await f.save('maintenance.json',{...f.record,...change});
  await assert.rejects(f.run(),/Prepared shutdown identity mismatch/);
 }
});
test('missing original digests or cancellation rejected',async t=>{
 const f=await fixture(t);await assert.rejects(assertPreparedShutdownEvidence({...f.args,holdDigest:undefined}),/Invalid shutdown verification request/);
 f.controller.abort();await assert.rejects(f.run(),/Recovery interrupted/);
});
test('missing or oversized evidence rejected',async t=>{
 const f=await fixture(t);await rm(join(f.args.control,'maintenance.json'));await assert.rejects(f.run(),{code:'ENOENT'});
 const g=await fixture(t);await writeFile(join(g.args.control,'maintenance.json'),Buffer.alloc(65537));await assert.rejects(g.run(),/Invalid shutdown evidence/);
});
