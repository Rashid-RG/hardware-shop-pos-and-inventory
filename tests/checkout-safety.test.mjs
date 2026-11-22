import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const checkout = server.split("// POS Transaction Checkout Route")[1]?.split("app.post('/api/transactions/:id/print'")[0] || '';
const dbHelper = readFileSync(new URL('../backend/db.ts', import.meta.url), 'utf8');
const atomicCheckout = dbHelper.split('export const checkoutTransaction = ')[1]?.split('export const refundTransaction')[0] || '';

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
  assert.match(atomicCheckout, /SELECT \* FROM customers WHERE id = \$1 AND shop_id = \$2 FOR UPDATE/);
  assert.match(checkout, /paymentMethod === 'Credit Account' && !checkoutCustomer/);
});

test('invoice identifiers avoid time-only collisions', () => {
  assert.match(checkout, /tx-\$\{randomUUID\(\)\}/);
  assert.match(checkout, /randomUUID\(\)\.slice\(0, 8\)/);
  assert.match(checkout, /shopProfile\?\.invoicePrefix/);
});

test('credit limit check runs before any stock mutation and rejects invalid amounts', () => {
  const limitCheck = checkout.indexOf("if (paymentMethod === 'Credit Account' && checkoutCustomer)");
  const stockMutation = checkout.indexOf('await checkoutTransaction(tx,');
  assert.ok(limitCheck >= 0, 'Credit limit check is required');
  assert.ok(stockMutation > limitCheck, 'Credit checks must happen before stock changes');
  assert.match(checkout, /outstanding \+ total/);
  assert.match(checkout, /Credit limit exceeded/);
  assert.match(checkout, /!Number\.isFinite\(cashPaid\)/);
});

test('unsupported payment methods are rejected before checkout mutations', () => {
  assert.match(checkout, /allowedPaymentMethods = new Set/);
  assert.match(checkout, /!allowedPaymentMethods\.has\(paymentMethod\)/);
  assert.ok(checkout.indexOf('Unsupported payment method') < checkout.indexOf('await checkoutTransaction(tx,'));
});

const refund = server.split("app.post('/api/transactions/:id/refund'")[1]?.split('// Create Purchase Orders')[0] || '';

test('refund prevalidates every SKU and variant before changing stock', () => {
  assert.match(refund, /Cannot refund: product/);
  assert.match(refund, /Cannot refund: product variant/);
  assert.match(refund, /Number\.isSafeInteger\(Number\(item\.quantity\)\)/);
  assert.ok(refund.indexOf("for (const item of tx.items)") < refund.indexOf("db.stockLogs.unshift("));
});

test('credit-sale refund checks and reverses customer outstanding balance', () => {
  assert.match(refund, /tx\.paymentMethod === 'Credit Account'/);
  assert.match(refund, /Credit balance is below this invoice total/);
  assert.match(refund, /db\.customers\[customerIndex\]\.creditBalance/);
  assert.match(refund, /Number\(tx\.total\)/);
  assert.ok(refund.indexOf('Credit balance is below') < refund.indexOf('db.stockLogs.unshift('));
});
