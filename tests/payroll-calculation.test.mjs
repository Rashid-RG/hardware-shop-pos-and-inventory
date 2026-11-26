import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculatePayroll} from '../backend/payrollCalculation.ts';

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
