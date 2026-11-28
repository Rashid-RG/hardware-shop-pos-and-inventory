import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {EventEmitter} from 'node:events';
const source=readFileSync(new URL('../backend/transactionFence.ts',import.meta.url),'utf8');
const {installTransactionFence}=await import('data:text/javascript;base64,'+Buffer.from(transformSync(source,{loader:'ts',format:'esm'}).code).toString('base64'));
function fixture(){
 const pool=new EventEmitter(), calls=[], released=[];
 const flags={admission:false,check:false,commit:false,rollback:false,wrongCommand:false};
 const client={query:async sql=>{
   calls.push(sql);
   if((sql==='COMMIT'&&flags.commit)||(sql==='ROLLBACK'&&flags.rollback))throw Error('connection failure');
   return {command:sql==='COMMIT'&&flags.wrongCommand?'ROLLBACK':sql};
 },release:err=>released.push(err)};
 pool.connect=callback=>{if(callback){callback(undefined,client);return;}return Promise.resolve(client);};
 installTransactionFence(pool,async()=>{calls.push('check');if(flags.check)throw Error('lost');},async()=>{calls.push('fence');if(flags.admission)throw Error('lost');});
 pool.emit('connect',client);pool.emit('acquire',client);
 return {client,flags,calls,released,pool};
}
test('normal transaction returns clean session',async()=>{
 const {client,calls,released,pool}=fixture();
 await pool.connect();
 await client.query('BEGIN');await client.query('SELECT 1');await client.query('COMMIT');client.release();
 assert.deepEqual(calls,['BEGIN','fence','SELECT 1','check','COMMIT']);
 assert.deepEqual(released,[undefined]);
});
test('failed admission rolls back; nested or unadmitted boundaries rejected',async()=>{
 const {client,flags,calls,released,pool}=fixture();
 await pool.connect();
 flags.admission=true;
 await assert.rejects(client.query('BEGIN'),/lost/);
 assert.deepEqual(calls,['BEGIN','fence','ROLLBACK']);
 await assert.rejects(client.query('COMMIT'),/without admitted/);
 flags.admission=false;await client.query('BEGIN');
 await assert.rejects(client.query('BEGIN'),/Nested/);
 await client.query('ROLLBACK');client.release();
 assert.deepEqual(released,[undefined]);
});
test('unfinished or ambiguous sessions are destroyed',async()=>{
 for(const scenario of ['unfinished','commit','rollback','wrongCommand','check']){
  const {client,flags,released,pool}=fixture();
  await pool.connect();
  await client.query('BEGIN');
  if(scenario==='commit'||scenario==='wrongCommand'||scenario==='check'){flags[scenario]=true;await assert.rejects(client.query('COMMIT'));}
  if(scenario==='rollback'){flags.rollback=true;await assert.rejects(client.query('ROLLBACK'));}
  client.release();assert.deepEqual(released,[true],scenario);
 }
});

test('callback checkout exposes protected release after acquisition',async()=>{
 const {client,pool,released}=fixture();
 await new Promise((resolve,reject)=>pool.connect((err,c,release)=>{
  if(err)return reject(err);
  c.query('BEGIN').then(()=>{release();resolve();},reject);
 }));
 assert.deepEqual(released,[true]);
});

test('repeatable read snapshot is admitted and commits without losing its isolation',async()=>{
 const {client,pool,calls,released}=fixture();
 await pool.connect();
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query('SELECT 1');
 await client.query('COMMIT');
 client.release();
 assert.deepEqual(calls,['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','fence','SELECT 1','check','COMMIT']);
 assert.deepEqual(released,[undefined]);
});
