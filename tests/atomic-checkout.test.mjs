import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const helper = readFileSync(new URL('../backend/db.ts', import.meta.url), 'utf8');
const checkout = server.split('// POS Transaction Checkout Route')[1]?.split("app.post('/api/transactions/:id/print'")[0] || '';
const executor = helper.split('export const checkoutTransaction = ')[1]?.split('export const refundTransaction')[0] || '';

test('checkout uses transactional helper, not legacy full-table save', () => {
  assert.match(checkout, /await checkoutTransaction\(tx,/);
  assert.doesNotMatch(checkout, /await saveDb\(\)/);
  assert.match(executor, /await client\.query\('BEGIN'\)/);
  assert.match(executor, /await client\.query\('COMMIT'\)/);
  assert.match(executor, /await client\.query\('ROLLBACK'\)/);
});

test('invoice item variants are persisted and rehydrated by Windows server', () => {
  for (const column of ['variant_id', 'variant_name', 'variant_unit', 'variant_sku', 'variant_barcode']) {
    assert.match(server, new RegExp('ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS ' + column));
    assert.match(helper, new RegExp('ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS ' + column));
  }
  assert.match(executor, /item\.variantId \|\| null/);
  assert.match(server, /variantId: item\.variant_id \|\| undefined/);
  assert.match(server, /item\.variantBarcode \|\| null/);
});

test('database checkout locks products and checks credit in shop scope', () => {
  assert.match(executor, /FOR UPDATE/);
  assert.match(executor, /shop_id = \$2 FOR UPDATE/);
  assert.match(executor, /creditLimit > 0/);
});

test('committed checkout is not accidentally retried when cache reload fails', () => {
  assert.match(checkout, /databaseWriteHealthy = false/);
  assert.match(checkout, /await loadStateFromNormalized\(\)/);
  assert.match(checkout, /res\.json\(tx\)/);
});
