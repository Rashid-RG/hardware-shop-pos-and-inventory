import PDFDocument from 'pdfkit';
import type {monthlyPayrollReport} from './monthlyPayrollReport';
import {arsPrintLogoPath,isArsPrintBrand,arsDisplayName} from '../src/utils/arsPrintLogo';
import {rsNextwardLogoBuffer,rsNextwardPrintWidth} from '../src/utils/rsNextwardPrintLogo';

type Report=Awaited<ReturnType<typeof monthlyPayrollReport>>;
type Company={name:string;address:string;phone:string};
type Metric=keyof Report['verifiedTotals'];
const fields:[Metric,string][]=[['baseSalary','Basic salary'],['overtime','Overtime'],['bonus','Bonus'],['allowances','Allowances'],['grossSalary','Gross salary'],['advanceRecovery','Advance recovery'],['otherDeductions','Other deductions (incl. unpaid leave)'],['employeeEpf','Employee EPF'],['employerEpf','Employer EPF'],['employerEtf','Employer ETF'],['totalDeductions','Total deductions'],['netSalary','Net salary'],['employerCost','Employer cost'],['paid','Recorded payments'],['outstanding','Outstanding salary']];
const money=(s:string)=>{const [w,f='']=s.split('.');return w.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+f.padEnd(2,'0');};
export function renderMonthlyPayrollPdf(r:Report,company:Company):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margin:36,bufferPages:true,info:{Title:'Confidential monthly payroll '+r.period,Author:arsDisplayName(company.name),Creator:'RS Nextward'}});
 const chunks:Buffer[]=[];doc.on('data',(c:Buffer)=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
 try{
 const left=36,right=doc.page.width-36,w=right-left,limit=doc.page.height-90;
 const text=(v:string,x:number,y:number,width:number,size=9,bold=false,align:'left'|'right'='left')=>doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor('#000000').text(v,x,y,{width,align});
 const line=(y:number)=>doc.strokeColor('#000000').lineWidth(.5).moveTo(left,y).lineTo(right,y).stroke();
 let y=0;
 const header=()=>{
 if(isArsPrintBrand(company.name))doc.save().translate(left,36).scale(40/615).translate(-245,-320).path(arsPrintLogoPath).fill('#000000','even-odd').restore();
 text(arsDisplayName(company.name),left+62,36,w-62,16,true);
 text([company.address,company.phone].filter(Boolean).join(' | '),left+62,doc.y+3,w-62,8);
 y=Math.max(95,doc.y+8);line(y);y+=9;
 text('MONTHLY PAYROLL REPORT',left,y,w,13,true);y=doc.y+4;
 text(r.period+' | Confidential | LKR | Posted payroll cohort; recorded payments to date',left,y,w,9);y=doc.y+5;
 text(r.totalsComplete?'No record exceptions detected.':'PARTIAL TOTALS: '+r.exceptionCount+' record(s) excluded pending reconciliation.',left,y,w,9,true);y=doc.y+5;
 if(r.baseSalaryOnlyCount){text(r.baseSalaryOnlyCount+' base-only record(s) lack a statutory breakdown. Zero contributions do not establish exemption.',left,y,w,8);y=doc.y+5;}
 };
 const next=()=>{doc.addPage();header();};
 const ensure=(height:number)=>{if(y+height>limit)next();};
 header();
 text('Verified totals',left,y,w,11,true);y=doc.y+5;
 for(const [k,label] of fields){ensure(20);text(label,left,y,w*.6);text(money(r.verifiedTotals[k]),left+w*.6,y,w*.4,9,k==='netSalary'||k==='outstanding','right');y=Math.max(doc.y,y+12)+3;}
 ensure(30);line(y);y+=8;text('Employee register ('+r.recordCount+' records)',left,y,w,11,true);y=doc.y+8;
 for(const entry of r.rows){
 // Compact two-column amounts; reserve whole employee record to avoid orphaned headings.
 const name=entry.employeeName+' | '+entry.employeeId;
 const status=entry.issue?'REVIEW REQUIRED':entry.statutoryBound?'Detailed statutory payroll':'Base salary only';
 doc.font('Helvetica-Bold').fontSize(10);const nameH=doc.heightOfString(name,{width:w});
 doc.font('Helvetica').fontSize(8);const reference='Posting date: '+entry.postingDate+' | Journal: '+entry.journalId;
 const refH=doc.heightOfString(reference,{width:w});
 const issueH=entry.issue?doc.heightOfString(entry.issue,{width:w}):0;
 const height=nameH+refH+issueH+(entry.amounts?Math.ceil(fields.length/2)*22:0)+47;
 if(height>limit-170)throw Error('Payroll record too long for PDF. Export Excel.');
 ensure(height);line(y);y+=7;text(name,left,y,w,10,true);y=doc.y+3;text(reference,left,y,w,8);y=doc.y+3;text(status,left,y,w,8,true);y=doc.y+5;
 if(entry.issue){text(entry.issue,left,y,w,8);y=doc.y+4;}
 if(entry.amounts)for(let i=0;i<fields.length;i+=2){
 const [k,label]=fields[i],other=fields[i+1],half=w/2-5;
 text(label,left,y,half*.57,8);text(money(entry.amounts[k]),left+half*.57,y,half*.43,8,false,'right');
 if(other){text(other[1],left+w/2+5,y,half*.57,8);text(money(entry.amounts[other[0]]),left+w/2+5+half*.57,y,half*.43,8,false,'right');}
 y+=22;
 }
 y+=8;
 }
 if(!r.rows.length){ensure(20);text('No posted payroll for this month.',left,y,w,9);}
 const pages=doc.bufferedPageRange();
 for(let i=0;i<pages.count;i++){
 doc.switchToPage(pages.start+i);const fy=doc.page.height-65;line(fy-6);
 text('Confidential | Page '+(i+1)+' of '+pages.count,left,fy,w-110,8);
 text('Powered by RS Nextward',right-112,fy,112,7,false,'right');
 doc.image(rsNextwardLogoBuffer(),right-rsNextwardPrintWidth,fy+12,{width:rsNextwardPrintWidth});
 }
 doc.end();
 }catch(e){doc.destroy();reject(e);}
 });
}
