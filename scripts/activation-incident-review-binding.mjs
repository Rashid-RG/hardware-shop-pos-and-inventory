// Shared evidence binding for future credential-bound activation reviews.
// This module never grants recovery, clears incidents or starts the POS.
import {createHash} from 'node:crypto';
const blocked=['activationAllowed','runtimeActivated','startupAllowed','rollbackAllowed','recoveryAllowed','continuousExclusionVerified'];
const hex=v=>typeof v==='string'&&/^[a-fA-F0-9]{64}$/.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function canonical(v){
 if(v===null||typeof v==='string'||typeof v==='boolean'||Number.isSafeInteger(v))return v;
 if(Array.isArray(v))return v.map(canonical);
 if(v&&Object.getPrototypeOf(v)===Object.prototype)return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
 throw Error('Invalid review value.');
}
export function bindActivationIncidentReview(review){
 const kind=review?.kind;
 if(review?.schema!==1||!['mint-activation-incident-review','windows-activation-incident-review'].includes(kind)||!hex(review.incidentDigest)||review.incidentRetained!==true||review.administratorApprovalRequired!==true||!blocked.every(k=>review[k]===false))throw Error('Non-authorizing incident review required.');
 const s=review.snapshot;
 if(s?.schema!==1||!blocked.slice(0,4).every(k=>s[k]===false)||typeof s.candidateVersion!=='string'||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(s.candidateVersion))throw Error('Invalid activation snapshot.');
 const fields=kind.startsWith('mint')?['hold','binding','configuration','recovery','restore','protectedBackup']:['maintenance','shutdown','binding','runtimePreparation','runtimeConfiguration','recovery','rollback'];
 if(!s.evidence||Object.keys(s.evidence).length!==fields.length||!fields.every(k=>hex(s.evidence[k])))throw Error('Incomplete recovery evidence.');
 if(kind.startsWith('mint')){
  if(!Number.isSafeInteger(s.desktopUid)||s.desktopUid<=0||typeof s.recoveryFolder!=='string'||!s.recoveryFolder.startsWith('/')||s.backupHoldBindingVerified!==true||s.continuousExclusionVerified!==false)throw Error('Invalid Mint snapshot.');
 }else if(typeof s.userSid!=='string'||!/^S-1-\d+(?:-\d+)+$/.test(s.userSid)||typeof s.recoveryId!=='string'||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-[a-f0-9]{32}$/.test(s.recoveryId)||!hex(s.helperHash))throw Error('Invalid Windows snapshot.');
 return Object.freeze({kind,incidentDigest:review.incidentDigest.toLowerCase(),reviewDigest:hash(canonical(review)),snapshotDigest:hash(canonical(s)),activationAllowed:false,recoveryAllowed:false});
}
// A match binds two freshly obtained observations; it does not authenticate their source.
export function assertSameActivationIncidentReview(first,second){
 const a=bindActivationIncidentReview(first),b=bindActivationIncidentReview(second);
 if(a.kind!==b.kind||a.incidentDigest!==b.incidentDigest||a.reviewDigest!==b.reviewDigest||a.snapshotDigest!==b.snapshotDigest)throw Error('Activation incident evidence changed.');
 return a;
}
