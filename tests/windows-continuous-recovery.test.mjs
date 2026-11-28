import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {withProtectedWindowsRecovery} from '../scripts/windows-continuous-recovery.mjs';
class FixtureClient extends EventEmitter {
 constructor(database){super();this.database=database;this.connected=false;this.transaction=false;this.locks=[];this.closed=0;this.events=[];this.tableHeld=false;}
 async connect(){assert.equal(this.connected,false);this.connected=true;this.events.push('connect');}
 async end(){this.closed++;this.connected=false;this.events.push('end');this.emit('end');}
 async query(sql,args){
  assert.equal(this.connected,true);
  if(sql==='SELECT current_database() AS name')return {rows:[{name:this.database}]};
  if(sql.includes('pg_try_advisory_lock')){this.locks.push(args[1]);return {rows:[{acquired:true}]};}
  if(sql.includes('AS database_oid'))return {rows:[{pid:123,started:'fixture',database:this.database,database_oid:'42',locks:this.locks.length}]};
  if(sql==='BEGIN'){this.transaction=true;this.events.push('begin');return {rows:[]};}
  if(sql.startsWith('SET LOCAL'))return {rows:[]};
  if(sql.includes('FROM pg_tables'))return {rows:[{schemaname:'public',tablename:'products'}]};
  if(sql.startsWith('LOCK TABLE')){assert.equal(this.transaction,true);this.tableHeld=true;this.events.push('lock');return {rows:[]};}
  if(sql.includes('AS busy'))return {rows:[{busy:false}]};
  if(sql.includes('AS count FROM pg_locks'))return {rows:[{count:this.tableHeld?1:0}]};
  if(sql==='ROLLBACK'){this.transaction=false;this.tableHeld=false;this.events.push('rollback');return {rows:[]};}
  throw Error('Unexpected fixture query: '+sql);
 }
}
const flags={applicationRemovalAllowed:false,databaseDeletionAllowed:false,serviceRemovalAllowed:false,uninstalled:false,finalUninstallBackupVerified:false,continuousExclusionVerified:false};
function fixture(database='hardware_pos'){
 const client=new FixtureClient(database),controller=new AbortController(),stages=[];
 let original;
 const check=async(scope,name)=>{
  assert.equal(client.transaction,true);assert.equal(client.tableHeld,true);
  assert.deepEqual(client.locks,[2,1,3]);
  if(original)assert.equal(scope,original);else original=scope;
  assert.equal(scope.owner.database,database);assert.ok(Object.isFrozen(scope));
  await scope.assertActive();stages.push(name);
 };
 const callbacks={
  signal:controller.signal,
  backup:async s=>{await check(s,'backup');return 'archive';},
  prepare:async(s,a)=>{await check(s,'prepare');assert.equal(a,'archive');return 'metadata';},
  restore:async(s,m)=>{await check(s,'restore');assert.equal(m,'metadata');return {...flags,database,restoreObservationVerified:true,observationDigest:'a'.repeat(64)};},
  review:async(s,m,r)=>{await check(s,'review');assert.equal(m,'metadata');assert.equal(r.restoreObservationVerified,true);return {...flags,restoreObservationMatched:true};}
 };
 return {client,controller,stages,callbacks,run:()=>withProtectedWindowsRecovery(client,database,callbacks)};
}
for(const database of ['hardware_pos','hardware_pos_ars'])test('all recovery stages retain one protected session: '+database,async()=>{
 const f=fixture(database),result=await f.run();
 assert.deepEqual(f.stages,['backup','prepare','restore','review']);
 assert.deepEqual(f.client.events,['connect','begin','lock','rollback','end']);
 assert.equal(result.sharedProtectionScopeObserved,true);
 for(const key of Object.keys(flags))assert.equal(result[key],false);
 assert.equal(result.activationAllowed,false);
});
test('cancellation after backup prevents metadata and restoration',async()=>{
 const f=fixture(),backup=f.callbacks.backup;
 f.callbacks.backup=async s=>{const a=await backup(s);f.controller.abort();return a;};
 await assert.rejects(f.run(),/Recovery interrupted/);
 assert.deepEqual(f.stages,['backup']);
 assert.deepEqual(f.client.events,['connect','begin','lock','rollback','end']);
});
test('lost table protection prevents restoration',async()=>{
 const f=fixture(),prepare=f.callbacks.prepare;
 f.callbacks.prepare=async(...args)=>{const m=await prepare(...args);f.client.tableHeld=false;return m;};
 await assert.rejects(f.run(),/Maintenance table locks not verified/);
 assert.deepEqual(f.stages,['backup','prepare']);assert.equal(f.client.closed,1);
});
test('invalid restoration observation prevents final review',async()=>{
 const f=fixture(),restore=f.callbacks.restore;
 f.callbacks.restore=async(...args)=>({...await restore(...args),applicationRemovalAllowed:true});
 await assert.rejects(f.run(),/Verified non-authorizing restore evidence required/);
 assert.deepEqual(f.stages,['backup','prepare','restore']);assert.equal(f.client.closed,1);
});
test('unsafe final review never produces a successful result',async()=>{
 const f=fixture(),review=f.callbacks.review;
 f.callbacks.review=async(...args)=>({...await review(...args),databaseDeletionAllowed:true});
 await assert.rejects(f.run(),/Invalid final recovery review/);
 assert.equal(f.client.closed,1);assert.equal(f.client.transaction,false);
});
