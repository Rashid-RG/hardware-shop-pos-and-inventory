import {inspectRecoveryBusinessRecords} from './writer-loss-business-reconciliation.mjs';
import {inspectRecoveryFinancialControls} from './writer-loss-financial-reconciliation.mjs';
import {inspectRecoveryStockPayables} from './writer-loss-stock-payables.mjs';
import {inspectRecoveryPartnerPayroll} from './writer-loss-partner-payroll.mjs';
import {inspectRecoveryPartnerControls} from './writer-loss-partner-controls.mjs';
import {inspectRecoveryImportControls} from './writer-loss-import-controls.mjs';

const checks=[
 ['business','structural-checks-matched',inspectRecoveryBusinessRecords],
 ['financial','selected-controls-matched',inspectRecoveryFinancialControls],
 ['stockPayables','estimates-review-required',inspectRecoveryStockPayables],
 ['partnerPayroll','selected-links-matched',inspectRecoveryPartnerPayroll],
 ['partner','selected-partner-balances-matched',inspectRecoveryPartnerControls],
 ['imports','selected-import-balances-matched',inspectRecoveryImportControls]
];
export function classifyReconciliation(state,matched){
 if(state==='no-coverage')return 'no-coverage';
 if(state===matched)return state==='estimates-review-required'?'estimate-review':'selected-checks-match';
 if(typeof state==='string'&&(state.endsWith('unavailable')||state.endsWith('failed')))return 'unavailable';
 return 'review-required';
}
export async function inspectRecoveryReconciliation(client,expected){
 const names=[...checks.map(x=>x[0]),'payroll','inventory'];
 const sections=Object.fromEntries(names.map(key=>[key,'unavailable']));
 const blocked={accountingVerified:false,startupAllowed:false,recoveryAllowed:false};
 let begun=false;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  await client.query("SET LOCAL statement_timeout='10000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'");
  const identity=await client.query("SELECT current_database() AS database,system_identifier::text AS system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('transaction_read_only')='on' AS read_only,current_setting('transaction_isolation')='repeatable read' AS snapshot FROM pg_control_system()");
  const a=identity.rows[0];
  if(identity.rows.length!==1||a.database!==expected?.database||a.system_identifier!==expected?.systemIdentifier||a.database_oid!==expected?.databaseOid||a.read_only!==true||a.snapshot!==true)throw Error('Identity mismatch.');
  let advanced;
  try{advanced=await import('../dist/recovery-advanced-controls.mjs');}catch{}
  const all=[...checks,['payroll','payroll-controls-matched',advanced?.inspectRecoveryPayrollControls],['inventory','recorded-inventory-estimates-match',advanced?.inspectRecoveryInventory]];
  for(const [key,matched,inspect] of all){
   if(typeof inspect!=='function')continue;
   await client.query('SAVEPOINT recovery_section');
   try{
    const r=await inspect(client,expected,true);
    if(r.startupAllowed===false&&r.recoveryAllowed===false){
     sections[key]=classifyReconciliation(r.state,matched);
     if(key==='inventory'&&sections[key]==='selected-checks-match')sections[key]='estimate-review';
    }
   }catch{
    sections[key]='unavailable';
    await client.query('ROLLBACK TO SAVEPOINT recovery_section');
   }
   await client.query('RELEASE SAVEPOINT recovery_section');
  }
  await client.query('ROLLBACK');begun=false;
  return {sections,consistentAcrossSections:true,allSectionsAvailable:Object.values(sections).every(s=>s!=='unavailable'),...blocked};
 }catch{return {sections:Object.fromEntries(names.map(key=>[key,'unavailable'])),consistentAcrossSections:false,allSectionsAvailable:false,...blocked};}
 finally{if(begun)await client.query('ROLLBACK').catch(()=>{});}
}
