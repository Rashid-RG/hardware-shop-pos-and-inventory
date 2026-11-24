import assert from 'node:assert/strict';
import pg from 'pg';
import { inventoryValuation } from '../backend/inventoryValuation.ts';

const sourceUrl = new URL(process.env.DATABASE_URL);
assert.equal(sourceUrl.hostname, '127.0.0.1');
assert.equal(sourceUrl.pathname, '/hardware_pos_ci');
const restoreUrl = new URL(sourceUrl);
restoreUrl.pathname = '/hardware_pos_restore_ci';
const original = new pg.Pool({ connectionString: sourceUrl.href });
const restored = new pg.Pool({ connectionString: restoreUrl.href });

async function report(pool, shop) {
  const { rows, knownValue, flagged, complete, totalValue } = await inventoryValuation(pool, shop);
  return { rows, knownValue, flagged, complete, totalValue };
}

try {
  const shops = 'SELECT DISTINCT shop_id FROM products ORDER BY shop_id';
  const { rows } = await original.query(shops);
  assert.ok(rows.length, 'Inventory valuation requires populated products');
  assert.deepEqual((await restored.query(shops)).rows, rows);
  let valuedLines = 0;
  for (const { shop_id } of rows) {
    const before = await report(original, shop_id);
    assert.deepEqual(await report(restored, shop_id), before, 'Restored valuation differs for ' + shop_id);
    valuedLines += before.rows.filter(line => line.value > 0).length;
  }
  assert.ok(valuedLines, 'At least one positive inventory valuation must be tested');
  console.log('Verified restored inventory valuation for', rows.length, 'shops and', valuedLines, 'positive-value lines');
} finally {
  await Promise.all([original.end(), restored.end()]);
}
