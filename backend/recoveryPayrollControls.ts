import type {Client,Pool} from 'pg';
import {reconcileSalaryPayable} from './salaryPayableReconciliation';
import {reconcileEmployeeAdvances} from './employeeAdvanceReconciliation';
import {reconcileStatutoryControls} from './statutoryControlReconciliation';

const blocked={startupAllowed:false,recoveryAllowed:false,accountingVerified:false,externalDocumentsReconciled:false} as const;
type Identity={database:string;systemIdentifier:string;databaseOid:string};
// Dedicated offline connection only; no application server or writes.
export async function inspectRecoveryPayrollControls(client:Client,expected:Identity){
 let begun=false;
 try{
  if(!['hardware_pos','hardware_pos_ars','hardware_pos_ci'].includes(expected?.database)||!/^[0-9]{1,20}$/.test(expected?.systemIdentifier??'')||!/^[0-9]{1,10}$/.test(expected?.databaseOid??''))throw Error('Trusted identity required.');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  await client.query("SET LOCAL statement_timeout='10000ms'");
  await client.query("SET LOCAL lock_timeout='2000ms'");
  const identity=await client.query("SELECT current_database() AS database,system_identifier::text AS system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,current_setting('transaction_read_only')='on' AS read_only,current_setting('transaction_isolation')='repeatable read' AS snapshot FROM pg_control_system()");
  const a=identity.rows[0];
  if(identity.rows.length!==1||a.database!==expected.database||a.system_identifier!==expected.systemIdentifier||a.database_oid!==expected.databaseOid||a.read_only!==true||a.snapshot!==true)throw Error('Identity mismatch.');
  const shops=(await client.query("SELECT shop_id FROM ars_gl_cutover UNION SELECT shop_id FROM ars_gl_payroll_accruals UNION SELECT shop_id FROM ars_gl_employee_advance_disbursements UNION SELECT shop_id FROM ars_gl_employee_advance_recoveries UNION SELECT shop_id FROM ars_gl_salary_payments UNION SELECT shop_id FROM ars_gl_statutory_settlements UNION SELECT shop_id FROM ars_gl_account_mappings WHERE mapping_kind IN ('salaryPayable','employeeAdvances','epfPayable','etfPayable') ORDER BY shop_id LIMIT 101")).rows;
  if(shops.length>100||shops.some(r=>typeof r.shop_id!=='string'||!r.shop_id.trim()||r.shop_id.length>200))throw Error('Invalid shop coverage.');
  const counts={salary:0,advances:0,epf:0,etf:0};
  const db=client as unknown as Pool;
  for(const {shop_id} of shops){
   const salary=await reconcileSalaryPayable(db,shop_id);
   const advances=await reconcileEmployeeAdvances(db,shop_id);
   const statutory=await reconcileStatutoryControls(db,shop_id);
   if(salary.checksPassed!==true)counts.salary++;
   if(advances.checksPassed!==true)counts.advances++;
   for(const [fund,key] of [['EPF','epf'],['ETF','etf']] as const){
    const rows=statutory.controls.filter((r:{fund:string})=>r.fund===fund);
    if(rows.length!==1||rows[0].controlMatched!==true||rows[0].exceptionCount!==0||statutory.unattributed.length||statutory.exceptions.length)counts[key]++;
   }
  }
  await client.query('ROLLBACK');begun=false;
  return {state:!shops.length?'no-coverage':Object.values(counts).some(Boolean)?'payroll-control-review-required':'payroll-controls-matched',shopsInspected:shops.length,shopsWithExceptions:counts,...blocked};
 }catch{return {state:'payroll-control-inspection-unavailable',...blocked};}
 finally{if(begun)await client.query('ROLLBACK').catch(()=>{});}
}
