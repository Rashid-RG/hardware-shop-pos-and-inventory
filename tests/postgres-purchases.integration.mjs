import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const connection = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['localhost', '127.0.0.1'].includes(connection.hostname) || connection.pathname !== '/hardware_pos_ci') {
  throw new Error('Refusing integration test outside local hardware_pos_ci database');
}

const { pool, initDbTables, createPurchaseOrder, receivePurchaseOrder, updatePurchaseOrderStatus, insertSupplierPayment } =
  await import('../backend/db.ts');

test('purchase creation and receiving commits stock exactly once, isolated by shop', async () => {
  const suffix = randomUUID();
  const shopId = 'ci-purchase-shop';
  const productId = 'ci-po-product-' + suffix;
  const supplierId = 'ci-po-supplier-' + suffix;
  const variantId = 'ci-po-variant-' + suffix;
  const poId = 'ci-po-' + suffix;
  const sku = 'CI-PO-' + suffix;
  try {
    await initDbTables();
    await pool.query(
      `INSERT INTO suppliers (id, shop_id, name, company_name, phone)
       VALUES ($1, $2, 'Test Supplier', 'Test Supplier Co', '0700000000')`,
      [supplierId, shopId]
    );
    await pool.query(
      `INSERT INTO products
       (id, shop_id, name, sku, brand, category, cost_price, selling_price, quantity, reorder_level, warranty, description, variants_json)
       VALUES ($1, $2, 'CI fitting', $3, 'CI', 'Parts', 30, 50, 3, 1, 'None', 'Test',
       $4::jsonb)`,
      [productId, shopId, sku, JSON.stringify([{ id: variantId, name: 'M8', quantity: 3, sku: sku + '-M8' }])]
    );
    const po = {
      id: poId, shopId, poNumber: 'CI-PO-' + suffix, date: new Date().toISOString(),
      supplierId, supplierName: 'Test Supplier Co',
      items: [{ productId, productName: 'CI fitting (M8)', variantId, quantity: 4, costPrice: 30 }],
      total: 120, status: 'Pending',
    };
    await createPurchaseOrder(po);
    const ordered = await pool.query('SELECT status FROM purchase_orders WHERE id=$1', [poId]);
    assert.equal(ordered.rows[0].status, 'Pending');
    const before = await pool.query('SELECT quantity FROM products WHERE id=$1', [productId]);
    assert.equal(Number(before.rows[0].quantity), 3);
    await assert.rejects(
      () => receivePurchaseOrder(poId, 'other-shop', 'CI Buyer'),
      /Purchase order not found/
    );
    await updatePurchaseOrderStatus(poId, shopId, 'Ordered', 'CI Buyer');
    await receivePurchaseOrder(poId, shopId, 'CI Buyer');
    const after = await pool.query('SELECT quantity, variants_json FROM products WHERE id=$1', [productId]);
    assert.equal(Number(after.rows[0].quantity), 7);
    assert.equal(Number(after.rows[0].variants_json[0].quantity), 7);
    const received = await pool.query('SELECT status FROM purchase_orders WHERE id=$1', [poId]);
    assert.equal(received.rows[0].status, 'Received');
    await assert.rejects(
      () => receivePurchaseOrder(poId, shopId, 'CI Buyer'),
      /already received/
    );
    const afterRetry = await pool.query('SELECT quantity FROM products WHERE id=$1', [productId]);
    assert.equal(Number(afterRetry.rows[0].quantity), 7);
    const stockLogs = await pool.query(
      "SELECT COUNT(*)::int AS count FROM stock_logs WHERE reference_id=$1 AND type='Stock In'", [poId]
    );
    assert.equal(stockLogs.rows[0].count, 1);

    const supplierPayment = (id, amount, linkedPo = poId, supplier = supplierId, shop = shopId) => ({
      id, shopId: shop, supplierId: supplier, supplierName: 'Test Supplier Co',
      purchaseOrderId: linkedPo, amount, paymentMethod: 'Bank Transfer',
      date: new Date().toISOString().slice(0, 10), createdBy: 'CI Manager',
    });
    await assert.rejects(
      () => insertSupplierPayment(supplierPayment('ci-wrong-supplier-' + suffix, 20, poId, 'other-supplier')),
      /Supplier not found/
    );
    await assert.rejects(
      () => insertSupplierPayment(supplierPayment('ci-overpay-' + suffix, 121)),
      /exceeds the remaining/
    );
    const firstSupplierPayment = 'ci-supplier-payment-' + suffix;
    await insertSupplierPayment(supplierPayment(firstSupplierPayment, 70));
    const supplierPayments = await pool.query(
      'SELECT amount FROM supplier_payments WHERE id = $1', [firstSupplierPayment]
    );
    assert.equal(Number(supplierPayments.rows[0].amount), 70);
    await assert.rejects(
      () => insertSupplierPayment(supplierPayment('ci-overpay-after-' + suffix, 51)),
      /exceeds the remaining/
    );
    await assert.rejects(
      () => insertSupplierPayment(supplierPayment(firstSupplierPayment, 30)),
      /duplicate key/
    );
    const paidTotal = await pool.query(
      'SELECT COALESCE(SUM(amount),0) AS total FROM supplier_payments WHERE purchase_order_id = $1', [poId]
    );
    assert.equal(Number(paidTotal.rows[0].total), 70);
  } finally {
    await pool.end();
  }
});
