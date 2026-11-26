// Keep this arithmetic module independent of database initialization and test-loader resolution.
function moneyCents(value:string):bigint{
 if(typeof value!=='string'||!/^\d{1,14}(?:\.\d{1,2})?$/.test(value))throw Error('Use a non-negative decimal amount with at most two decimal places.');
 const [whole,fraction='']=value.split('.');
 return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
type EarningKind='Overtime'|'Bonus'|'Allowance';
type DeductionKind='UnpaidLeave'|'AdvanceRecovery'|'Other';
type Component<K>={id:string;kind:K;amount:string;evidence:string};
type Contribution={id:string;party:'Employee'|'Employer';basis:string;rateBasisPoints:number;evidence:string};
export type PayrollCalculationInput={baseSalary:string;earnings:Component<EarningKind>[];deductions:Component<DeductionKind>[];contributions:Contribution[];policyReference:string};
const max=9999999999999999n;
const money=(n:bigint)=>{if(n<0n||n>max)throw Error('Payroll amount outside supported range.');return String(n/100n)+'.'+String(n%100n).padStart(2,'0');};
const validText=(v:unknown,n:number)=>typeof v==='string'&&!!v.trim()&&v.length<=n;
/** Arithmetic only. Eligibility, statutory bases, rates, advance balances and approval must be independently verified. */
export function calculatePayroll(i:PayrollCalculationInput){
 if(!i||!validText(i.policyReference,500)||![i.earnings,i.deductions,i.contributions].every(a=>Array.isArray(a)&&a.length<=100))throw Error('Explicit payroll policy and component lists required.');
 const base=moneyCents(i.baseSalary);if(base<=0n)throw Error('Positive base salary required.');
 const ids=new Set<string>();
 const check=(v:{id:string;evidence:string})=>{if(!v||!validText(v.id,100)||!validText(v.evidence,500)||ids.has(v.id))throw Error('Unique component identifier and supporting evidence required.');ids.add(v.id);};
 const earnings=i.earnings.map(v=>{check(v);if(!['Overtime','Bonus','Allowance'].includes(v.kind))throw Error('Invalid earnings component.');const n=moneyCents(v.amount);if(n<=0n)throw Error('Positive earnings required.');return n;});
 const deductions=i.deductions.map(v=>{check(v);if(!['UnpaidLeave','AdvanceRecovery','Other'].includes(v.kind))throw Error('Invalid deduction component.');const n=moneyCents(v.amount);if(n<=0n)throw Error('Positive deduction required.');return n;});
 const sum=(a:bigint[])=>a.reduce((n,v)=>n+v,0n);
 const gross=base+sum(earnings);money(gross);
 let employee=0n,employer=0n;
 const contributions=i.contributions.map(v=>{
  check(v);
  if(!['Employee','Employer'].includes(v.party)||!Number.isInteger(v.rateBasisPoints)||v.rateBasisPoints<0||v.rateBasisPoints>10000)throw Error('Invalid contribution party or rate.');
  const basis=moneyCents(v.basis);if(basis>gross)throw Error('Contribution basis exceeds gross earnings.');
  const amount=(basis*BigInt(v.rateBasisPoints)+5000n)/10000n;
  if(v.party==='Employee')employee+=amount;else employer+=amount;
  return {id:v.id,party:v.party,basis:money(basis),rateBasisPoints:v.rateBasisPoints,amount:money(amount),evidence:v.evidence};
 });
 const ordinary=sum(deductions),total=ordinary+employee;
 if(total>gross)throw Error('Payroll deductions exceed gross earnings.');
 return {baseSalary:money(base),additionalEarnings:money(sum(earnings)),grossSalary:money(gross),ordinaryDeductions:money(ordinary),employeeContributions:money(employee),employerContributions:money(employer),totalDeductions:money(total),netSalary:money(gross-total),employerCost:money(gross+employer),contributions,policyReference:i.policyReference};
}
