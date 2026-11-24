import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateImportLandedCost } from '../src/utils/importLandedCost.ts';

test('allocates import freight, duty and clearing accurately in LKR', () => {
  const estimate = estimateImportLandedCost({
    currency: 'CNY', exchangeRateLkr: 42,
    freightLkr: 5000, dutiesLkr: 2500, clearanceLkr: 1200, otherLkr: 300,
    lines: [
      { sku: 'CN-100', description: 'Imported item A', quantity: 100, unitForeign: 2 },
      { sku: 'CN-200', description: 'Imported item B', quantity: 50, unitForeign: 4 },
    ],
  });
  assert.equal(estimate.goodsTotalLkr, 16800);
  assert.equal(estimate.chargesTotalLkr, 9000);
  assert.equal(estimate.grandTotalLkr, 25800);
  assert.equal(estimate.detail.reduce((sum, row) => sum + row.allocatedChargesLkr, 0), 9000);
  assert.equal(estimate.detail.reduce((sum, row) => sum + row.landedTotalLkr, 0), 25800);
  assert.equal(estimate.detail[0].landedUnitCostLkr, 129);
  assert.equal(estimate.detail[1].landedUnitCostLkr, 258);
});
test('does not accept negative shipping, invalid quantities or exchange rates', () => {
  const base = { currency: 'CNY', exchangeRateLkr: 40, freightLkr: 0, dutiesLkr: 0,
    clearanceLkr: 0, otherLkr: 0, lines: [{ sku: 'SKU-1', description: '', quantity: 2, unitForeign: 4 }] };
  assert.throws(() => estimateImportLandedCost({ ...base, freightLkr: -100 }));
  assert.throws(() => estimateImportLandedCost({ ...base, exchangeRateLkr: 0 }));
  assert.throws(() => estimateImportLandedCost({ ...base, lines: [{ ...base.lines[0], quantity: -1 }] }));
  assert.throws(() => estimateImportLandedCost({ ...base, lines: [] }));
});
test('invoice allocation reconciles cents without lost rounding remainders', () => {
  const estimate = estimateImportLandedCost({
    currency: 'USD', exchangeRateLkr: 300, freightLkr: 10.01, dutiesLkr: 0,
    clearanceLkr: 0, otherLkr: 0,
    lines: [1, 2, 3].map((id) => ({ sku: 'SKU-' + id, description: '', quantity: 1, unitForeign: 1 })),
  });
  const allocatedCents = estimate.detail.reduce((n, row) => n + Math.round(row.allocatedChargesLkr * 100), 0);
  assert.equal(allocatedCents, 1001);
  assert.equal(estimate.grandTotalLkr, 910.01);
});
test('wholesale import planner is exposed only to manager role in navigation', () => {
  const sidebar = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /id: 'imports', label: 'Import Landed Costs', icon: Ship, roles: MANAGERS/);
  assert.match(sidebar, /Wholesale Invoices/);
  assert.match(app, /<ImportCostPlanner/);
  assert.doesNotMatch(sidebar, /New Sale \/ POS/);
});

test('tiny freight allocations never produce a negative final line',()=>{
 const result=estimateImportLandedCost({currency:'LKR',exchangeRateLkr:1,freightLkr:0.03,dutiesLkr:0,clearanceLkr:0,otherLkr:0,lines:Array.from({length:6},(_,i)=>({sku:'SKU-'+i,description:'',quantity:1,unitForeign:1}))});
 assert.deepEqual(result.detail.map(r=>r.allocatedChargesLkr),[0.01,0.01,0.01,0,0,0]);
 assert.equal(result.grandTotalLkr,6.03);
});
test('zero-value merchandise receives no proportional import charge',()=>{
 const result=estimateImportLandedCost({currency:'LKR',exchangeRateLkr:1,freightLkr:0.01,dutiesLkr:0,clearanceLkr:0,otherLkr:0,lines:[{sku:'A',description:'',quantity:1,unitForeign:100},{sku:'B',description:'',quantity:1,unitForeign:0}]});
 assert.equal(result.detail[0].allocatedChargesLkr,0.01);
 assert.equal(result.detail[1].allocatedChargesLkr,0);
});
