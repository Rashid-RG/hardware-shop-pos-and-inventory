// Recovery readiness report, not authorization to clear incident evidence.
import {inspectWriterLoss} from './writer-loss-inspection.mjs';
import {verifyWriterLossArtifacts} from './writer-loss-artifacts.mjs';
import {inspectIncidentRestoreReceipt} from './writer-loss-restore-receipt.mjs';
import {inspectRecoveryDatabase} from './writer-loss-database-inspection.mjs';
const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,continuousExclusionVerified:false};
export function summarizeRecoveryPreflight({incident,artifacts,restore,database}){
 const checks={
  incidentRetained:incident?.state==='reconciliation-required',
  evidenceIntegrityMatched:artifacts?.state==='artifact-integrity-matched',
  restoreReceiptMatched:restore?.state==='restore-receipt-matched',
  databaseIdentityMatched:database?.identityMatched===true,
  noDatabaseActivityObserved:database?.state==='no-activity-observed'&&database.otherSessions===0&&database.preparedTransactions===0&&database.applicationLocks===0
 };
 const blockers=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
 blockers.push('independent-accounting-reconciliation','continuous-writer-exclusion','operator-authorization');
 return {state:Object.values(checks).every(Boolean)?'preflight-matched-review-required':'preflight-blocked',checks,blockers,...blocked};
}
export async function inspectRecoveryPreflight(runtimeRoot,client,expectedIdentity){
 try{
  const incident=await inspectWriterLoss(runtimeRoot);
  const artifacts=await verifyWriterLossArtifacts(runtimeRoot);
  const restore=await inspectIncidentRestoreReceipt(runtimeRoot);
  const database=await inspectRecoveryDatabase(client,expectedIdentity);
  const final=await inspectWriterLoss(runtimeRoot);
  if(incident.state!=='reconciliation-required'||final.state!==incident.state||final.incidentDigest!==incident.incidentDigest)return {state:'incident-unavailable-or-changed',...blocked};
  return summarizeRecoveryPreflight({incident,artifacts,restore,database});
 }catch{return {state:'preflight-unavailable',...blocked};}
}
