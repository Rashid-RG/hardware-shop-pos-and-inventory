import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceTotals, roundMoney } from '../src/utils/invoiceTotals.ts';

test('quotations and register preserve the invoice-wide discount policy', () => {
  assert.deepEqual(invoiceTotals(10000, 10, 1000), {subtotal:10000, tax:1000, total:10000});
  assert.equal(invoiceTotals(10000, 0, 1000).total, 9000);
});
test('line amounts round before tax and final payment', () => {
  assert.deepEqual(invoiceTotals(roundMoney(9.876) * 2, 5, 1), {subtotal:19.76, tax:0.99, total:19.75});
});

test('rejects invalid invoice amounts without propagating NaN or Infinity', () => {
  assert.deepEqual(invoiceTotals(NaN, 18, 100), { subtotal: 0, tax: 0, total: 0 });
  assert.deepEqual(invoiceTotals(Infinity, 18, 100), { subtotal: 0, tax: 0, total: 0 });
  assert.deepEqual(invoiceTotals(-100, 18, -20), { subtotal: 0, tax: 0, total: 0 });
  assert.deepEqual(invoiceTotals(1000, Infinity, NaN), { subtotal: 1000, tax: 0, total: 1000 });
  assert.equal(roundMoney(NaN), 0);
});

test('caps invoice discount at subtotal and keeps the established tax policy', () => {
  assert.deepEqual(invoiceTotals(1000, 10, 999999), { subtotal: 1000, tax: 100, total: 100 });
  assert.deepEqual(invoiceTotals(1000, -10, 250), { subtotal: 1000, tax: 0, total: 750 });
  assert.deepEqual(invoiceTotals(1000, 10, -25), { subtotal: 1000, tax: 100, total: 1100 });
});
