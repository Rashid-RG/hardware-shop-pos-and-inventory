import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { renderArsInvoicePdf } from '../src/utils/arsInvoicePdf.ts';

// PDFKit uses standard Helvetica fonts and hexadecimal text runs for this invoice.
function pageTexts(pdf) {
  return Array.from(pdf.toString('latin1').matchAll(/\bstream\r?\n([\s\S]*?)\r?\nendstream/g), stream => {
    const instructions = inflateSync(Buffer.from(stream[1], 'latin1')).toString('latin1');
    return Array.from(instructions.matchAll(/\[([^\]]*)\]\s*TJ/g), row =>
      Array.from(row[1].matchAll(/<([\da-f]+)>/gi), run => Buffer.from(run[1], 'hex').toString('latin1')).join('')
    ).join(' ');
  });
}

for (const count of [4, 48]) {
  test('portrait invoice preserves layout and all saved rows for ' + count + ' items', async () => {
    const items = Array.from({ length: count }, (_, i) => ({
      productId: 'SKU-' + (i + 100), productName: 'Steel bolts',
      invoiceDescription: i % 2 ? 'Original box with the full saved description' : undefined,
      quantity: 1, sellingPrice: 100,
    }));
    const pdf = await renderArsInvoicePdf({
      items, invoiceNumber: 'ARS-TEST', date: '2026-11-24T08:00:00Z', customerName: 'Test buyer',
      salesRepName: 'Sales rep', paymentMethod: 'Cash', subtotal: count*100, total: count*100, cashReceived: count*100+500, changeDue: 500,
    }, 'ARS Hardware', { watermarkText:'SHOP STAMP / PAID / AUTHORIZED' }, null);
    assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
    const pages = pageTexts(pdf);
    if (count === 4) assert.equal(pages.length, 1);
    else assert.ok(pages.length > 1);
    pages.forEach((page, i) => {
      for (const label of ['ARS Distributor', 'CUSTOMER INVOICE', 'ARS-TEST', 'Test buyer', 'Sales rep',
        'RS Nextward', 'Smart systems for business.', 'Page ' + (i+1) + ' of ' + pages.length]) assert.ok(page.includes(label), label);
      for (const label of ['Prepared By', 'Received By', 'Authorized By']) {
        assert.equal(page.includes(label), i === pages.length-1, label);
      }
      assert.doesNotMatch(page, /SHOP STAMP|Cash Received|Change Due|Amount Paid|Balance Due/);
    });
    const printed = pages.join(' ').replace(/\s+/g, ' ');
    assert.deepEqual(printed.match(/SKU-\d+/g), items.map(item => item.productId));
    assert.equal(printed.match(/Original box with the full saved description/g)?.length, count / 2);
  });
}

test('four saved packaging units print beside quantity on one portrait page', async () => {
  const items = [
    { productName: 'Floor tiles · Box of 4 tiles', invoiceDescription: '' },
    { productName: 'Door hinges', invoiceDescription: 'Pair' },
    { productName: 'Cutting discs', invoiceDescription: 'Pack of 10' },
    { productName: 'Bolts', invoiceDescription: 'Pack of 10', variantUnit: 'Case' },
  ].map((item, i) => ({ ...item, productId: String(i), sellingPrice: 10, quantity: 1 }));
  const pdf = await renderArsInvoicePdf({
    items, invoiceNumber: 'UNIT-TEST', date: '2026-11-24', subtotal: 40, total: 40,
  }, 'ARS Hardware', {}, null);
  const pages = pageTexts(pdf);
  assert.equal(pages.length, 1);
  assert.match(pages[0], /U\/M Qty/);
  for (const unit of ['Box', 'Pair', 'Pack', 'Case']) assert.ok(pages[0].includes(unit + ' 1 Rs.'));
});
