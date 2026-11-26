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
 const sections={};
 for(const [key,matched,inspect] of checks){
  try{
   const r=await inspect(client,expected);
   sections[key]=r.startupAllowed===false&&r.recoveryAllowed===false?classifyReconciliation(r.state,matched):'unavailable';
  }catch{sections[key]='unavailable';}
 }
 return {sections,consistentAcrossSections:false,accountingVerified:false,startupAllowed:false,recoveryAllowed:false};
}
