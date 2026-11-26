import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {rehearseProtectedRecovery} from '../scripts/writer-loss-protected-rehearsal.mjs';
function fixture({database='hardware_pos_ci',failWriter=false,lose=false}={}){
 const c=new EventEmitter();
 c.ended=false;
 c.query=async(sql,params)=>{
  if(sql.includes('backend_start::text'))return {rows:[{database,pid:123,started:'2026-01-01T00:00:00Z'}]};
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:!(failWriter&&params[1]===11)}]};
  if(sql.includes('other_sessions')){if(lose)c.emit('error',Error('lost'));return {rows:[{other_sessions:0}]};}
  return {rows:[{owned:true}]};
 };
 c.end=async()=>{c.ended=true;};
 return c;
}
test('protected rehearsal fails closed and closes dedicated session',async()=>{
 for(const options of [{database:'hardware_pos'},{failWriter:true},{lose:true}]){
  const c=fixture(options);
  await assert.rejects(rehearseProtectedRecovery(c,{gateId:10,writerId:11}));
  assert.equal(c.ended,true);
 }
 const c=fixture();
 const result=await rehearseProtectedRecovery(c,{gateId:10,writerId:11});
 assert.equal(result.recoveryAllowed,false);
 assert.equal(result.continuousExclusionVerified,false);
 assert.equal(c.ended,true);
});
