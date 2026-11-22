import PDFDocument from 'pdfkit';
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
    doc.moveTo(LEFT, 803).lineTo(RIGHT, 803).lineWidth(0.55).strokeColor(LINE).stroke();
    label('Generated with RS Nextward Business Systems', LEFT, 811, 282, 8.2, 'left', true);
    label('Reliable POS  •  Inventory  •  Wholesale Billing', 320, 811, 240, 8.2, 'right');
    label(`Page ${pageNumber} of ${totalPages}`, 448, 785, 112, 8, 'right', true);
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
  const columns = [35, 56, 277, 339, 377, 439, 495, 560];
  const tableHeader = (y: number) => {
    doc.rect(LEFT, y, WIDTH, 25).fill(NAVY);
    const headers = ['#', 'Item Description', 'SKU', 'Qty', 'Unit Price', 'Discount', 'Amount'];
    for (let i = 0; i < headers.length; i++) {
      doc.font('Helvetica-Bold').fontSize(i === 1 ? 8.1 : 7.6).fillColor('#ffffff')
      .text(headers[i], columns[i] + 3, y + 8, {
        width: columns[i + 1] - columns[i] - 6,
        align: i === 0 ? 'center' : i >= 4 ? 'right' : 'left',
        lineBreak: false, ellipsis: true,
      });
      doc.strokeColor('#7e9bb7').lineWidth(0.4)
        .moveTo(columns[i], y).lineTo(columns[i], y + 25).stroke();
    }
    doc.moveTo(RIGHT, y).lineTo(RIGHT, y + 25).strokeColor(LINE).stroke();
  };
  const notesAndTotals = (y: number) => {
    const top = Math.max(y + 16, 581);
    section(LEFT, top, 260, 114, 'Notes');
    label('Goods once sold will be exchanged only with', 45, top + 31, 242, 8.2);
    label('the original invoice and management approval.', 45, top + 44, 242, 8.2);
    label('Thank you for your business.', 45, top + 75, 242, 8.2);
    box(305, top, 255, 114);
    const knownPaid = tx.paymentMethod === 'Credit Account' ? 0
      : tx.cashReceived != null ? Math.min(Number(tx.total), Math.max(0, Number(tx.cashReceived)))
        : String(tx.paymentStatus || '').toUpperCase() === 'PAID' ? Number(tx.total) : null;
    const summary: [string, string][] = [
      ['Subtotal', formatMoney(Number(tx.subtotal || 0))],
      ['Discount', formatMoney(Number(tx.discountAmount || 0))],
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
    const signatureY = top + 130;
    const sigs: [string, number][] = [['Prepared By', LEFT], ['Received By', 214], ['Authorized By', 393]];
    sigs.forEach(([name, x]) => {
      section(x, signatureY, 167, 59, name);
      doc.moveTo(x + 16, signatureY + 47).lineTo(x + 151, signatureY + 47)
        .lineWidth(0.6).strokeColor('#475569').stroke();
    });
  };
  let y = header(false);
  tableHeader(y);
  y += 25;
  tx.items.forEach((item, i) => {
    const desc = item.productName + (item.variantName ? ' (' + item.variantName + ')' : '');
    const gross = Number(item.quantity) * Number(item.sellingPrice);
    const lineDisc = gross * Number(item.discount || 0) / 100 + Number(item.discountAmount || 0);
    const amount = Math.max(0, gross - lineDisc);
    const height = Math.max(21, Math.ceil(desc.length / 42) * 11 + 9);
    // Keep enough room for the notes, totals and all three signatures on the final page.
    // If another item would exceed the item region, continue on a new A4 page.
    if (y + height > 570) {
      doc.addPage();
      y = header(true);
      tableHeader(y);
      y += 25;
    }
    if (i % 2) doc.rect(LEFT, y, WIDTH, height).fill('#f0f5fa');
    const values = [
      String(i + 1), desc, safe(item.variantSku, item.productId),
      String(item.quantity) + (item.variantUnit ? ' ' + item.variantUnit : ''),
      Number(item.sellingPrice).toFixed(2),
      lineDisc.toFixed(2),
      amount.toFixed(2),
    ];
    values.forEach((value, index) =>
      label(value, columns[index] + 3, y + 6, columns[index + 1] - columns[index] - 6,
        7.6, index === 0 ? 'center' : index >= 4 ? 'right' : 'left'));
    doc.moveTo(LEFT, y + height).lineTo(RIGHT, y + height).strokeColor(LINE).lineWidth(0.45).stroke();
    y += height;
  });
  // One or multiple pages: fit summary and signatures without collision.
  if (Math.max(y + 16, 581) + 130 + 59 >= 793) {
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
