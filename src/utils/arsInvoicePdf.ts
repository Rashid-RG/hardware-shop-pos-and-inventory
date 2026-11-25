import { arsPrintLogoPath, isArsPrintBrand, arsDisplayName } from './arsPrintLogo.ts';
import PDFDocument from 'pdfkit';
import { invoiceFooter } from './invoiceFooter.ts';
import type { SalesTransaction, InvoiceCompanyMeta } from '../types';

type InvoiceMeta = {
  copyType: string;
  printSequence: number;
  watermarkText: string;
  secondaryWatermarkText?: string;
  printedBy?: string;
  printedAt?: string;
};
type Contact = { address?: string; phone?: string; email?: string; taxRate?: number };
const formatMoney = (amount: number) => 'Rs. ' + amount.toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const safe = (value: unknown, fallback = '-') => String(value ?? '').trim() || fallback;

function invoiceUnit(item: SalesTransaction['items'][number]): string {
  const saved = item.sellingUnitLabel?.trim() || item.variantUnit?.trim();
  if (saved) return saved;
  // Older invoices sometimes stored the packing unit only in their description or name.
  for (const value of [item.invoiceDescription, item.productName.split(' · ').slice(1).pop()]) {
    const match = /^(box|pack|pair|piece|bag|roll|set|carton|bundle|kg|litre|metre)(?: of [0-9]+(?: [a-z]+)?)?$/i.exec(value?.trim() || '');
    if (match) return match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
  }
  return '—';
}

/** Render the approved compact ARS A4 document; no printed signature graphic. */
export const renderArsInvoicePdf = async (
  tx: SalesTransaction,
  shopName: string,
  meta: InvoiceMeta,
  logo: Buffer | null,
  company?: InvoiceCompanyMeta,
  contact?: Contact,
): Promise<Buffer> => new Promise((resolve, reject) => {
  shopName = arsDisplayName(shopName);
  const doc = new PDFDocument({
    size: 'A4', layout: 'portrait', margin: 0, bufferPages: true,
    info: { Title: 'Invoice ' + tx.invoiceNumber, Author: shopName },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
  const left = 26, right = 569, width = right - left;
  const ink = '#000000', rule = '#000000';
  type Align = 'left' | 'center' | 'right';
  const text = (value: string, x: number, y: number, w: number, size = 10,
    bold = false, align: Align = 'left', color = ink) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
      .text(value, x, y, { width: w, align, lineBreak: false });
  };
  const line = (x: number, y: number, x2: number, y2: number) =>
    doc.moveTo(x, y).lineTo(x2, y2).lineWidth(0.6).strokeColor(rule).stroke();
  const outline = (x: number, y: number, w: number, h: number) =>
    doc.roundedRect(x, y, w, h, 4).lineWidth(0.8).strokeColor(rule).stroke();
  const field = (name: string, value: string, x: number, y: number, key: number, w: number) => {
    text(name, x, y, key, 9);
    text(':', x + key, y, 8, 9);
    text(value, x + key + 12, y, w - key - 12, 9, false);
  };
  const sectionIcon = (kind: 'person' | 'calendar' | 'note', x: number, y: number) => {
    doc.save().translate(x, y).lineWidth(1.2).strokeColor(ink).fillColor(ink);
    if (kind === 'person') {
      doc.circle(6, 3, 2.7).fill();
      doc.roundedRect(0, 7, 12, 5, 2).fill();
    } else if (kind === 'calendar') {
      doc.roundedRect(0, 2, 12, 10, 1).stroke();
      doc.moveTo(0, 5).lineTo(12, 5).moveTo(3, 0).lineTo(3, 3).moveTo(9, 0).lineTo(9, 3).stroke();
      for (const dx of [3, 7]) doc.rect(dx, 7, 2, 2).fill();
    } else {
      doc.path('M1 0 L8 0 L12 4 L12 13 L1 13 Z M8 0 L8 4 L12 4 M3 7 L10 7 M3 10 L8 10').stroke();
    }
    doc.restore();
  };
  const taxRate = Number(contact?.taxRate || 0);
  const footerY = 768;
  const summaryHeight = 170;
  const issued = new Date(tx.date).toLocaleString('en-GB', {timeZone:'Asia/Colombo',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
  const title = taxRate > 0 && company?.vatRegistrationNo ? 'TAX INVOICE' : 'CUSTOMER INVOICE';
  const wrap = (value:string,x:number,y:number,w:number,size=9,bold=false) => {
    doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(ink);
    const h=doc.heightOfString(value,{width:w});
    doc.text(value,x,y,{width:w});
    return y+h;
  };
  const header = (continued:boolean) => {
    if(continued){
      text(shopName,left,19,260,13,true);
      text(title+' (CONTINUED)',300,19,269,10,true,'right');
      text(tx.invoiceNumber,left,37,260,10,true);
      text(safe(tx.customerName),300,37,269,9,false,'right');
      line(left,53,right,53);
      return 64;
    }
    if(isArsPrintBrand(shopName)){
      doc.save().translate(left,18).scale(39/615).translate(-245,-320)
        .path(arsPrintLogoPath).fill(ink,'even-odd').restore();
    }else if(logo){try{doc.image(logo,left,16,{fit:[48,48]});}catch{/* name remains */}}
    let leftY=wrap(arsDisplayName(safe(company?.companyLegalName,shopName)),83,16,225,15,true)+3;
    leftY=wrap(contact?.address||'',83,leftY,225,9)+3;
    leftY=wrap(contact?.phone?'Tel: '+contact.phone.replace(/,\s*/g,' / '):'',83,leftY,225,10,true)+2;
    if(company?.supportEmail||contact?.email)leftY=wrap(company?.supportEmail||contact?.email||'',83,leftY,225,8)+2;
    outline(322,16,247,19);
    text(title,322,19,247,11,true,'center');
    field('Invoice No',tx.invoiceNumber,326,41,57,243);
    field('Issued At',issued,326,54,57,243);
    field('Payment',safe(tx.paymentMethod),326,67,57,243);
    field('Currency','LKR (Rs.)',326,80,57,243);
    const boundary=Math.max(leftY,94)+5;
    line(left,boundary,right,boundary);
    let cy=wrap('Customer: '+safe(tx.customerName,'Walk-in Customer'),left,boundary+7,270,10,true)+2;
    cy=wrap('Address: '+safe(tx.customerAddress),left,cy,270,9)+2;
    cy=wrap('Phone: '+safe(tx.customerPhone),left,cy,270,9);
    let ry=wrap('Sales Rep.: '+safe(tx.salesRepName,'Not recorded'),310,boundary+7,259,9)+2;
    ry=wrap('Line items: '+tx.items.length+'   |   Tax: '+taxRate.toFixed(1)+'%',310,ry,259,9)+2;
    if(tx.paymentMethod==='Credit Account'&&tx.creditDueDate)ry=wrap('Due date: '+tx.creditDueDate,310,ry,259,9);
    return Math.max(cy,ry)+9;
  };
  const hasDiscount=tx.items.some(i=>Number(i.discount||0)>0||Number(i.discountAmount||0)>0);
  const cols=hasDiscount?[left,46,114,225,310,341,367,438,498,right]:[left,46,128,256,361,393,421,494,right];
  const headings=hasDiscount?['#','Product Code','Item Name','Description','U/M','Qty','Rate','Discount','Amount']:['#','Product Code','Item Name','Description','U/M','Qty','Rate','Amount'];
  const alignments:Align[]=hasDiscount?['center','left','left','left','center','center','right','right','right']:['center','left','left','left','center','center','right','right'];
  let tableTop=0,bodyStart=0;
  const tableStart=(continued:boolean)=>{
    tableTop=header(continued);
    headings.forEach((name,i)=>text(name,cols[i]+3,tableTop+4,cols[i+1]-cols[i]-6,8.5,true,alignments[i]));
    bodyStart=tableTop+17;
    line(left,bodyStart,right,bodyStart);
    return bodyStart;
  };
  const closeTable=(bottom:number)=>doc.rect(left,tableTop,width,bottom-tableTop).lineWidth(.7).strokeColor(rule).stroke();
  const rows=tx.items.map((item,index)=>{
    const gross=Number(item.quantity)*Number(item.sellingPrice);
    const discount=Math.min(gross,Math.max(0,gross*Number(item.discount||0)/100+Number(item.discountAmount||0)));
    const values=[String(index+1),safe(item.variantSku),safe(item.productName),String(item.invoiceDescription||'').trim(),invoiceUnit(item),String(item.quantity),formatMoney(Number(item.sellingPrice)),...(hasDiscount?[discount?formatMoney(discount):'-']:[]),formatMoney(gross-discount)];
    const height=Math.max(13,Math.ceil(Math.max(...values.map((v,i)=>doc.font(i===values.length-1?'Helvetica-Bold':'Helvetica').fontSize(8.6).heightOfString(v,{width:cols[i+1]-cols[i]-6}))))+3);
    return {values,height};
  });
  let y=tableStart(false);
  rows.forEach(({values,height},index)=>{
    // Keep room for totals on the last page; use a compact continuation header.
    const limit=index===rows.length-1?footerY-summaryHeight:footerY-6;
    if(y+height>limit&&y>bodyStart){closeTable(y);doc.addPage();y=tableStart(true);}
    if(y+height>footerY-6)throw Error('Invoice item text is too long for a single A4 page.');
    values.forEach((value,i)=>doc.font(i===values.length-1?'Helvetica-Bold':'Helvetica').fontSize(8.6).fillColor(ink)
      .text(value,cols[i]+3,y+1.5,{width:cols[i+1]-cols[i]-6,align:alignments[i]}));
    y+=height;
  });
  closeTable(y);
  if(y+summaryHeight>footerY){doc.addPage();y=header(true);}
  const top=y+9;
  outline(left,top,264,70);
  text('Notes',left+8,top+5,248,10,true);
  wrap('Goods once sold will be exchanged only with original invoice and management approval.',left+8,top+20,248,9);
  text('Thank you for your business.',left+8,top+52,248,9);
  const knownPaid = tx.paymentMethod === 'Credit Account' ? 0
    : tx.cashReceived != null ? Math.min(Number(tx.total), Math.max(0, Number(tx.cashReceived)))
    : String(tx.paymentStatus || '').toUpperCase() === 'PAID' ? Number(tx.total) : null;
  const discountLabel = tx.wholesaleMeta?.invoiceDiscountMode === 'percent'
    ? 'Discount (' + Number(tx.wholesaleMeta.invoiceDiscountPercent || 0) + '%)'
    : tx.wholesaleMeta?.invoiceDiscountMode === 'amount' ? 'Discount (Fixed)' : 'Discount';
  const summary = [
    ['Subtotal', formatMoney(tx.subtotal)], [discountLabel, formatMoney(tx.discountAmount || 0)],
    ['Tax (' + taxRate.toLocaleString('en-US', {minimumFractionDigits:1}) + '%)', formatMoney(tx.tax || 0)], ['Total', formatMoney(tx.total)],
    ...(tx.paymentMethod === 'Cash'
      ? []
      : [['Amount Paid', knownPaid == null ? 'Not recorded' : formatMoney(knownPaid)], ['Balance Due', knownPaid == null ? 'Not recorded' : formatMoney(Math.max(0, tx.total - knownPaid))]]),
  ];
  doc.roundedRect(304, top, 265, 70, 4).lineWidth(0.6).strokeColor(rule).stroke();
  if (tx.paymentMethod !== 'Cash') outline(304, top+73, 265, 31);
  summary.forEach(([name, amount], i) => {
    const yy = top + [4, 20, 36, 52, 76, 91][i];
    if (i === 3) outline(304, yy-2, 265, 20);
    const size = i === 3 ? 13 : 10;
    text(name, 314, yy, 124, size, i >= 3, 'left', ink);
    text(amount, 439, yy, 120, size, true, 'right', ink);
  });
  const signatureY = top + 120;
  ['Prepared By', 'Received By', 'Authorized By'].forEach((title, i) => {
    const x = left + i * width / 3;
    if (i > 0) line(x, signatureY-14, x, signatureY+34);
    doc.moveTo(x+18, signatureY).lineTo(x+width/3-18, signatureY).lineWidth(0.9).strokeColor(ink).stroke();
    text(title, x, signatureY+5, width/3, 10, true, 'center');
    text(i === 1 ? 'Customer' : shopName, x, signatureY+19, width/3, 9, false, 'center');
  });
  const range = doc.bufferedPageRange();
  for (let page = 0; page < range.count; page++) {
    doc.switchToPage(range.start + page);
    line(left, footerY, right, footerY);
    text('Printed by ' + shopName + '.', left, footerY+6, 363, 10, true);
    doc.font('Helvetica').fontSize(8).fillColor(ink).text(invoiceFooter.goods + ' ' + invoiceFooter.thanks,
      left, footerY+20, {width: 355});
    text(`Page ${page+1} of ${range.count}`, left, footerY+44, 110, 7);
    line(400, footerY+8, 400, footerY+50);
    text('Powered by', 411, footerY+6, 158, 8, false, 'right');
    doc.font('Helvetica-BoldOblique').fontSize(16).fillColor(ink)
      .text(invoiceFooter.credit.replace(/^Powered by /, ''), 411, footerY+18, {width:158,align:'right',lineBreak:false});
    doc.moveTo(right-67, footerY+38).quadraticCurveTo(right-37, footerY+30, right, footerY+34)
      .quadraticCurveTo(right-35, footerY+32, right-67, footerY+39).fill(ink);
    text('Smart systems for business.', 411, footerY+43, 158, 9, false, 'right');
  }
  doc.end();
});
