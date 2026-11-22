import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pos=readFileSync(new URL('../src/components/POSView.tsx',import.meta.url),'utf8');
const quote=readFileSync(new URL('../src/components/QuotationView.tsx',import.meta.url),'utf8');

test('ARS checkout keeps shop and Sales Representative visible before the cart',()=>{
  const buyer=pos.indexOf('id="pos-customer-select"');
  const rep=pos.indexOf('id="pos-sales-representative"');
  const cart=pos.indexOf('id="pos-cart-scroller"');
  assert.ok(buyer>0&&buyer<rep&&rep<cart);
  assert.match(pos,/value=\{selectedSalesRepId\}/);
  assert.match(pos,/onChange=\{\(event\) => setSelectedSalesRepId/);
});
test('secondary buyer details and optional shipping fields do not take default viewport height',()=>{
  assert.match(pos,/<details[^>]*id="pos-customer-details"/);
  assert.match(pos,/<summary[^>]*>Customer credit and purchase history<\/summary>/);
  assert.match(pos,/Delivery, transport and warranty details \(optional\)/);
  assert.match(pos,/lg:h-\[calc\(100dvh-150px\)\]/);
  assert.match(pos,/lg:overflow-y-auto/);
  assert.match(pos,/id="pos-pay-trigger"/);
});
test('quotation editor uses one bounded scrolling body with persistent header and total actions',()=>{
  assert.match(quote,/max-h-\[min\(92dvh,900px\)\]/);
  assert.match(quote,/min-h-0 flex-1 overflow-y-auto/);
  assert.match(quote,/shrink-0 items-center justify-between/);
  assert.match(quote,/Additional notes \(optional\)/);
  assert.match(quote,/Save Quotation/);
});
