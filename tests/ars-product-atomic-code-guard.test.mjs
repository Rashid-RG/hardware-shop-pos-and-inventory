import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const db = readFileSync(new URL('../backend/db.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

test('live product endpoints call atomic product write helpers', () => {
  assert.match(server, /app\.post\('\/api\/products'/);
  assert.match(server, /createProductWithIntake\(newProduct/);
  assert.match(server, /app\.put\('\/api\/products\/:id'/);
  assert.match(server, /updateProductWithAudit\(updated/);
});

test('both atomic product writes validate product and variant codes before SQL mutation', () => {
  const update = db.split('export const updateProductWithAudit')[1]?.split('export const createProductWithIntake')[0] || '';
  const create = db.split('export const createProductWithIntake')[1]?.split('export const insertProduct')[0] || '';
  assert.match(update, /await assertUniqueProductCodes\(client, product\)/);
  assert.match(create, /await assertUniqueProductCodes\(client, product\)/);
  assert.ok(update.indexOf('await assertUniqueProductCodes(client, product)') < update.indexOf('UPDATE products SET'));
  assert.ok(create.indexOf('await assertUniqueProductCodes(client, product)') < create.indexOf('INSERT INTO products'));
});

test('duplicate guard serializes writes per shop and checks variants', () => {
  const guard = db.split('const assertUniqueProductCodes')[1]?.split('/** Atomically edit')[0] || '';
  assert.match(guard, /pg_advisory_xact_lock/);
  assert.match(guard, /WHERE shop_id = \$1 AND id <> \$2/);
  assert.match(guard, /variants_json/);
  assert.match(guard, /variant\.sku, variant\.barcode/);
  assert.match(guard, /Product code already used/);
});
