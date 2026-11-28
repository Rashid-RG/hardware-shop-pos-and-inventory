import type {Pool} from 'pg';
import {reconcileSalaryPayable} from './salaryPayableReconciliation';
import {reconcileEmployeeAdvances} from './employeeAdvanceReconciliation';
import {reconcileStatutoryControls} from './statutoryControlReconciliation';

/** Consolidated read-only view: all controls from the same database snapshot.
 * Do not net receivable assets against payable liabilities or enable posting here. */
export async function payrollAccountingOverview(db:Pool,shopId:string){
 if(typeof shopId!=='string'||!shopId.trim()||shopId.length>200)throw Error('Valid payroll shop required.');
 const c=await db.connect();
 try{
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const salary=await reconcileSalaryPayable(c as unknown as Pool,shopId);
 const advances=await reconcileEmployeeAdvances(c as unknown as Pool,shopId);
 const statutory=await reconcileStatutoryControls(c as unknown as Pool,shopId);
 const advanceExceptions=advances.advances.filter((a:{issues:string[]})=>a.issues.length).length+advances.recoveries.filter((a:{issues:string[]})=>a.issues.length).length;
 const controls=[
 {id:'salary',label:'Salary payable',classification:'Liability',ledgerBalance:salary.ledgerBalance,recordedBalance:salary.totalsComplete?salary.verifiedOutstanding:null,difference:salary.difference,matched:salary.controlMatched,exceptionCount:salary.exceptionCount,unmatchedCount:salary.unattributed.length,checksPassed:salary.checksPassed},
 {id:'advances',label:'Employee advances',classification:'Asset',ledgerBalance:advances.ledgerBalance,recordedBalance:advances.subledgerBalance,difference:null,matched:advances.controlMatched,exceptionCount:advanceExceptions,unmatchedCount:advances.unattributed.length,checksPassed:advances.checksPassed},
 ...statutory.controls.map((f:{fund:string;ledgerBalance:string;subledgerBalance:string;difference:string;controlMatched:boolean;exceptionCount:number})=>({id:f.fund.toLowerCase(),label:f.fund+' payable',classification:'Liability',ledgerBalance:f.ledgerBalance,recordedBalance:f.subledgerBalance,difference:f.difference,matched:f.controlMatched,exceptionCount:f.exceptionCount,unmatchedCount:null,checksPassed:f.controlMatched&&f.exceptionCount===0&&!statutory.unattributed.length}))
 ];
 if(controls.length!==4||new Set(controls.map(c=>c.id)).size!==4||!['salary','advances','epf','etf'].every(id=>controls.some(c=>c.id===id)))throw Error('Incomplete payroll controls.');
 await c.query('COMMIT');
 return {scope:'All recorded payroll periods, consistent database snapshot',controls,statutoryUnmatchedCount:statutory.unattributed.length,checksPassed:salary.checksPassed&&advances.checksPassed&&statutory.checksPassed,postingEnabled:false as const};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
