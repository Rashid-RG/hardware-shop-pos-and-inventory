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
