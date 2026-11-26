import type {Pool} from 'pg';
import PDFDocument from 'pdfkit';
import {arsPrintLogoPath,isArsPrintBrand,arsDisplayName} from '../src/utils/arsPrintLogo';
import {calculatePayroll,type PayrollCalculationInput} from './payrollCalculation';
import {moneyCents} from './generalLedger';
import {decimal} from './supplierAdvance';

export async function readPostedPayslip(db:Pool,shopId:string,id:string){
 const r=(await db.query(`SELECT a.id,a.employee_id,a.employee_name,a.period_key,a.posting_date::text AS day,a.base_salary::text,a.gross_amount::text,a.journal_id,
 d.inputs,d.results,d.net_salary::text,d.gross_salary::text,d.total_deductions::text,d.employer_contributions::text,
 s.proposal_id IS NOT NULL AS statutory_bound,
 COALESCE(p.paid,0)::text AS paid,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=a.shop_id AND j.source_kind='Reversal' AND (j.source_id=a.journal_id OR EXISTS(SELECT 1 FROM ars_gl_salary_payments v WHERE v.shop_id=a.shop_id AND v.accrual_id=a.id AND v.journal_id=j.source_id))) OR COALESCE(p.unmatched,FALSE) AS requires_review
 FROM ars_gl_payroll_accruals a
 LEFT JOIN ars_gl_payroll_details d ON d.shop_id=a.shop_id AND d.proposal_id=a.id
 LEFT JOIN ars_gl_payroll_statutory_snapshots s ON s.shop_id=a.shop_id AND s.proposal_id=a.id
 LEFT JOIN LATERAL(SELECT SUM(v.amount) AS paid,BOOL_OR(NOT EXISTS(SELECT 1 FROM ars_financial_movements m WHERE m.shop_id=v.shop_id AND m.id=v.journal_id AND m.source_id=v.id AND m.account_id=v.financial_account_id AND m.amount=-v.amount AND m.movement_kind='Salary Payment' AND m.effective_date=v.posting_date AND m.recorded_by=v.recorded_by)) AS unmatched FROM ars_gl_salary_payments v WHERE v.shop_id=a.shop_id AND v.accrual_id=a.id) p ON TRUE
 WHERE a.shop_id=$1 AND a.id=$2`,[shopId,id])).rows[0];
 if(!r)return null;
 if(r.requires_review)throw Error('Payroll requires reconciliation before payslip export.');
 const inputs:PayrollCalculationInput=r.inputs||{baseSalary:r.base_salary,earnings:[],deductions:[],contributions:[],policyReference:'Base salary only'};
 const calculated=calculatePayroll(inputs);
 if(r.inputs&&(!r.statutory_bound||!r.results||JSON.stringify(calculated.contributions)!==JSON.stringify(r.results.contributions.map((c:any)=>({id:c.id,party:c.party,basis:c.basis,rateBasisPoints:c.rateBasisPoints,amount:c.amount,evidence:c.evidence})))||moneyCents(calculated.netSalary)!==moneyCents(r.net_salary)||moneyCents(calculated.grossSalary)!==moneyCents(r.gross_salary)||moneyCents(calculated.totalDeductions)!==moneyCents(r.total_deductions)||moneyCents(calculated.employerContributions)!==moneyCents(r.employer_contributions)))throw Error('Payroll requires reconciliation before payslip export.');
 if(moneyCents(calculated.baseSalary)!==moneyCents(r.base_salary)||moneyCents(calculated.grossSalary)!==moneyCents(r.gross_amount))throw Error('Payroll requires reconciliation before payslip export.');
 const paid=moneyCents(r.paid),net=moneyCents(calculated.netSalary);
 if(paid>net)throw Error('Payroll requires reconciliation before payslip export.');
 return {id:r.id as string,employeeId:r.employee_id as string,employeeName:r.employee_name as string,period:r.period_key as string,day:r.day as string,journalId:r.journal_id as string,inputs,calculated,statutoryBound:!!r.statutory_bound,paid:decimal(paid),outstanding:decimal(net-paid)};
}

export function renderPostedPayslip(p:NonNullable<Awaited<ReturnType<typeof readPostedPayslip>>>,shopName:string):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true,info:{Title:'Confidential employee payslip',Author:arsDisplayName(shopName)}});
 const chunks:Buffer[]=[];doc.on('data',(b:Buffer)=>chunks.push(b));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
 const w=doc.page.width-80;
 const header=()=>{doc.fillColor('#000000').strokeColor('#000000');if(isArsPrintBrand(shopName))doc.save().translate(40,40).scale(42/615).translate(-245,-320).path(arsPrintLogoPath).fill('#000000','even-odd').restore();doc.font('Helvetica-Bold').fontSize(18).text(arsDisplayName(shopName),105,40,{width:w-65});doc.fontSize(11).text('CONFIDENTIAL EMPLOYEE PAYSLIP',105,doc.y+3,{width:w-65});doc.y=Math.max(doc.y+12,100);};
 header();
 const space=()=>{if(doc.y>715){doc.addPage();header();}};
 const field=(label:string,value:string,bold=false)=>{space();const y=doc.y;doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(10).text(label,40,y,{width:290});const left=doc.y;doc.text(value,335,y,{width:w-295,align:'right'});doc.y=Math.max(left,doc.y)+5;};
 const section=(name:string)=>{space();doc.moveDown(.5);doc.moveTo(40,doc.y).lineTo(40+w,doc.y).stroke();doc.moveDown(.5);doc.font('Helvetica-Bold').fontSize(11).text(name,40,doc.y,{width:w});doc.moveDown(.4);};
 const money=(v:string)=>'Rs. '+v;
 field('Employee',p.employeeName,true);field('Employee reference',p.employeeId);field('Payroll month',p.period);field('Accrual posting date',p.day);field('Payroll reference',p.id);
 section('Earnings');field('Basic salary',money(p.calculated.baseSalary));for(const k of ['Overtime','Bonus','Allowance'])field(k,money(decimal(p.inputs.earnings.filter(e=>e.kind===k).reduce((n,e)=>n+moneyCents(e.amount),0n))));
 field('Gross salary',money(p.calculated.grossSalary),true);
 section('Deductions');for(const k of ['UnpaidLeave','AdvanceRecovery','Other'])field(k==='UnpaidLeave'?'Unpaid leave':k==='AdvanceRecovery'?'Salary advance recovery':'Other deductions',money(decimal(p.inputs.deductions.filter(e=>e.kind===k).reduce((n,e)=>n+moneyCents(e.amount),0n))));
 for(const c of p.calculated.contributions.filter(c=>c.party==='Employee'))field('Employee EPF',money(c.amount));
 field('Total deductions',money(p.calculated.totalDeductions),true);field('Net salary',money(p.calculated.netSalary),true);
 section('Employer contributions (not deducted from net salary)');if(p.statutoryBound){for(const c of p.calculated.contributions.filter(c=>c.party==='Employer'))field(c.id.endsWith('-epf')?'Employer EPF':'Employer ETF',money(c.amount));}else field('Statutory breakdown','Not available — base salary only');
 section('Salary payment status');field('Recorded payments',money(p.paid));field('Outstanding salary',money(p.outstanding),true);field('Status',moneyCents(p.outstanding)===0n?'Settled':moneyCents(p.paid)>0n?'Partially paid':'Unpaid',true);
 space();doc.font('Helvetica').fontSize(9).text('This payslip records posted payroll and recorded payments; it is not proof of bank transfer or statutory remittance.',40,doc.y+8,{width:w});
 const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(pages.start+i);const y=doc.page.height-55;doc.font('Helvetica').fontSize(8).fillColor('#000000').text('Confidential | Powered by RS Nextward',40,y,{width:w-80,lineBreak:false});doc.text('Page '+(i+1)+' of '+pages.count,40,y,{width:w,align:'right',lineBreak:false});}
 doc.end();
 });
}
