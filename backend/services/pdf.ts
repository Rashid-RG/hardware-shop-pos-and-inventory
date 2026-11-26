import { renderArsInvoicePdf } from '../../src/utils/arsInvoicePdf';
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

// Keep legacy imports on the same approved monochrome invoice renderer.
export const buildInvoicePdfBuffer = async (
 tx: SalesTransaction,
 activeShopName: string,
 meta: InvoicePdfMeta,
 logoUrl?: string,
 invoiceCompanyMeta?: {
  companyLegalName?: string; companyTagline?: string; businessRegistrationNo?: string;
  vatRegistrationNo?: string; tinNo?: string; supportPhone?: string; supportEmail?: string;
  websiteUrl?: string; socialLinks?: string;
 },
 contact?: { address?: string; phone?: string; email?: string; taxRate?: number },
): Promise<Buffer> => renderArsInvoicePdf(tx, activeShopName, meta, resolvePrintableLogoBuffer(logoUrl), invoiceCompanyMeta, contact, 'A4');
