import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const db = readFileSync(new URL('../backend/db.ts', import.meta.url), 'utf8');
const routes = server.split("app.post('/api/purchases'")[1]?.split('// Suppliers Routes')[0] || '';

test('purchase routes use row-level database transactions and never rewrite all tables', () => {
  assert.match(routes, /await createPurchaseOrder\(po\)/);
  assert.match(routes, /await receivePurchaseOrder\(po\.id, activeShopId/);
  assert.match(routes, /await updatePurchaseOrderStatus\(po\.id, activeShopId/);
  assert.doesNotMatch(routes, /await saveDb\(\)/);
});

test('purchase supplier, product and order ownership are shop scoped', () => {
  assert.match(routes, /item\.id === supplierId && item\.shopId === activeShopId/);
  assert.match(routes, /p\.id === item\?\.productId && p\.shopId === activeShopId/);
  assert.match(routes, /item\.id === req\.params\.id && item\.shopId === activeShopId/);
});

test('receiving uses PostgreSQL row locking and prevents duplicate stock receipt', () => {
  const receive = db.split('export const receivePurchaseOrder = ')[1]?.split('export const updatePurchaseOrderStatus')[0] || '';
  assert.match(receive, /shop_id = \$2 FOR UPDATE/);
  assert.match(receive, /Purchase order already received/);
  assert.match(receive, /Cannot receive an empty purchase order/);
  assert.match(receive, /await client\.query\('ROLLBACK'\)/);
});
