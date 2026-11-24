import PDFDocument from 'pdfkit';
import {arsPrintLogoPath,isArsPrintBrand,arsDisplayName} from './arsPrintLogo.ts';
import {invoiceFooter} from './invoiceFooter.ts';
export type DisbursementVoucher={id:string;kind:'Supplier Payment'|'Expense'|'Supplier Refund'|'Import Charge Recovery';date:string;amount:number;payee:string;reference:string;method:string;account:string;recordedBy:string;note?:string};
export function renderArsDisbursementVoucherPdf(v:DisbursementVoucher,shopName:string,logo:Buffer|null,contact?:{address?:string;phone?:string;email?:string}):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:40,info:{Title:v.kind+' voucher '+v.id,Author:arsDisplayName(shopName)}});
  const chunks:Buffer[]=[];doc.on('data',(c:Buffer)=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  const w=doc.page.width-80;
  const recovery=v.kind==='Import Charge Recovery';
  const refund=v.kind==='Supplier Refund'||recovery;
  doc.fillColor('#000000').strokeColor('#000000');
  if(isArsPrintBrand(shopName)){doc.save().translate(40,40).scale(48/615).translate(-245,-320).path(arsPrintLogoPath).fill('#000000','even-odd').restore();}
  else if(logo){try{doc.image(logo,40,40,{fit:[60,48]});}catch{/* retain company header */}}
  doc.font('Helvetica-Bold').fontSize(19).text(arsDisplayName(shopName),110,40,{width:w-70});
  doc.font('Helvetica').fontSize(9).text([contact?.address,contact?.phone,contact?.email].filter(Boolean).join(' | '),110,66,{width:w-70});
  doc.y=Math.max(doc.y+12,110);
  const rule=()=>{const y=doc.y;doc.moveTo(40,y).lineTo(40+w,y).lineWidth(.7).stroke();doc.y=y+12;};
  const field=(label:string,value:string)=>{const y=doc.y;doc.font('Helvetica-Bold').fontSize(10).text(label,40,y,{width:145});const left=doc.y;doc.font('Helvetica').text(value,195,y,{width:w-155});doc.y=Math.max(left,doc.y)+8;};
  rule();doc.font('Helvetica-Bold').fontSize(17).text(recovery?'IMPORT CHARGE RECOVERY RECEIPT':refund?'SUPPLIER REFUND RECEIPT':v.kind==='Supplier Payment'?'SUPPLIER PAYMENT VOUCHER':'EXPENSE PAYMENT VOUCHER',40,doc.y,{width:w,align:'center'}).moveDown();
  field(refund?'Receipt reference':'Voucher reference',v.id);field(recovery?'Recovery date':refund?'Refund date':'Payment date',v.date);field(recovery?'Payer':v.kind==='Expense'?'Expense description':'Supplier',v.payee);field(recovery?'Return / charge reference':refund?'Purchase order / return':'Reference / category',v.reference);field('Payment method',v.method);field(refund?'Received into':'Paid from',v.account);field('Recorded by',v.recordedBy);
  rule();doc.font('Helvetica-Bold').fontSize(18).text((refund?'Amount received: Rs. ':'Amount paid: Rs. ')+v.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),40,doc.y,{width:w,align:'center'}).moveDown();
  if(v.note)field('Notes',v.note);
  rule();doc.font('Helvetica').fontSize(10).text('Prepared by: __________________    Authorized by: __________________',40,doc.y,{width:w}).moveDown(1.5);
  doc.text(refund?'Received by: __________________':'Recipient acknowledgement: __________________',40,doc.y,{width:w}).moveDown(1.5);
  doc.fontSize(9).text(recovery?'Recorded import charge recovery. Signature fields are for physical acknowledgement.':refund?'Recorded supplier refund. Signature fields are for physical acknowledgement.':'Recorded disbursement. Signature fields are for physical acknowledgement.',40,doc.y,{width:w,align:'center'}).moveDown(.5);
  doc.font('Helvetica-Bold').text(invoiceFooter.credit,40,doc.y,{width:w,align:'center'});doc.end();
 });
}
