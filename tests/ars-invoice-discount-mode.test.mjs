import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const pos=readFileSync(new URL('../src/components/POSView.tsx',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const totals=readFileSync(new URL('../src/utils/invoiceTotals.ts',import.meta.url),'utf8');

test('cashier can choose fixed or percent invoice-level discount in final payment review',()=>{
  assert.match(pos,/id="pos-discount-amount"/);
  assert.match(pos,/id="pos-discount-percent"/);
  assert.match(pos,/aria-label="Invoice discount type"/);
  assert.match(pos,/id="pos-cart-discount-input"/);
  assert.match(pos,/discountMode === 'percent'/);
  assert.match(pos,/setDiscountInput\('0'\)/);
  assert.ok(pos.indexOf('id="pos-cart-discount-input"')>pos.indexOf('id="pos-review-backdrop"'));
});
test('discount percentage becomes money before API checkout and cannot exceed the item subtotal',()=>{
  assert.match(pos,/Math\.min\(100, normalizedDiscountInput\)/);
  assert.match(pos,/Math\.min\(subtotal,/);
  assert.match(pos,/roundMoney\(Math\.min\(subtotal/);
  assert.match(pos,/invoiceTotals\(subtotal, taxConfig.taxRate, cashDiscount\)/);
  assert.match(pos,/discountAmount: cashDiscount/);
  assert.match(server,/invoiceTotals\(subtotal, shopProfile\?\.taxRate \?\? db\.settings\.taxRate, discountAmount\)/);
  assert.match(totals,/const appliedDiscount = Math\.min\(subtotal, nonNegativeMoney\(discount\)\)/);
  assert.match(totals,/subtotal - appliedDiscount \+ tax/);
});
test('invoice discount type resets for a new customer invoice and includes a visible amount preview',()=>{
  assert.match(pos,/setDiscountMode\('amount'\)/);
  assert.match(pos,/Discount is limited to/);
  assert.match(pos,/formatMoney\(cashDiscount\)/);
  assert.match(pos,/Invoice discount percentage/);
  assert.match(pos,/Invoice discount amount in rupees/);
});

test('A4 reprints retain the exact entered discount type through the persisted invoice metadata',()=>{
  const pdf=readFileSync(new URL('../src/utils/arsInvoicePdf.ts',import.meta.url),'utf8');
  const db=readFileSync(new URL('../backend/db.ts',import.meta.url),'utf8');
  const types=readFileSync(new URL('../src/types.ts',import.meta.url),'utf8');
  assert.match(types,/invoiceDiscountMode\?: 'amount' \| 'percent'/);
  assert.match(types,/invoiceDiscountPercent\?: number/);
  assert.match(pos,/wholesaleMeta: \{/);
  assert.match(pos,/invoiceDiscountMode: discountMode/);
  assert.match(pos,/invoiceDiscountPercent: discountMode === 'percent'/);
  assert.match(db,/wholesale_meta JSONB/);
  assert.match(db,/tx\.wholesaleMeta \? JSON\.stringify\(tx\.wholesaleMeta\) : null/);
  assert.match(db,/wholesaleMeta: row\.wholesale_meta \|\| undefined/);
  assert.match(pdf,/tx\.wholesaleMeta\?\.invoiceDiscountMode === 'percent'/);
  assert.match(pdf,/Discount \(Fixed\)/);
  assert.match(pdf,/invoiceDiscountPercent/);
});
test('server verifies percent discount label corresponds with authoritative line subtotal',()=>{
  assert.match(server,/if \(mode === 'percent'\)/);
  assert.match(server,/Invoice discount percentage must be between 0 and 100/);
  assert.match(server,/Invoice percentage discount does not match the discounted amount/);
});
test('desktop product workspace is larger than compact invoice panel and supports four product columns',()=>{
  assert.match(pos,/lg:col-span-8 flex flex-col space-y-3/);
  assert.match(pos,/lg:col-span-4 bg-white rounded-xl/);
  assert.match(pos,/sm:grid-cols-3 xl:grid-cols-4/);
});
