import {rsNextwardLogoBuffer} from './rsNextwardPrintLogo.ts';
import PDFDocument from 'pdfkit';
import { arsPrintLogoPath,isArsPrintBrand,arsDisplayName } from './arsPrintLogo.ts';
import { invoiceFooter } from './invoiceFooter.ts';
export type HandoverVoucher={id:string;amount:number;employeeName:string;fromAccount:string;toAccount:string;requestedAt:string;confirmedAt:string;effectiveDate:string;confirmedBy:string;requestNote?:string;decisionNote?:string};
export function renderArsHandoverVoucherPdf(v:HandoverVoucher,shopName:string,logo:Buffer|null,contact?:{address?:string;phone?:string;email?:string}):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:40,info:{Title:'Confirmed cash handover '+v.id,Author:arsDisplayName(shopName)}});
  const chunks:Buffer[]=[];doc.on('data',(c:Buffer)=>chunks.push(c));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
  const w=doc.page.width-80;
  doc.fillColor('#000000').strokeColor('#000000');
  if(isArsPrintBrand(shopName)){doc.save().translate(40,40).scale(48/615).translate(-245,-320).path(arsPrintLogoPath).fill('#000000','even-odd').restore();}
  else if(logo){try{doc.image(logo,40,40,{fit:[60,48]});}catch{/* retain text header */}}
  doc.font('Helvetica-Bold').fontSize(19).text(arsDisplayName(shopName),110,40,{width:w-70});
  doc.font('Helvetica').fontSize(9).text([contact?.address,contact?.phone,contact?.email].filter(Boolean).join(' | '),110,66,{width:w-70});
  doc.y=Math.max(doc.y+12,110);
  const rule=()=>{const y=doc.y;doc.moveTo(40,y).lineTo(40+w,y).lineWidth(0.7).stroke();doc.y=y+12;};
  const field=(label:string,value:string)=>{const y=doc.y;doc.font('Helvetica-Bold').fontSize(10).text(label,40,y,{width:145});const left=doc.y;doc.font('Helvetica').text(value,195,y,{width:w-155});doc.y=Math.max(left,doc.y)+8;};
  rule();doc.font('Helvetica-Bold').fontSize(17).text('CASH HANDOVER VOUCHER',40,doc.y,{width:w,align:'center'}).moveDown(.5);
  doc.fontSize(11).text('CONFIRMED - INTERNAL CASH TRANSFER',40,doc.y,{width:w,align:'center'}).moveDown();
  field('Voucher reference',v.id);field('Representative',v.employeeName);field('From account',v.fromAccount);field('Received into',v.toAccount);field('Requested at',v.requestedAt);field('Confirmed at',v.confirmedAt);field('Business date',v.effectiveDate);field('Confirmed by',v.confirmedBy);
  rule();doc.font('Helvetica-Bold').fontSize(18).text('Amount received: Rs. '+v.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),40,doc.y,{width:w,align:'center'}).moveDown();
  if(v.requestNote)field('Request note',v.requestNote);if(v.decisionNote)field('Confirmation note',v.decisionNote);
  rule();doc.font('Helvetica').fontSize(10).text('Representative signature: __________________',40,doc.y,{width:w}).moveDown(1.5);
  doc.text('Receiving officer signature: __________________',40,doc.y,{width:w}).moveDown(1.5);
  doc.fontSize(9).text('Internal transfer only. Not a customer payment or sales invoice.',40,doc.y,{width:w,align:'center'}).moveDown(.5);
  if(doc.y+42>doc.page.height-40)doc.addPage();
    doc.font('Helvetica-Bold').fontSize(8).text(invoiceFooter.credit,40,doc.y,{width:w,align:'right'});
    doc.image(rsNextwardLogoBuffer(),doc.page.width-150,doc.y+4,{width:110});doc.end();
 });
}
