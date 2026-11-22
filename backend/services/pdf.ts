import { invoiceFooter } from '../../src/utils/invoiceFooter';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { SalesTransaction, InvoiceCopyType } from '../../src/types';

export type InvoicePdfMeta = {
  copyType: InvoiceCopyType;
  printSequence: number;
  watermarkText: string;
  secondaryWatermarkText?: string;
  printedBy?: string;
  printedAt?: string;
};

export const resolvePrintableLogoBuffer = (logoUrl?: string): Buffer | null => {
  const normalized = String(logoUrl || '').trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('data:image/')) {
    const match = normalized.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
    if (!match) {
      return null;
    }
    return Buffer.from(match[1], 'base64');
  }

  if (normalized.startsWith('/')) {
    const filePath = path.join(process.cwd(), normalized.replace(/^\/+/, ''));
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
  }

  return null;
};

export const buildInvoicePdfBuffer = async (
  tx: SalesTransaction,
  activeShopName: string,
  meta: InvoicePdfMeta,
  logoUrl?: string,
  invoiceCompanyMeta?: {
    companyLegalName?: string;
    companyTagline?: string;
    businessRegistrationNo?: string;
    vatRegistrationNo?: string;
    tinNo?: string;
    supportPhone?: string;
    supportEmail?: string;
    websiteUrl?: string;
    socialLinks?: string;
  },
  contact?: { address?: string; phone?: string }
): Promise<Buffer> => {
  const logoBuffer = resolvePrintableLogoBuffer(logoUrl);

  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: `Invoice ${tx.invoiceNumber}`,
        Author: activeShopName,
        Subject: `${meta.copyType} export`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (error) => reject(error));

    const customerName = tx.customerName || 'Walk-in Customer';
    const companyLegalName = String(invoiceCompanyMeta?.companyLegalName || activeShopName);
    const companyTagline = String(invoiceCompanyMeta?.companyTagline || 'Hardware Wholesale & Retail');
    const paymentStatus = String(tx.paymentStatus || (tx.paymentMethod === 'Credit Account' ? 'CREDIT SALE' : 'PAID'));
    const wmOpacity = 0.12;

    if (logoBuffer) {
      doc.image(logoBuffer, 40, 40, { fit: [120, 50] });
      doc.y = 96;
    }

    const headerTop = doc.y;
    doc.save();
    doc.opacity(wmOpacity);
    doc.fontSize(56);
    doc.fillColor('#cbd5e1');
    doc.rotate(-32, { origin: [260, 410] });
    doc.text(meta.watermarkText, 130, 380, { width: 340, align: 'center' });
    if (meta.secondaryWatermarkText) {
      doc.fontSize(36);
      doc.text(meta.secondaryWatermarkText, 150, 445, { width: 310, align: 'center' });
    }
    doc.restore();
    doc.opacity(1);

    doc.fillColor('#0f172a').fontSize(22).font('Helvetica-Bold').text(companyLegalName, 40, headerTop);
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica').fillColor('#475569');
    doc.text(companyTagline);
    if (contact?.address) doc.text(contact.address);
    if (contact?.phone) doc.text(contact.phone);
    doc.text(`BR No: ${String(invoiceCompanyMeta?.businessRegistrationNo || '-')}`);
    doc.text(`VAT No: ${String(invoiceCompanyMeta?.vatRegistrationNo || '-')}`);
    doc.text(`TIN No: ${String(invoiceCompanyMeta?.tinNo || '-')}`);
    doc.text(`Invoice No: ${tx.invoiceNumber}`);
    doc.text(`Invoice Date: ${new Date(tx.date).toLocaleString()}`);
    doc.text(`Copy Type: ${meta.copyType}`);
    doc.text(`Print Sequence: ${meta.printSequence}`);
    if (meta.printedBy) {
      doc.text(`Printed By: ${meta.printedBy}`);
    }
    if (meta.printedAt) {
      doc.text(`Printed At: ${new Date(meta.printedAt).toLocaleString()}`);
    }
    doc.text(`Payment Status: ${paymentStatus}`);
    doc.text(`Customer: ${customerName}`);
    doc.text(`Customer Phone: ${tx.customerPhone || '-'}`);
    doc.text(`Customer Address: ${tx.customerAddress || '-'}`);
    doc.text(`Cashier: ${tx.cashierName}`);
    doc.text(`Payment Method: ${tx.paymentMethod}`);

    doc.moveDown(0.8);
    doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold');
    doc.text('Item Code', 40, doc.y, { width: 65 });
    doc.text('Product', 108, doc.y - 12, { width: 126 });
    doc.text('Variant', 235, doc.y - 12, { width: 78 });
    doc.text('Qty', 316, doc.y - 12, { width: 32, align: 'right' });
    doc.text('Unit', 352, doc.y - 12, { width: 68, align: 'right' });
    doc.text('Disc', 422, doc.y - 12, { width: 46, align: 'right' });
    doc.text('Amount', 470, doc.y - 12, { width: 85, align: 'right' });
    doc.moveTo(40, doc.y + 4).lineTo(555, doc.y + 4).stroke('#cbd5e1');
    doc.moveDown(0.8);

    tx.items.forEach((item) => {
      const rowTop = doc.y;
      const gross = Number(item.sellingPrice || 0) * Number(item.quantity || 0);
      const percentAdjusted = gross * (1 - Number(item.discount || 0) / 100);
      const rupeeDiscount = Math.min(percentAdjusted, Number(item.discountAmount || 0));
      const lineTotal = Math.max(0, percentAdjusted - rupeeDiscount);
      const discountLabel = Number(item.discount || 0) > 0
        ? `${Number(item.discount).toFixed(0)}%`
        : (rupeeDiscount > 0 ? `Rs.${rupeeDiscount.toFixed(2)}` : '-');

      doc.fillColor('#111827').font('Helvetica').fontSize(9).text(item.variantSku || item.productId || '-', 40, rowTop, { width: 65 });
      doc.text(item.productName, 108, rowTop, { width: 126 });
      doc.text(item.variantName || '-', 235, rowTop, { width: 78 });
      doc.text(String(item.quantity), 316, rowTop, { width: 32, align: 'right' });
      doc.text(`Rs.${Number(item.sellingPrice || 0).toFixed(2)}`, 352, rowTop, { width: 68, align: 'right' });
      doc.text(discountLabel, 422, rowTop, { width: 46, align: 'right' });
      doc.text(`Rs.${lineTotal.toFixed(2)}`, 470, rowTop, { width: 85, align: 'right' });
      doc.moveDown(0.9);
      if (doc.y > 700) {
        doc.addPage();
      }
    });

    const wholesaleMeta = tx.wholesaleMeta || {};
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text('Hardware Business Information', 40, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor('#334155');
    doc.text(`Transport Charges: Rs.${Number(wholesaleMeta.transportCharges || 0).toFixed(2)}`);
    doc.text(`Delivery Charges: Rs.${Number(wholesaleMeta.deliveryCharges || 0).toFixed(2)}`);
    doc.text(`Warranty: ${String(wholesaleMeta.warrantyInformation || '-')}`);
    doc.text(`Dispatch Method: ${String(wholesaleMeta.dispatchMethod || '-')}`);
    doc.text(`Vehicle No: ${String(wholesaleMeta.vehicleNumber || '-')}`);
    doc.text(`Delivery Note No: ${String(wholesaleMeta.deliveryNoteNumber || '-')}`);
    doc.text(`Batch No: ${String(wholesaleMeta.batchNumber || '-')}`);
    doc.text(`Supplier Reference: ${String(wholesaleMeta.supplierReference || '-')}`);
    doc.text(`Delivery Status: ${String(wholesaleMeta.deliveryStatus || '-')}`);

    doc.moveDown(0.8);
    doc.moveTo(360, doc.y).lineTo(555, doc.y).stroke('#cbd5e1');
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(10).fillColor('#334155');
    doc.text(`Subtotal: Rs.${Number(tx.subtotal || 0).toFixed(2)}`, 360, doc.y, { width: 195, align: 'right' });
    doc.text(`Discount: Rs.${Number(tx.discountAmount || 0).toFixed(2)}`, 360, doc.y + 2, { width: 195, align: 'right' });
    doc.text(`Tax: Rs.${Number(tx.tax || 0).toFixed(2)}`, 360, doc.y + 2, { width: 195, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#1d4ed8');
    doc.text(`Total: Rs.${Number(tx.total || 0).toFixed(2)}`, 360, doc.y + 4, { width: 195, align: 'right' });

    doc.moveDown(2);
    doc.font('Helvetica').fontSize(9).fillColor('#64748b');
    doc.text(invoiceFooter.goods, 40, doc.y, { width: 515, align: 'center' });
    doc.text(invoiceFooter.thanks, 40, doc.y, { width: 515, align: 'center' });
    doc.fontSize(8).text(invoiceFooter.credit, 40, doc.y + 2, { width: 515, align: 'center' });
    const supportLine = `Support: ${String(invoiceCompanyMeta?.supportPhone || '-')} | ${String(invoiceCompanyMeta?.supportEmail || '-')}`;
    doc.text(supportLine, 40, doc.y + 24, { width: 515, align: 'center' });

    doc.end();
  });
};