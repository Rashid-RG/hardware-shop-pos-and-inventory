import test from 'node:test';
import assert from 'node:assert/strict';
import {captureGateOwner,assertGateOwner,assertMaintenanceOwner} from '../scripts/database-handoff-gate.mjs';
test('coordinator proof binds backend identity and actual exclusive lock',async()=>{
 const calls=[];
 const owner={pid:123,started:'2026-01-01 00:00:00.123456+00'};
 const client={query:async(sql,args)=>{calls.push({sql,args});return {rows:[args?{owned:true}:owner]};}};
 assert.deepEqual(await captureGateOwner(client),owner);
 assert.deepEqual(calls[1].args,[1642958133,2,owner.pid,owner.started]);
 for(const token of ["objsubid=2","ExclusiveLock","l.granted","current_database()","backend_start"])assert.ok(calls[1].sql.includes(token));
 await assert.rejects(assertGateOwner({query:async()=>({rows:[{owned:false}]})},owner),/ownership not verified/);
 await assert.rejects(assertGateOwner(client,{pid:0,started:owner.started}),/Invalid coordinator/);
});

test('maintenance ownership requires all three locks and the original session and database',async()=>{
 const row={pid:123,started:'2026-01-01 00:00:00.123456+00',database:'fixture',database_oid:'12345',locks:3};
 const client={query:async(sql,args)=>{
  assert.deepEqual(args,[1642958133]);
  for(const token of ['pg_backend_pid()','backend_start','current_database()','objid IN (1,2,3)','ExclusiveLock','granted','objsubid=2'])assert.ok(sql.includes(token));
  return {rows:[row]};
 }};
 const owner=await assertMaintenanceOwner(client);
 assert.deepEqual(owner,{pid:123,started:row.started,database:'fixture',databaseOid:'12345'});
 assert.ok(Object.isFrozen(owner));
 await assertMaintenanceOwner(client,owner);
 for(const [key,value] of [['pid',124],['started','different'],['database','other'],['database_oid','12346']]){
  await assert.rejects(assertMaintenanceOwner({query:async()=>({rows:[{...row,[key]:value}]})},owner),/identity changed/);
 }
 for(const locks of [0,1,2,4,null,'3']){
  await assert.rejects(assertMaintenanceOwner({query:async()=>({rows:[{...row,locks}]})},owner),/ownership not verified/);
 }
 for(const rows of [[],[row,row],[{...row,pid:0}],[{...row,database_oid:'invalid'}]]){
  await assert.rejects(assertMaintenanceOwner({query:async()=>({rows})},owner),/ownership not verified/);
 }
 await assert.rejects(assertMaintenanceOwner({query:async()=>{throw Error('connection lost');}},owner),/connection lost/);
});

import {EventEmitter} from 'node:events';
import {withMaintenanceSession} from '../scripts/database-maintenance-session.mjs';
class FixtureClient extends EventEmitter {
 constructor(){super();this.calls=[];this.database='hardware_pos_ci';this.denied=0;this.locks=3;this.pid=123;this.closed=0;}
 async connect(){this.calls.push('connect');}
 async end(){this.closed++;this.calls.push('end');this.emit('end');}
 async query(sql,args){
  if(sql==='SELECT current_database() AS name')return {rows:[{name:this.database}]};
  if(sql.includes('pg_try_advisory_lock')){
   this.calls.push(args[1]);return {rows:[{acquired:args[1]!==this.denied}]};
  }
  this.calls.push('verify');
  return {rows:[{pid:this.pid,started:'2026-01-01 00:00:00.123456+00',database:this.database,database_oid:'12345',locks:this.locks}]};
 }
}
test('dedicated maintenance session retains lock order and invalidates capability on cleanup',async()=>{
 const client=new FixtureClient();let capability;
 const value=await withMaintenanceSession(client,'hardware_pos_ci',async session=>{
  capability=session;
  assert.equal(session.signal.aborted,false);
  assert.equal(client.closed,0);
  await session.assertActive();
  return 'fixture complete';
 });
 assert.equal(value,'fixture complete');
 assert.deepEqual(client.calls.slice(0,4),['connect',2,1,3]);
 assert.equal(client.closed,1);
 assert.equal(capability.signal.aborted,true);
 await assert.rejects(capability.assertActive(),/unavailable/);
 assert.equal(client.listenerCount('error'),0);
 assert.equal(client.listenerCount('end'),0);
});
test('failed lock acquisition and unexpected database never start maintenance work',async()=>{
 for(const denied of [1,2,3]){
  const client=new FixtureClient();client.denied=denied;
  await assert.rejects(withMaintenanceSession(client,'hardware_pos_ci',async()=>assert.fail('work started')));
  assert.equal(client.closed,1);
 }
 const client=new FixtureClient();client.database='other';
 await assert.rejects(withMaintenanceSession(client,'hardware_pos_ci',async()=>assert.fail('work started')),/Unexpected maintenance database/);
 assert.deepEqual(client.calls,['connect','end']);
 const pooled=new FixtureClient();pooled.release=()=>{};
 await assert.rejects(withMaintenanceSession(pooled,'hardware_pos_ci',async()=>{}),/Dedicated managed/);
 assert.deepEqual(pooled.calls,[]);
});
test('connection loss, owner changes and stage failures prevent successful completion',async()=>{
 for(const mode of ['error','end','owner','lock','stage']){
  const client=new FixtureClient();let capability;
  await assert.rejects(withMaintenanceSession(client,'hardware_pos_ci',async session=>{
   capability=session;
   if(mode==='error')client.emit('error',Error('fixture loss'));
   if(mode==='end')client.emit('end');
   if(mode==='owner')client.pid++;
   if(mode==='lock')client.locks=2;
   if(mode==='stage')throw Error('fixture stage failure');
   if(['error','end'].includes(mode))assert.equal(session.signal.aborted,true);
   return 'must not complete';
  }));
  assert.equal(client.closed,1);
  assert.equal(capability.signal.aborted,true);
 }
});

import {runMaintenanceChild} from '../scripts/database-maintenance-child.mjs';
import {getEventListeners} from 'node:events';
function childFixture(){
 const controller=new AbortController();
 const checks=[];
 const session={signal:controller.signal,assertActive:async()=>{checks.push('check');if(controller.signal.aborted)throw Error('Fixture ownership lost.');}};
 const run=(source,options={})=>runMaintenanceChild(session,process.execPath,['-e',source],{cwd:process.cwd(),...options});
 return {controller,checks,session,run};
}
test('maintenance child checks ownership at both boundaries and returns bounded stdout',async()=>{
 const f=childFixture();
 assert.equal(await f.run("process.stdout.write('fixture');process.stderr.write('private diagnostic')"),'fixture');
 assert.deepEqual(f.checks,['check','check']);
 assert.equal(getEventListeners(f.controller.signal,'abort').length,0);
});
test('maintenance child rejects exit failures, output excess and timeout',async()=>{
 for(const [source,options,pattern] of [
  ['process.exit(7)',{},/did not complete/],
  ["process.stdout.write('x'.repeat(4096))",{maxOutput:128},/output limit/],
  ["process.stderr.write('x'.repeat(4096))",{maxOutput:128},/output limit/],
  ['setInterval(()=>{},1000)',{timeoutMs:100},/timed out/]
 ]){
  const f=childFixture();
  await assert.rejects(f.run(source,options),pattern);
  assert.equal(getEventListeners(f.controller.signal,'abort').length,0);
  assert.equal(f.checks.length,1);
 }
});
test('maintenance child refuses pre-aborted sessions and terminates on interruption',async()=>{
 const before=childFixture();
 before.controller.abort();
 await assert.rejects(before.run("process.stdout.write('must not run')"),/ownership lost/);
 const active=childFixture();
 const pending=active.run('setInterval(()=>{},1000)',{timeoutMs:10000});
 const timer=setTimeout(()=>active.controller.abort(),100);
 try{await assert.rejects(pending,/interrupted/);}finally{clearTimeout(timer);}
 assert.equal(getEventListeners(active.controller.signal,'abort').length,0);
 assert.equal(active.checks.length,1);
});
test('successful child exit cannot bypass final ownership verification',async()=>{
 const f=childFixture();
 let calls=0;
 f.session.assertActive=async()=>{if(++calls===2)throw Error('Final ownership lost.');};
 await assert.rejects(f.run("process.stdout.write('fixture')"),/Final ownership lost/);
 assert.equal(calls,2);
 assert.equal(getEventListeners(f.controller.signal,'abort').length,0);
});

import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
test('Linux maintenance rejects successful parent exit with surviving same-group child',{skip:process.platform!=='linux'},async()=>{
 const f=childFixture();
 const dir=await mkdtemp(join(tmpdir(),'ars-maintenance-group-'));
 const pidFile=join(dir,'pid');
 let pid;
 try{
  const source="const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync("+JSON.stringify(pidFile)+",String(child.pid));child.unref();";
  await assert.rejects(f.run(source,{timeoutMs:10000}),/process group remained active/);
  pid=Number(await readFile(pidFile,'utf8'));
  assert.ok(Number.isSafeInteger(pid)&&pid>1);
  // A terminated orphan may briefly remain as a zombie until reaped.
  let stopped=false;
  for(let i=0;i<100;i++){
   try{const stat=await readFile('/proc/'+pid+'/stat','utf8');if(stat.slice(stat.lastIndexOf(')')+2).startsWith('Z')){stopped=true;break;}}
   catch(error){if(error.code==='ENOENT'){stopped=true;break;}throw error;}
   await delay(25);
  }
  assert.ok(stopped,'same-group descendant remained running');
  assert.equal(f.checks.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Linux maintenance interruption signals an inherited process group',{skip:process.platform!=='linux'},async()=>{
 const f=childFixture();
 const dir=await mkdtemp(join(tmpdir(),'ars-maintenance-abort-'));
 const ready=join(dir,'ready');
 let pending;
 try{
  const childSource="require('node:fs').writeFileSync("+JSON.stringify(ready)+",String(process.pid));setInterval(()=>{},1000);";
  const source="require('node:child_process').spawn(process.execPath,['-e',"+JSON.stringify(childSource)+"],{stdio:'inherit'});setInterval(()=>{},1000);";
  pending=f.run(source,{timeoutMs:15000});
  // Observe rejection immediately even if fixture startup fails.
  const rejected=assert.rejects(pending,/interrupted/);
  rejected.catch(()=>{});
  let pid;
  for(let i=0;i<200;i++){
   try{pid=Number(await readFile(ready,'utf8'));if(Number.isSafeInteger(pid)&&pid>1)break;}catch(error){if(error.code!=='ENOENT')throw error;}
   await delay(25);
  }
  assert.ok(Number.isSafeInteger(pid)&&pid>1,'descendant did not start');
  f.controller.abort();
  await rejected;
  let stopped=false;
  for(let i=0;i<100;i++){
   try{const stat=await readFile('/proc/'+pid+'/stat','utf8');if(stat.slice(stat.lastIndexOf(')')+2).startsWith('Z')){stopped=true;break;}}
   catch(error){if(error.code==='ENOENT'){stopped=true;break;}throw error;}
   await delay(25);
  }
  assert.ok(stopped,'descendant remained running after interruption');
  assert.equal(getEventListeners(f.controller.signal,'abort').length,0);
 }finally{f.controller.abort();if(pending)await pending.catch(()=>{});await rm(dir,{recursive:true,force:true});}
});
