import {calculatePayroll,type PayrollCalculationInput} from './payrollCalculation';
type Control='salary'|'salaryPayable'|'employeeAdvances'|'epfPayable'|'etfPayable'|'employerContributions';
type Line={control:Control;debit:string;credit:string};
const cents=(v:string)=>{const [w,f='']=v.split('.');return BigInt(w)*100n+BigInt(f.padEnd(2,'0'));};
const decimal=(v:bigint)=>String(v/100n)+'.'+String(v%100n).padStart(2,'0');
/** Pure plan only. Caller must verify approved policy, eligibility, snapshot and advance balances.
 * Unpaid leave reduces earned salary expense; unsupported deductions fail closed. */
export function planDetailedPayrollJournal(inputs:PayrollCalculationInput){
 const result=calculatePayroll(inputs);
 if(!inputs.policyReference.startsWith('statutory-policy:'))throw Error('Bound statutory payroll required for detailed posting.');
 const expected=[['statutory-employee-epf','Employee'],['statutory-employer-epf','Employer'],['statutory-employer-etf','Employer']] as const;
 if(result.contributions.length!==3||expected.some(([id,party])=>!result.contributions.some(c=>c.id===id&&c.party===party)))throw Error('Supported statutory contributions required.');
 if(inputs.deductions.some(d=>d.kind==='Other'))throw Error('Unsupported payroll deduction requires an approved accounting treatment.');
 const leave=inputs.deductions.filter(d=>d.kind==='UnpaidLeave').reduce((n,d)=>n+cents(d.amount),0n);
 const recoveries=inputs.deductions.filter(d=>d.kind==='AdvanceRecovery').map(d=>{
  if(!d.id.startsWith('advance:')||!d.id.slice(8).trim())throw Error('Advance recovery requires a disbursement reference.');
  return {disbursementId:d.id.slice(8),amount:decimal(cents(d.amount)),evidence:d.evidence};
 });
 const advance=recoveries.reduce((n,d)=>n+cents(d.amount),0n);
 const salary=cents(result.grossSalary)-leave,employer=cents(result.employerContributions),net=cents(result.netSalary);
 const epf=result.contributions.filter(c=>c.id.endsWith('-epf')).reduce((n,c)=>n+cents(c.amount),0n);
 const etf=cents(result.contributions.find(c=>c.id==='statutory-employer-etf')!.amount);
 const lines:Line[]=[];
 const add=(control:Control,n:bigint,side:'debit'|'credit')=>{
  if(n<0n||n>9999999999999999n)throw Error('Payroll journal amount outside supported range.');
  if(n>0n)lines.push({control,debit:side==='debit'?decimal(n):'0.00',credit:side==='credit'?decimal(n):'0.00'});
 };
 add('salary',salary,'debit');add('employerContributions',employer,'debit');
 add('salaryPayable',net,'credit');add('employeeAdvances',advance,'credit');add('epfPayable',epf,'credit');add('etfPayable',etf,'credit');
 if(lines.length<2||salary+employer!==net+advance+epf+etf)throw Error('Detailed payroll journal does not balance or has no posting value.');
 return {lines,recoveries,earnedSalary:decimal(salary),netSalary:result.netSalary,employerCost:decimal(salary+employer),grossSalary:result.grossSalary,postingEnabled:false as const};
}
