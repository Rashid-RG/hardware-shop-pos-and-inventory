import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pos=readFileSync(new URL('../src/components/POSView.tsx',import.meta.url),'utf8');
const quote=readFileSync(new URL('../src/components/QuotationView.tsx',import.meta.url),'utf8');

test('ARS setup keeps shop and Sales Representative in independently accessible dialogs',()=>{
  assert.match(pos,/id="pos-open-customer"/);
  assert.match(pos,/id="pos-open-representative"/);
  assert.match(pos,/setupDialog === 'customer'/);
  assert.match(pos,/id="pos-customer-select"/);
  assert.match(pos,/id="pos-sales-representative"/);
  assert.match(pos,/value=\{draftRepId\}/);
  assert.match(pos,/onChange=\{event=>setDraftRepId/);
});
test('secondary buyer details stay in the setup dialog and final payment is separately reviewed',()=>{
  assert.match(pos,/id="pos-setup-backdrop"/);
  assert.match(pos,/max-h-\[min\(88dvh,700px\)\]/);
  assert.match(pos,/id="pos-setup-confirm"/);
  assert.match(pos,/Delivery, transport and warranty details \(optional\)/);
  assert.match(pos,/lg:h-\[calc\(100dvh-238px\)\]/);
  assert.match(pos,/id="pos-pay-trigger"/);
  assert.match(pos,/id="pos-review-backdrop"/);
});
test('quotation editor uses one bounded scrolling body with persistent header and total actions',()=>{
  assert.match(quote,/max-h-\[min\(92dvh,900px\)\]/);
  assert.match(quote,/min-h-0 flex-1 overflow-y-auto/);
  assert.match(quote,/shrink-0 items-center justify-between/);
  assert.match(quote,/Additional notes \(optional\)/);
  assert.match(quote,/Save Quotation/);
});
