import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandoffAuthorization} from '../scripts/database-handoff-authorization.mjs';
const binding={releaseDigest:'a'.repeat(64),runtimeDigest:'b'.repeat(64),maintenanceDigest:'c'.repeat(64),candidatePid:123,purpose:'candidate'};
test('valid challenge can be consumed only once',()=>{
 const grant=createHandoffAuthorization(binding);
 assert.match(grant.token,/^[a-f0-9]{64}$/);
 assert.equal(grant.consume('0'.repeat(64),binding),false);
 assert.equal(grant.consume(grant.token,binding),true);
 assert.equal(grant.consume(grant.token,binding),false);
 assert.equal(grant.status(),'consumed');
});
test('correct secret with wrong binding cannot be retried',()=>{
 for(const changed of [{candidatePid:124},{purpose:'rollback'},{releaseDigest:'d'.repeat(64)},{runtimeDigest:'d'.repeat(64)},{maintenanceDigest:'d'.repeat(64)}]){
  const grant=createHandoffAuthorization(binding);
  assert.equal(grant.consume(grant.token,{...binding,...changed}),false);
  assert.equal(grant.consume(grant.token,binding),false);
 }
});
test('expiration uses monotonic time and revocation is permanent',()=>{
 let now=0n;
 const grant=createHandoffAuthorization(binding,{ttlMs:10,clock:()=>now});
 now=10000000n;
 assert.equal(grant.consume(grant.token,binding),false);
 assert.equal(grant.status(),'expired');
 const other=createHandoffAuthorization(binding);
 other.revoke();
 assert.equal(other.consume(other.token,binding),false);
 assert.equal(other.status(),'revoked');
 assert.throws(()=>createHandoffAuthorization({...binding,candidatePid:0}));
 assert.throws(()=>createHandoffAuthorization(binding,{ttlMs:60001}));
});
test('candidate and rollback grants use independent secrets',()=>{
 const a=createHandoffAuthorization(binding);
 const b=createHandoffAuthorization({...binding,purpose:'rollback'});
 assert.notEqual(a.token,b.token);
 assert.equal(b.consume(a.token,{...binding,purpose:'rollback'}),false);
});
