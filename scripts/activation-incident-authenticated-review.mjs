// Internal composition only: callers must supply a trusted native review adapter.
// No CLI, incident clearance, service startup or authorization.
import {verifyOfflineRecoveryPair} from './writer-loss-offline-auth.mjs';
import {bindActivationIncidentReview,assertSameActivationIncidentReview} from './activation-incident-review-binding.mjs';
import {createHash} from 'node:crypto';
const blocked={activationAllowed:false,runtimeActivated:false,startupAllowed:false,rollbackAllowed:false,recoveryAllowed:false,continuousExclusionVerified:false,independenceVerified:false};
const digest=b=>createHash('sha256').update(b).digest('hex');
export async function observeAuthenticatedActivationReview({client,expected,configurationBytes,bindingBytes,readReview,operator,reviewer,confirmation}){
 if(confirmation!=='REVIEW ACTIVATION INCIDENT'||typeof readReview!=='function'||!Buffer.isBuffer(configurationBytes)||!Buffer.isBuffer(bindingBytes)||configurationBytes.length<1||configurationBytes.length>65536||bindingBytes.length<1||bindingBytes.length>65536)throw Error('Explicit evidence-bound review required.');
 // Copy bytes before asynchronous work and bind to the exact native snapshot.
 const configuration=Buffer.from(configurationBytes),binding=Buffer.from(bindingBytes);
 const saved=JSON.parse(binding.toString('utf8'));
 if(saved.schema!==1||saved.activationAllowed!==false||!['database','systemIdentifier','databaseOid'].every(k=>typeof saved[k]==='string'&&saved[k]===expected?.[k]))throw Error('Database identity evidence mismatch.');
 const {default:dotenv}=await import('dotenv');
 const config=dotenv.parse(configuration);
 const first=await readReview();
 const bound=bindActivationIncidentReview(first);
 const evidence=first.snapshot.evidence;
 const configDigest=evidence.configuration??evidence.runtimeConfiguration;
 if(configDigest.toLowerCase()!==digest(configuration)||evidence.binding.toLowerCase()!==digest(binding))throw Error('Configuration or identity evidence mismatch.');
 const pair=await verifyOfflineRecoveryPair(client,saved,config,operator,reviewer);
 if(pair.state!=='distinct-admin-credentials-verified'||pair.credentialsVerified!==true||pair.distinctAccountsVerified!==true||pair.recoveryAllowed!==false)throw Error('Administrator review denied.');
 assertSameActivationIncidentReview(first,await readReview());
 // Also compare to the original digest in case an adapter reused a mutable object.
 if(bindActivationIncidentReview(first).reviewDigest!==bound.reviewDigest)throw Error('Review changed.');
 return {schema:1,kind:'credential-bound-activation-observation',incidentDigest:bound.incidentDigest,reviewDigest:bound.reviewDigest,snapshotDigest:bound.snapshotDigest,operator:pair.operator,reviewer:pair.reviewer,recordedAt:new Date().toISOString(),observationOnly:true,freshCredentialsRequired:true,distinctAccountsVerified:true,...blocked};
}
