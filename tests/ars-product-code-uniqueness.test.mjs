import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../backend/routes/products.ts', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../src/components/ProductManagementView.tsx', import.meta.url), 'utf8');

test('product code validation stays scoped to the active shop', () => {
  assert.match(route, /findConflictingProductCode\(activeShopId, normalizedPayload\)/);
  assert.match(route, /findConflictingProductCode\(activeShopId, normalizedPayload, productId\)/);
  assert.match(route, /WHERE shop_id = \$1 AND id <> \$2/);
  assert.match(route, /res\.status\(409\)\.json\(\{ error: conflict \}\)/);
});

test('code validation covers base and variant SKUs and barcodes', () => {
  assert.match(route, /kind: 'SKU', value: product\.sku/);
  assert.match(route, /kind: 'barcode', value: product\.barcode/);
  assert.match(route, /kind: 'SKU', value: variant\.sku/);
  assert.match(route, /kind: 'barcode', value: variant\.barcode/);
  assert.match(route, /variants_json/);
});

test('staff sees the duplicate error without losing product form', () => {
  assert.match(editor, /message\.includes\('already used'\)/);
  assert.match(editor, /notify\.error\(message\.includes/);
  assert.match(editor, /setIsFormOpen\(false\)/);
});
