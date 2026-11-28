import test from 'node:test';
import assert from 'node:assert/strict';
import { inReportPeriod, lineProfit, reportDay, reportTime, saleProfit } from '../src/utils/reporting.ts';

test('Colombo business days include both ends of the local day at millisecond precision', () => {
  const day = '2026-11-24';
  for (const [timestamp, expected] of [
    ['2026-11-23T18:29:59.999Z', false],
    ['2026-11-23T18:30:00.000Z', true],
    ['2026-11-23T19:00:00.000Z', true],
    ['2026-11-24T18:29:59.999Z', true],
    ['2026-11-24T18:30:00.000Z', false],
  ]) assert.equal(inReportPeriod(timestamp, day, day), expected);
  assert.equal(reportDay(day), day);
  assert.equal(reportTime('2026-11-23T19:00:00Z'), day + ' 00:30:00 +05:30');
  assert.equal(reportTime(''), '');
});

test('invoice and product profits preserve historic zero costs and handle missing snapshots', () => {
  const costs = new Map([['part', 75], ['free', 0]]);
  const line = {productId:'part', sellingPrice:100, quantity:1, costPrice:0};
  assert.equal(lineProfit(line, costs), 100);
  assert.equal(lineProfit({...line, costPrice:40}, costs), 60);
  assert.equal(lineProfit({...line, costPrice:undefined}, costs), 25);
  assert.equal(lineProfit({...line, productId:'free', costPrice:undefined}, costs), 100);
  assert.equal(lineProfit({...line, productId:'unknown', costPrice:undefined}, costs), 0);
  const tx = {items:[{...line, discount:10, discountAmount:5}], discountAmount:7};
  assert.equal(saleProfit(tx, costs), 78);
  assert.equal(saleProfit({...tx,status:'Refunded'}, costs), 0);
});
