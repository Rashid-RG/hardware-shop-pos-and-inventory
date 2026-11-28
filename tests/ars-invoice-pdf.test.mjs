import test from 'node:test';
import assert from 'node:assert/strict';
import { renderArsInvoicePdf } from '../src/utils/arsInvoicePdf.ts';

const invoice = (lines = 5) => ({
  id: 'ci-invoice',
  shopId: 'ci-shop',
  invoiceNumber: 'ARS-CI-0001',
  date: '2026-11-24T10:00:00.000Z',
  customerName: 'Test Wholesale Hardware',
  customerPhone: '0770000000',
  customerAddress: 'Galgamuwa, Sri Lanka',
  cashierName: 'Test Cashier',
  paymentMethod: 'Cash',
  paymentStatus: 'PAID',
  items: Array.from({ length: lines }, (_, i) => ({
    productId: 'sku-' + i,
    productName: 'Hardware fastening material ' + (i + 1),
    variantSku: 'SKU-' + (i + 1),
    quantity: 2,
    sellingPrice: 50,
    discount: 0,
    discountAmount: 0,
  })),
  subtotal: lines * 100,
  tax: 0,
  discountAmount: 0,
  total: lines * 100,
  cashReceived: lines * 100,
});

const meta = { copyType: 'Original Copy', printSequence: 1, watermarkText: 'ORIGINAL COPY' };
const company = { companyLegalName: 'ARS Hardware Supplies & Trading', supportEmail: 'test@example.invalid' };

test('approved ARS A4 renderer outputs a nonempty valid PDF with a single page for short sales', async () => {
  const buffer = await renderArsInvoicePdf(invoice(), 'ARS Hardware', meta, null, company, {
    address: 'Example address', phone: '0770000000',
  });
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(buffer.length > 2500, 'PDF must contain content');
  const source = buffer.toString('latin1');
  assert.equal((source.match(/\/Type \/Page\b/g) || []).length, 1);
});

test('long ARS sales continue on multiple A4 pages without crashing', async () => {
  const buffer = await renderArsInvoicePdf(invoice(48), 'ARS Hardware', meta, null, company, {});
  assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  const source = buffer.toString('latin1');
  assert.ok((source.match(/\/Type \/Page\b/g) || []).length > 1);
});
