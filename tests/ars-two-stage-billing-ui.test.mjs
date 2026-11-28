import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pos=readFileSync(new URL('../src/components/POSView.tsx',import.meta.url),'utf8');

test('ARS creates draft invoice before revealing payment controls',()=>{
  const review=pos.indexOf('id="pos-review-trigger"');
  const modal=pos.indexOf('id="pos-review-backdrop"');
  const arrangement=pos.indexOf('Invoice & payment arrangement');
  const save=pos.indexOf('id="pos-pay-trigger"');
  assert.ok(review>0&&modal>review&&arrangement>modal&&save>arrangement);
  assert.match(pos,/setIsReviewOpen\(true\)/);
  assert.match(pos,/role="dialog" aria-modal="true"/);
  assert.match(pos,/Back to invoice/);
  assert.match(pos,/isReviewOpen && createPortal\(/);
  assert.match(pos,/id="pos-review-backdrop" className="fixed inset-0/);
  assert.match(pos,/max-h-full w-full max-w-6xl flex-col overflow-hidden/);
  assert.match(pos,/root\.inert = true/);
});
test('review requires same registered customer and representative as server-side checkout',()=>{
  assert.match(pos,/customers\.some\(c => c.id === selectedCustomer.id && c.shopId === taxConfig.activeShopId\)/);
  assert.match(pos,/activeSalesReps\.some\(rep => rep.id === selectedSalesRepId\)/);
  assert.match(pos,/if \(!activeSalesReps\.some\(rep => rep.id === selectedSalesRepId\)\)/);
  assert.match(pos,/setIsReviewOpen\(false\);\s*setReceiptModel\(txWithQr\)/);
});
test('failed or cancelled review cannot mark an invoice as saved',()=>{
  assert.match(pos,/Final review · no invoice saved yet/);
  assert.match(pos,/onClick=\{\(\) => setIsReviewOpen\(false\)\}/);
  assert.match(pos,/onClick=\{handleCheckout\}/);
  assert.match(pos,/disabled=\{cart.length === 0 \|\| isSubmitting \|\|/);
});
test('empty state distinguishes missing catalog records from filtering',()=>{
  assert.match(pos,/No products registered yet/);
  assert.match(pos,/Clear product filters/);
  assert.match(pos,/No registered customer shops/);
});

test('wholesale invoices default to credit and do not require retail cash tender',()=>{
  assert.match(pos,/const \[paymentMethod, setPaymentMethod\] = useState<[^\n]+>\('Credit Account'\)/);
  assert.match(pos,/setPaymentMethod\('Credit Account'\)/);
  assert.match(pos,/label: 'Pay later'/);
  assert.doesNotMatch(pos,/id="pos-cash-received-input"|Cash received is less than the bill total|Exact cash/);
  assert.match(pos,/paymentMethod === 'Credit Account' && !creditAccountAllowed/);
  assert.match(pos,/paymentMethod !== 'Credit Account' && !window\.confirm/);
  assert.match(pos,/cashReceived: paymentMethod === 'Cash' \? total : undefined/);
  assert.match(pos,/paymentStatus: paymentMethod === 'Credit Account'\s*\? 'CREDIT SALE'\s*:\s*'PAID'/);
  assert.match(pos,/No cash is collected at this step/);
  assert.match(pos,/<span>Product \/ description<\/span><span>U\/M<\/span>/);
});
