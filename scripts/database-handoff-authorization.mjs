// Coordinator-local, single-use challenge. Not a live startup bypass.
// The future authenticated local transport must bind the actual peer and verify
// database ownership; caller-supplied identity alone is not authentication.
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const digest=value=>createHash('sha256').update(value,'utf8').digest();
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validBinding=b=>b && hex(b.releaseDigest) && hex(b.runtimeDigest) && hex(b.maintenanceDigest) &&
 Number.isSafeInteger(b.candidatePid)&&b.candidatePid>0 &&
 (b.purpose==='candidate'||b.purpose==='rollback');
const same=(a,b)=>validBinding(b)&&['releaseDigest','runtimeDigest','maintenanceDigest','candidatePid','purpose'].every(k=>a[k]===b[k]);
export function createHandoffAuthorization(binding,{ttlMs=30000,clock=()=>process.hrtime.bigint()}={}){
 if(!validBinding(binding)||!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>60000)throw Error('Invalid handoff authorization binding.');
 const bound=Object.freeze({...binding});
 const secret=randomBytes(32).toString('hex');
 const expected=digest(secret);
 const deadline=clock()+BigInt(ttlMs)*1000000n;
 let state='pending';
 return Object.freeze({
  token:secret,
  consume(token,observed){
   if(state!=='pending')return false;
   if(clock()>=deadline){state='expired';return false;}
   if(!hex(token)||!timingSafeEqual(expected,digest(token)))return false;
   // An authenticated attempt with the wrong binding invalidates the grant.
   state='consumed';
   return same(bound,observed);
  },
  revoke(){if(state==='pending')state='revoked';},
  status(){if(state==='pending'&&clock()>=deadline)state='expired';return state;}
 });
}
