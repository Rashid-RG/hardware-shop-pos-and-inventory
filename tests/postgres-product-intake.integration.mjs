import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hardware_pos_ci') {
  throw new Error('Refusing product integration test outside isolated hardware_pos_ci database');
}
const { pool, initDbTables, createProductWithIntake } = await import('../backend/db.ts');

test('product registration saves stock and audit atomically and rolls back duplicate SKU', async () => {
  const uid = randomUUID();
  const shopId = 'ci-product-shop';
  const fixture = (id) => ({
    id, shopId, name: 'CI hardware fitting', sku: 'CI-HW-' + uid,
    barcode: 'CI-BAR-' + uid, brand: 'CI', category: 'Fittings',
    costPrice: 20, sellingPrice: 35, wholesalePrice: 30, dealerPrice: 25,
    quantity: 12, reorderLevel: 2, warranty: 'None', description: 'Isolated test fixture',
    variants: [{ id: 'v-' + uid, name: 'M6', unit: 'Piece', sku: 'CI-M6-' + uid,
      quantity: 12, costPrice: 20, sellingPrice: 35, reorderLevel: 2 }],
  });
  try {
    await initDbTables();
    const firstId = 'ci-product-' + uid;
    await createProductWithIntake(fixture(firstId), 'CI Manager', 'Store Manager', 'CI Shop');
    const product = await pool.query('SELECT quantity, variants_json, shop_id FROM products WHERE id=$1', [firstId]);
    assert.equal(Number(product.rows[0].quantity), 12);
    assert.equal(product.rows[0].variants_json[0].quantity, 12);
    assert.equal(product.rows[0].shop_id, shopId);
    const ledger = await pool.query("SELECT quantity FROM stock_logs WHERE product_id=$1 AND type='Stock In'", [firstId]);
    assert.equal(ledger.rows.length, 1);
    assert.equal(Number(ledger.rows[0].quantity), 12);
    const audit = await pool.query("SELECT action FROM activity_logs WHERE id=$1", ['product-created-' + firstId]);
    assert.equal(audit.rows[0].action, 'Added Product');

    const rejectedId = 'ci-product-rejected-' + uid;
    await assert.rejects(
      () => createProductWithIntake(fixture(rejectedId), 'CI Manager', 'Store Manager', 'CI Shop'),
      /duplicate key/
    );
    const rejectedProduct = await pool.query('SELECT id FROM products WHERE id=$1', [rejectedId]);
    const rejectedLogs = await pool.query('SELECT id FROM stock_logs WHERE product_id=$1', [rejectedId]);
    const rejectedAudit = await pool.query('SELECT id FROM activity_logs WHERE id=$1', ['product-created-' + rejectedId]);
    assert.equal(rejectedProduct.rowCount, 0);
    assert.equal(rejectedLogs.rowCount, 0);
    assert.equal(rejectedAudit.rowCount, 0);
  } finally {
    await pool.end();
  }
});
