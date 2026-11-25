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
  const header = (continued: boolean) => {
    if (isArsPrintBrand(shopName)) {
      doc.save().translate(left, 23).scale(41 / 615).translate(-245, -320)
        .path(arsPrintLogoPath).fill('#000000', 'even-odd').restore();
    } else if (logo) {
      try { doc.image(logo, left, 14, { fit: [48, 48] }); }
      catch { text(shopName, left, 24, 74, 12, true); }
    }
    text(arsDisplayName(safe(company?.companyLegalName, shopName)), 85, 18, 218, 16, true);
    doc.font('Helvetica').fontSize(9).fillColor(ink)
      .text(contact?.address || '', 85, 42, { width: 213, height: 28, ellipsis: true });
    text([contact?.phone, company?.supportEmail || contact?.email].filter(Boolean).join('   |   '), 85, 72, 216, 7.8);
    line(306, 16, 306, 106);
    outline(318, 16, 251, 22);
    const title = taxRate > 0 && company?.vatRegistrationNo ? 'TAX INVOICE' : 'CUSTOMER INVOICE';
    text(title + (continued ? '  (CONTINUED)' : ''), 318, 20, 251, 12, true, 'center', ink);
    field('Invoice No', tx.invoiceNumber, 324, 46, 52, 245);
    field('Issued At', new Date(tx.date).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }), 324, 61, 52, 245);
    field('Payment', safe(tx.paymentMethod), 324, 76, 52, 245);
    field('Currency', 'LKR (Rs.)', 324, 91, 52, 245);
    line(left, 116, right, 116);
    outline(left, 131, 264, 21);
    outline(304, 131, 265, 21);
    sectionIcon('person', left + 8, 135);
    text('Customer Details', left + 27, 135, 240, 12, true, 'left', ink);
    sectionIcon('calendar', 313, 135);
    text('Invoice Details', 331, 135, 245, 12, true, 'left', ink);
    line(297, 131, 297, 223);
    field('Customer', safe(tx.customerName, 'Walk-in Customer'), 36, 163, 48, 249);
    field('Address', safe(tx.customerAddress), 36, 184, 48, 249);
    field('Phone', safe(tx.customerPhone), 36, 207, 48, 249);
    field('Sales Rep.', safe(tx.salesRepName, 'Not recorded'), 315, 162, 59, 245);
    field('Line Items', String(tx.items.length), 315, 178, 59, 245);
    field('Tax Rate', taxRate.toLocaleString('en-US', {minimumFractionDigits:1}) + '%', 315, 194, 59, 245);
    if (tx.paymentMethod === 'Credit Account' && tx.creditDueDate && /^\d{4}-\d{2}-\d{2}$/.test(tx.creditDueDate)) {
      field('Due Date', tx.creditDueDate.split('-').reverse().join('/'), 315, 210, 59, 245);
    }
  };
  const cols = [left, 46, 110, 208, 292, 324, 348, 421, 493, right];
  const headings = ['#', 'Product Code', 'Item Name', 'Description', 'U/M', 'Qty', 'Rate', 'Discount', 'Amount'];
  const alignments: Align[] = ['center', 'left', 'left', 'left', 'center', 'center', 'right', 'right', 'right'];
  const tableStart = (continued: boolean) => {
    header(continued);
    headings.forEach((name, i) => text(name, cols[i] + 4, 246, cols[i+1] - cols[i] - 8, 8.5, true, alignments[i], ink));
    line(left, 261, right, 261);
    return 261;
  };
  const footerY = 768;
  const summaryHeight = 212;
  const closeTable = (bottom: number) => {
    doc.rect(left, 239, width, bottom - 239).lineWidth(0.7).strokeColor(rule).stroke();
  };
  let y = tableStart(false);
  tx.items.forEach((item, index) => {
    const gross = Number(item.quantity) * Number(item.sellingPrice);
    const discount = Math.min(gross, Math.max(0, gross * Number(item.discount || 0) / 100 + Number(item.discountAmount || 0)));
    const values = [String(index + 1), safe(item.variantSku, item.productId), safe(item.productName),
      String(item.invoiceDescription || '').trim(), invoiceUnit(item), String(item.quantity),
      formatMoney(Number(item.sellingPrice)), discount ? formatMoney(discount) : '-', formatMoney(gross - discount)];
    const heights = values.map((value, i) => doc.font(i === 8 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.4)
      .heightOfString(value, { width: cols[i+1] - cols[i] - 8 }));
    const height = Math.max(15, Math.ceil(Math.max(...heights)) + 4);
    const limit = index === tx.items.length - 1 ? footerY - summaryHeight : footerY - 8;
    if (y + height > limit && y > 261) { closeTable(y); doc.addPage(); y = tableStart(true); }
    values.forEach((value, i) => {
      doc.font(i === 8 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.4).fillColor(ink)
        .text(value, cols[i]+4, y+2, { width: cols[i+1]-cols[i]-8, align: alignments[i] });
    });
    y += height;
  });
  closeTable(y);
  if (y + summaryHeight > footerY) { doc.addPage(); header(true); y = 239; }
  const top = y + 16;
  outline(left, top, 264, 102);
  line(left, top + 24, left + 264, top + 24);
  sectionIcon('note', 35, top+5);
  text('Notes', 54, top + 6, 225, 12, true, 'left', ink);
  doc.rect(36, top+37, 4, 4).fill(ink);
  doc.rect(36, top+80, 4, 4).fill(ink);
  doc.font('Helvetica').fontSize(10).fillColor(ink).text('Goods once sold will be exchanged only with original invoice and management approval.', 48, top+35, {width:232});
  text('Thank you for your business.', 48, top+78, 232);
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
  const signatureY = footerY - 64;
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
