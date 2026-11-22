import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const checkout = server.split("// POS Transaction Checkout Route")[1]?.split("app.post('/api/transactions/:id/print'")[0] || '';

test('checkout fails closed on unknown or missing variants', () => {
  assert.match(checkout, /if \(variantId && !targetVariant\)/);
  assert.match(checkout, /if \(!variantId && variants\.length > 0\)/);
  assert.match(checkout, /Selected variant is not available/);
});

test('checkout accepts only database-safe positive whole quantities', () => {
  const validation = server.split('const validateCheckoutPayload')[1]?.split('const normalizeProductVariants')[0] || '';
  assert.match(validation, /Number\.isSafeInteger\(quantity\)/);
  assert.match(checkout, /Number\.isSafeInteger\(requestedQty\)/);
});

test('checkout keeps customer records within their shop', () => {
  assert.match(checkout, /db\.customers\.find\(\(c\) => c\.id === customerId && c\.shopId === activeShopId\)/);
  assert.match(checkout, /db\.customers\.findIndex\(\(c\) => c\.id === customerId && c\.shopId === activeShopId\)/);
  assert.match(checkout, /paymentMethod === 'Credit Account' && !checkoutCustomer/);
});

test('invoice identifiers avoid time-only collisions', () => {
  assert.match(checkout, /tx-\$\{randomUUID\(\)\}/);
  assert.match(checkout, /randomUUID\(\)\.slice\(0, 8\)/);
  assert.match(checkout, /shopProfile\?\.invoicePrefix/);
});
