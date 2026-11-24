import PDFDocument from 'pdfkit';
import { invoiceFooter } from './invoiceFooter';
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
const NAVY = '#112e51';
const BLUE = '#bcd8ef';
const INK = '#14253f';
const LINE = '#afc4d8';
const LEFT = 35;
const RIGHT = 560;
const WIDTH = RIGHT - LEFT;
const formatMoney = (amount: number) => 'Rs. ' + amount.toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const safe = (value: unknown, fallback = '-') => String(value ?? '').trim() || fallback;

/** Render the approved compact ARS A4 document; no printed signature graphic. */
export const renderArsInvoicePdf = async (
  tx: SalesTransaction,
  shopName: string,
  meta: InvoiceMeta,
  logo: Buffer | null,
  company?: InvoiceCompanyMeta,
  contact?: Contact,
): Promise<Buffer> => new Promise((resolve, reject) => {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    autoFirstPage: true,
    bufferPages: true,
    info: { Title: 'Invoice ' + tx.invoiceNumber, Author: shopName },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
  const label = (text: string, x: number, y: number, width: number, size = 9, align: 'left' | 'right' | 'center' = 'left', bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size).fillColor(INK).text(text, x, y, { width, align, lineBreak: false, ellipsis: true });
  };
  const box = (x: number, y: number, w: number, h: number) => {
    doc.roundedRect(x, y, w, h, 5).lineWidth(0.8).strokeColor(LINE).stroke();
  };
  const section = (x: number, y: number, w: number, h: number, title: string) => {
    box(x, y, w, h);
    doc.save().roundedRect(x, y, w, 21, 5).fill(BLUE).restore();
    label(title, x + 11, y + 4, w - 22, 11, 'left', true);
  };
  const row = (k: string, v: string, x: number, y: number, w: number, keyW: number) => {
    label(k, x, y, keyW, 8.2, 'left', true);
    label(':', x + keyW, y, 8, 8.2);
    label(v, x + keyW + 9, y, w - keyW - 9, 8.2);
  };
  const footer = (pageNumber: number, totalPages: number) => {
    // Repeat the footer on every printed sheet, including continuation pages.
    doc.moveTo(LEFT, 780).lineTo(RIGHT, 780).lineWidth(0.55).strokeColor(LINE).stroke();
    label('Printed by '+shopName+'.', LEFT, 785, WIDTH, 7.4);
    doc.font('Helvetica').fontSize(7.2).fillColor(INK).text(invoiceFooter.goods+' '+invoiceFooter.thanks, LEFT, 795, {width:WIDTH,lineGap:0});
    label(`Page ${pageNumber} of ${totalPages}`, LEFT, 824, 110, 7.2);
    label(invoiceFooter.credit, 320, 824, 240, 8, 'right', true);
  };
  const header = (continuation: boolean) => {
    if (logo) {
      try { doc.image(logo, LEFT, 28, { fit: [99, 69] }); }
      catch { label('ARS', LEFT, 43, 100, 25, 'left', true); }
    } else {
      label('ARS', LEFT, 43, 100, 27, 'left', true);
    }
    doc.moveTo(143, 33).lineTo(143, 100).lineWidth(1).strokeColor(LINE).stroke();
    label(safe(company?.companyLegalName, shopName), 155, 30, 285, 14, 'left', true);
    label(safe(contact?.address, ''), 155, 51, 286, 8.5);
    label(safe(contact?.phone, ''), 155, 65, 286, 8.5);
    if (company?.supportEmail) label(company.supportEmail, 155, 79, 286, 8.5);
    doc.save().roundedRect(448, 52, 112, 27, 3).fill(NAVY).restore();
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff')
      .text((Number(contact?.taxRate || 0) > 0 && company?.vatRegistrationNo) ? 'TAX INVOICE' : 'INVOICE',
        452, 59, { width: 105, align: 'center', lineBreak: false });
    doc.moveTo(LEFT, 111).lineTo(RIGHT, 111).lineWidth(1.7).strokeColor('#2878bc').stroke();

    section(LEFT, 124, 248, 85, 'Customer');
    section(295, 124, 265, 85, 'Invoice Details');
    row('Name', safe(tx.customerName, 'Walk-in Customer'), 46, 152, 225, 49);
    row('Address', safe(tx.customerAddress), 46, 169, 225, 49);
    row('Phone', safe(tx.customerPhone), 46, 186, 225, 49);
    row('Invoice No', tx.invoiceNumber, 306, 151, 239, 61);
    row('Date', new Date(tx.date).toLocaleDateString('en-GB'), 306, 166, 239, 61);
    row('Sales Representative', safe(tx.salesRepName, 'Not recorded'), 306, 181, 239, 108);
    // Print metadata and payment type remain visible but compact.
    if (continuation) label('CONTINUED', 306, 197, 96, 7.5, 'left', true);
    label('Payment', 410, 197, 59, 7.5, 'left', true);
    label(safe(tx.paymentMethod), 469, 197, 79, 7.5, 'right');
    return 226;
  };
  const showDiscount = tx.items.some(i=>Number(i.discount||0)>0||Number(i.discountAmount||0)>0);
  const columns = showDiscount ? [35,98,200,316,357,386,440,494,560] : [35,100,218,350,393,425,488,560];
  const tableHeader = (y: number) => {
    doc.rect(LEFT, y, WIDTH, 25).fill(NAVY);
    const headers = ['Product Code','Item Name','Description','U/M','Qty','Rate',...(showDiscount?['Discount']:[]),'Amount'];
    for (let i = 0; i < headers.length; i++) {
      doc.font('Helvetica-Bold').fontSize(i === 1 ? 8.1 : 7.6).fillColor('#ffffff')
      .text(headers[i], columns[i] + 3, y + 8, {
        width: columns[i + 1] - columns[i] - 6,
        align: i >= 4 ? 'right' : 'left',
        lineBreak: false, ellipsis: true,
      });
      doc.strokeColor('#7e9bb7').lineWidth(0.4)
        .moveTo(columns[i], y).lineTo(columns[i], y + 25).stroke();
    }
    doc.moveTo(RIGHT, y).lineTo(RIGHT, y + 25).strokeColor(LINE).stroke();
  };
  const notesAndTotals = (y: number) => {
    const top = y + 14;
    section(LEFT, top, 260, 114, 'Notes');
    label('Please verify quantities and condition upon receipt.', 45, top + 30, 242, 8.2);
    label('Thank you for your business.', 45, top + 43, 242, 8.2);
    box(305, top, 255, 114);
    const knownPaid = tx.paymentMethod === 'Credit Account' ? 0
      : tx.cashReceived != null ? Math.min(Number(tx.total), Math.max(0, Number(tx.cashReceived)))
        : String(tx.paymentStatus || '').toUpperCase() === 'PAID' ? Number(tx.total) : null;
    const summary: [string, string][] = [
      ['Subtotal', formatMoney(Number(tx.subtotal || 0))],
      [tx.wholesaleMeta?.invoiceDiscountMode === 'percent' && Number.isFinite(Number(tx.wholesaleMeta.invoiceDiscountPercent))
        ? `Discount (${Number(tx.wholesaleMeta.invoiceDiscountPercent).toLocaleString('en-US', { maximumFractionDigits: 2 })}%)`
        : tx.wholesaleMeta?.invoiceDiscountMode === 'amount' ? 'Discount (Fixed)' : 'Discount',
        formatMoney(Number(tx.discountAmount || 0))],
      ['Tax', formatMoney(Number(tx.tax || 0))],
      ['Grand Total', formatMoney(Number(tx.total || 0))],
      ['Amount Paid', knownPaid == null ? 'Not recorded' : formatMoney(knownPaid)],
      ['Balance Due', knownPaid == null ? 'Not recorded' : formatMoney(Math.max(0, Number(tx.total) - knownPaid))],
    ];
    summary.forEach(([name, amount], i) => {
      const yy = top + i * 19;
      if (i === 3 || i === 5) doc.rect(305, yy, 255, 19).fill(BLUE);
      if (i !== 0) doc.moveTo(305, yy).lineTo(560, yy).lineWidth(0.4).strokeColor(LINE).stroke();
      label(name, 313, yy + 5, 117, 8.6, 'left', i === 3 || i === 5);
      label(amount, 428, yy + 5, 123, 8.6, 'right', i === 3 || i === 5);
    });
    const signatureY = top + 124;
    const sigs: [string, number][] = [['Prepared By', LEFT], ['Received By', 214], ['Authorized By', 393]];
    sigs.forEach(([name, x]) => {
      section(x, signatureY, 167, 43, name);
      doc.moveTo(x + 16, signatureY + 34).lineTo(x + 151, signatureY + 34)
        .lineWidth(0.6).strokeColor('#475569').stroke();
    });
  };
  let y = header(false);
  tableHeader(y);
  y += 25;
  tx.items.forEach((item, i) => {
    // Name and description are immutable snapshots saved when the sale was issued.
    // The product name already contains the selected variant for newly issued invoices.
    const gross = Number(item.quantity) * Number(item.sellingPrice);
    const lineDisc = Math.min(gross, Math.max(0,gross * Number(item.discount || 0) / 100 + Number(item.discountAmount || 0)));
    const amount = Math.max(0, gross - lineDisc);
    const values = [safe(item.variantSku,item.productId),safe(item.productName),String(item.invoiceDescription||''),safe(item.variantUnit,'-'),String(item.quantity),Number(item.sellingPrice).toFixed(2),...(showDiscount?[lineDisc.toFixed(2)]:[]),amount.toFixed(2)];
    const heights=values.map((v,index)=>{
      doc.font(index===1?'Helvetica-Bold':'Helvetica').fontSize(7.5);
      return Math.ceil(doc.heightOfString(v,{width:columns[index+1]-columns[index]-6,lineGap:0}));
    });
    const height=Math.max(19,...heights.map(h=>h+8));
    if(y+height>590){doc.addPage();y=header(true);tableHeader(y);y+=25;}
    if(i%2)doc.rect(LEFT,y,WIDTH,height).fill('#f0f5fa');
    values.forEach((v,index)=>{
      doc.font(index===1?'Helvetica-Bold':'Helvetica').fontSize(7.5).fillColor(INK).text(v,columns[index]+3,y+4,{width:columns[index+1]-columns[index]-6,lineGap:0,align:index>=4?'right':'left'});
      doc.moveTo(columns[index],y).lineTo(columns[index],y+height).lineWidth(.35).strokeColor(LINE).stroke();
    });
    doc.moveTo(RIGHT,y).lineTo(RIGHT,y+height).strokeColor(LINE).stroke();
    doc.moveTo(LEFT, y + height).lineTo(RIGHT, y + height).strokeColor(LINE).lineWidth(0.45).stroke();
    y += height;
  });
  // One or multiple pages: fit summary and signatures without collision.
  if (y + 14 + 124 + 43 >= 775) {
    doc.addPage();
    y = header(true);
  }
  notesAndTotals(y);
  // PDFKit buffers pages so we can print correct Page X of Y information.
  // Render the complete ARS business header on every page before this stage.
  const range = doc.bufferedPageRange();
  for (let offset = 0; offset < range.count; offset++) {
    doc.switchToPage(range.start + offset);
    footer(offset + 1, range.count);
  }
  doc.end();
});
