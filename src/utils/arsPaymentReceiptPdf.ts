import {rsNextwardLogoBuffer,rsNextwardPrintWidth} from './rsNextwardPrintLogo.ts';
import PDFDocument from 'pdfkit';
import { arsPrintLogoPath, isArsPrintBrand, arsDisplayName } from './arsPrintLogo.ts';
import { invoiceFooter } from './invoiceFooter.ts';
import type { CustomerCreditPayment } from '../types';

const money=(n:number)=>'Rs. '+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export function renderArsPaymentReceiptPdf(payment:CustomerCreditPayment,shopName:string,logo:Buffer|null,contact?:{address?:string;phone?:string;email?:string}):Promise<Buffer>{
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:40,info:{Title:'Payment receipt '+payment.id,Author:arsDisplayName(shopName)}});
    const chunks:Buffer[]=[];
    doc.on('data',(chunk:Buffer)=>chunks.push(chunk));
    doc.on('error',reject);
    doc.on('end',()=>resolve(Buffer.concat(chunks)));
    const width=doc.page.width-80;
    doc.fillColor('#000000').strokeColor('#000000');
    if(isArsPrintBrand(shopName)){
      doc.save().translate(40,40).scale(48/615).translate(-245,-320).path(arsPrintLogoPath).fill('#000000','even-odd').restore();
    }else if(logo){try{doc.image(logo,40,40,{fit:[60,48]});}catch{/* text header remains */}}
    doc.font('Helvetica-Bold').fontSize(19).text(arsDisplayName(shopName),110,40,{width:width-70});
    doc.font('Helvetica').fontSize(9).text([contact?.address,contact?.phone,contact?.email].filter(Boolean).join(' | '),110,66,{width:width-70});
    doc.y=Math.max(doc.y+12,110);
    const rule=()=>{const y=doc.y;doc.moveTo(40,y).lineTo(40+width,y).lineWidth(0.7).stroke();doc.y=y+12;};
    const field=(label:string,value:string,bold=false)=>{doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(bold?13:10).text(label+':',40,doc.y,{width:width,continued:false});doc.moveUp();const y=doc.y;doc.text(value,205,y,{width:width-165,align:'right'});doc.moveDown(0.6);};
    rule();
    doc.font('Helvetica-Bold').fontSize(18).text('PAYMENT RECEIPT',40,doc.y,{width,align:'center'}).moveDown();
    field('Receipt reference',payment.id);
    field('Payment date',String(payment.date).slice(0,10));
    field('Received from',payment.customerName);
    field('Invoice',payment.receiptSnapshot?.invoiceNumber||payment.invoiceId||'Customer account');
    field('Payment method',payment.paymentMethod);
    field('Recorded by',payment.createdBy||'Not recorded');
    rule();
    const snapshot=payment.receiptSnapshot;
    if(snapshot?.invoiceTotal!==undefined)field('Invoice total',money(snapshot.invoiceTotal));
    if(snapshot?.previousPayments!==undefined)field('Previous payments',money(snapshot.previousPayments));
    field('Amount received',money(payment.amount),true);
    if(snapshot)field(payment.invoiceId?'Invoice balance after payment':'Account balance after payment',money(snapshot.balanceAfter),true);
    else doc.font('Helvetica').fontSize(10).text('Historical balance at collection was not recorded.',40,doc.y,{width}).moveDown();
    if(payment.note)doc.font('Helvetica').fontSize(10).text('Reference / notes: '+payment.note,40,doc.y,{width}).moveDown();
    rule();
    doc.font('Helvetica').fontSize(10).text('Received by: __________________     Customer: __________________',40,doc.y,{width}).moveDown(2);
    doc.text('Thank you for your payment.',40,doc.y,{width,align:'center'}).moveDown(0.5);
    if(doc.y+42>doc.page.height-40)doc.addPage();
    doc.font('Helvetica-Bold').fontSize(8).text(invoiceFooter.credit,40,doc.y,{width:width,align:'right'});
    doc.image(rsNextwardLogoBuffer(),doc.page.width-40-rsNextwardPrintWidth,doc.y+4,{width:rsNextwardPrintWidth});
    doc.end();
  });
}
