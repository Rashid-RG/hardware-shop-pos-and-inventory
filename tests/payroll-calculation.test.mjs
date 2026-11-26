import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculatePayroll,calculateStatutoryPayroll} from '../backend/payrollCalculation.ts';

const fixture=()=>({baseSalary:'50000.00',earnings:[{id:'ot',kind:'Overtime',amount:'5000.00',evidence:'Approved timesheet'},{id:'bonus',kind:'Bonus',amount:'2000.00',evidence:'Approved bonus'},{id:'allow',kind:'Allowance',amount:'3000.00',evidence:'Approved allowance'}],deductions:[{id:'leave',kind:'UnpaidLeave',amount:'1000.00',evidence:'Approved leave'},{id:'advance',kind:'AdvanceRecovery',amount:'5000.00',evidence:'Approved recovery'}],contributions:[{id:'ec',party:'Employee',basis:'50000.00',rateBasisPoints:500,evidence:'Synthetic test rate'},{id:'er',party:'Employer',basis:'60000.00',rateBasisPoints:1000,evidence:'Synthetic test rate'}],policyReference:'Synthetic policy for arithmetic testing only'});
test('payroll separates employee deductions and employer costs',()=>{
 const p=calculatePayroll(fixture());
 assert.equal(p.grossSalary,'60000.00');
 assert.equal(p.ordinaryDeductions,'6000.00');
 assert.equal(p.employeeContributions,'2500.00');
 assert.equal(p.employerContributions,'6000.00');
 assert.equal(p.netSalary,'51500.00');
 assert.equal(p.employerCost,'66000.00');
});
test('contributions round half a cent deterministically',()=>{
 const i=fixture();i.baseSalary='0.05';i.earnings=[];i.deductions=[];i.contributions=[{id:'round',party:'Employee',basis:'0.05',rateBasisPoints:1000,evidence:'Synthetic rounding'}];
 assert.equal(calculatePayroll(i).employeeContributions,'0.01');
 assert.equal(calculatePayroll(i).netSalary,'0.04');
});
test('rejects unsupported or unsafe component values',()=>{
 for(const mutate of [
 i=>{i.deductions[0].amount='999999.00'},
 i=>{i.earnings[0].amount='-1.00'},
 i=>{i.earnings[0].amount='0.001'},
 i=>{i.deductions[0].id=i.earnings[0].id},
 i=>{i.contributions[0].basis='60000.01'},
 i=>{i.contributions[0].rateBasisPoints=1.5},
 i=>{i.contributions[0].rateBasisPoints=10001},
 i=>{i.contributions[0].party='Unknown'},
 i=>{i.policyReference=' '},
 i=>{i.earnings[0].evidence=' '},
 i=>{i.baseSalary='0'},
 ]){const i=fixture();mutate(i);assert.throws(()=>calculatePayroll(i));}
});
test('does not invent contributions when none supplied',()=>{
 const i=fixture();i.contributions=[];const p=calculatePayroll(i);assert.equal(p.netSalary,'54000.00');assert.equal(p.employerCost,'60000.00');
});

const statutoryFixture=()=>({id:'synthetic-policy',authority_reference:'Synthetic test only',employee_epf_bp:500,employer_epf_bp:1000,employer_etf_bp:200,eligibility_rules:{version:1,employeeEligibility:'StandardCoveredEmployee',exceptions:'None',epf:{included:['Base','Allowance'],subtractUnpaidLeave:true},etf:{included:['Base','Bonus'],subtractUnpaidLeave:false}}});
test('statutory calculation derives separate bases and preserves provisional status',()=>{
 const i=fixture();i.contributions=[];
 const p=calculateStatutoryPayroll(i,statutoryFixture());
 assert.deepEqual(p.results.contributions.map(c=>[c.basis,c.amount]),[['52000.00','2600.00'],['52000.00','5200.00'],['52000.00','1040.00']]);
 assert.equal(p.results.netSalary,'51400.00');
 assert.equal(p.results.employerCost,'66240.00');
 assert.equal(p.postingEnabled,false);
 assert.equal(p.statutoryVerified,false);
 assert.equal(p.inputs.policyReference,'statutory-policy:synthetic-policy');
});
test('different statutory earnings bases are supported',()=>{
 const i=fixture();i.contributions=[];
 const p=statutoryFixture();p.eligibility_rules.etf.included=['Base','Overtime'];
 const r=calculateStatutoryPayroll(i,p);
 assert.equal(r.results.contributions[0].basis,'52000.00');
 assert.equal(r.results.contributions[2].basis,'55000.00');
 assert.equal(r.results.contributions[2].amount,'1100.00');
});
test('statutory calculation fails closed for unsupported rules and manual contributions',()=>{
 assert.throws(()=>calculateStatutoryPayroll(fixture(),statutoryFixture()));
 for(const mutate of [
 p=>{p.eligibility_rules={documentedRules:'Documentary only'}},
 p=>{p.eligibility_rules.exceptions='Special'},
 p=>{p.eligibility_rules.epf.included=['Base','Base']},
 p=>{p.eligibility_rules.epf.included=['Unknown']},
 p=>{delete p.eligibility_rules.etf.subtractUnpaidLeave},
 p=>{p.employee_epf_bp=10001},
 ]){const i=fixture();i.contributions=[];const p=statutoryFixture();mutate(p);assert.throws(()=>calculateStatutoryPayroll(i,p));}
});
