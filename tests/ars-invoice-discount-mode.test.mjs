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
  assert.match(totals,/subtotal - Math\.max\(0, discount\)/);
});
test('invoice discount type resets for a new customer invoice and includes a visible amount preview',()=>{
  assert.match(pos,/setDiscountMode\('amount'\)/);
  assert.match(pos,/Discount is limited to/);
  assert.match(pos,/formatMoney\(cashDiscount\)/);
  assert.match(pos,/Invoice discount percentage/);
  assert.match(pos,/Invoice discount amount in rupees/);
});
