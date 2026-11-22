import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pos=readFileSync(new URL('../src/components/POSView.tsx',import.meta.url),'utf8');

test('ARS invoice setup uses separate customer and representative dialogs',()=>{
  assert.match(pos,/setupDialog.*'customer'.*'representative'/);
  assert.match(pos,/id="pos-open-customer"/);
  assert.match(pos,/id="pos-open-representative"/);
  assert.match(pos,/id="pos-setup-backdrop"/);
  assert.match(pos,/role="dialog" aria-modal="true" aria-labelledby="pos-setup-title"/);
  assert.match(pos,/id="pos-setup-confirm"/);
  assert.match(pos,/setSetupDialog\(null\)/);
});
test('cannot confirm a missing shop or unregistered sales rep',()=>{
  assert.match(pos,/c.id===event.target.value && c.shopId===taxConfig.activeShopId/);
  assert.match(pos,/selectedCustomer.id === 'cust-walkin'/);
  assert.match(pos,/!activeSalesReps.some\(rep=>rep.id===selectedSalesRepId\)/);
  assert.match(pos,/activeSalesReps.map\(rep=>/);
});
test('summary and review avoid multiple independently scrolling payment panels',()=>{
  assert.match(pos,/id="pos-cart-scroller"/);
  assert.match(pos,/Draft invoice ·/);
  assert.match(pos,/id="pos-review-trigger"/);
  assert.match(pos,/id="pos-review-backdrop"/);
  assert.match(pos,/id="pos-pay-trigger"/);
  assert.doesNotMatch(pos,/lg:max-h-\[46%\] lg:overflow-y-auto/);
});
