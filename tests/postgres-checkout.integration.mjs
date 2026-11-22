import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// This integration test can only run against the dedicated ephemeral CI database.
const connection = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['127.0.0.1', 'localhost'].includes(connection.hostname) || connection.pathname !== '/hardware_pos_ci') {
  throw new Error('Refusing integration test outside local hardware_pos_ci database');
}

const { pool, initDbTables, checkoutTransaction, refundTransaction } = await import('../backend/db.ts');

test('real PostgreSQL checkout commits exact variant, credit and invoice atomically', async () => {
  const suffix = randomUUID();
  const shopId = 'ci-shop';
  const productId = 'ci-product-' + suffix;
  const customerId = 'ci-customer-' + suffix;
  const variantId = 'ci-variant-' + suffix;
  try {
    await initDbTables();
    const variants = [{
      id: variantId, name: '50 mm', unit: 'Piece',
      sku: 'CI-50-' + suffix, barcode: 'ci-' + suffix,
      costPrice: 60, sellingPrice: 100, quantity: 10, reorderLevel: 2,
    }];
    await pool.query(
      `INSERT INTO products
       (id,shop_id,name,sku,brand,category,cost_price,selling_price,quantity,reorder_level,warranty,description,variants_json)
       VALUES ($1,$2,'CI pipe',$3,'CI','Pipes',60,100,10,2,'None','Integration fixture',$4::jsonb)`,
      [productId, shopId, 'CI-' + suffix, JSON.stringify(variants)]
    );
    await pool.query(
      `INSERT INTO customers (id,shop_id,name,loyalty_balance,purchase_count,credit_limit,credit_balance)
       VALUES ($1,$2,'CI Trade Customer',0,0,250,0)`,
      [customerId, shopId]
    );
    const tx = (quantity, id) => ({
      id, shopId, invoiceNumber: 'CI-INV-' + id, date: new Date().toISOString(),
      customerId, customerName: 'CI Trade Customer', cashierName: 'CI Cashier',
      items: [{
        productId, productName: 'CI pipe (50 mm)', variantId, variantName: '50 mm',
        variantUnit: 'Piece', variantSku: variants[0].sku, variantBarcode: variants[0].barcode,
        quantity, sellingPrice: 100, costPrice: 60, discount: 0,
      }],
      subtotal: quantity * 100, tax: 0, discountAmount: 0, total: quantity * 100,
      paymentMethod: 'Credit Account', paymentStatus: 'CREDIT SALE',
    });

    const first = 'ci-tx-' + randomUUID();
    await checkoutTransaction(tx(2, first), 'Cashier', 'CI Shop');
    const stock = await pool.query('SELECT quantity, variants_json FROM products WHERE id = $1', [productId]);
    assert.equal(Number(stock.rows[0].quantity), 8);
    assert.equal(stock.rows[0].variants_json[0].quantity, 8);

    const invoice = await pool.query(
      'SELECT variant_id, variant_sku, quantity FROM sales_transaction_items WHERE transaction_id = $1', [first]
    );
    assert.equal(invoice.rows[0].variant_id, variantId);
    assert.equal(invoice.rows[0].variant_sku, variants[0].sku);
    assert.equal(Number(invoice.rows[0].quantity), 2);

    const customer = await pool.query('SELECT credit_balance,purchase_count FROM customers WHERE id = $1', [customerId]);
    assert.equal(Number(customer.rows[0].credit_balance), 200);
    assert.equal(Number(customer.rows[0].purchase_count), 1);

    const rejected = 'ci-tx-' + randomUUID();
    await assert.rejects(
      () => checkoutTransaction(tx(1, rejected), 'Cashier', 'CI Shop'),
      /Credit limit exceeded/
    );
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM sales_transactions WHERE id = $1', [rejected]);
    assert.equal(count.rows[0].count, 0);
    const after = await pool.query('SELECT quantity FROM products WHERE id = $1', [productId]);
    assert.equal(Number(after.rows[0].quantity), 8, 'Failed credit sale must not decrease stock');

    // Wrong-shop refund must fail without touching stock or credit.
    await assert.rejects(
      () => refundTransaction(first, 'ci-other-shop', 'Wrong shop', 'CI Manager', 'Store Manager'),
      /Transaction not found/
    );

    // An account-level payment can make the remaining credit less than the
    // invoice. Never erase the paid portion by silently reducing credit to zero.
    await pool.query('UPDATE customers SET credit_balance = 150 WHERE id = $1', [customerId]);
    await assert.rejects(
      () => refundTransaction(first, shopId, 'Credit already paid', 'CI Manager', 'Store Manager'),
      /Credit balance is below this invoice total/
    );
    const afterFailedRefund = await pool.query('SELECT quantity FROM products WHERE id = $1', [productId]);
    assert.equal(Number(afterFailedRefund.rows[0].quantity), 8, 'Failed refund must roll back stock');

    // Once payments are reconciled, refund restores the precise variant.
    await pool.query('UPDATE customers SET credit_balance = 200 WHERE id = $1', [customerId]);
    await refundTransaction(first, shopId, 'Customer returned goods', 'CI Manager', 'Store Manager');
    const stockRestored = await pool.query('SELECT quantity, variants_json FROM products WHERE id = $1', [productId]);
    assert.equal(Number(stockRestored.rows[0].quantity), 10);
    assert.equal(stockRestored.rows[0].variants_json[0].quantity, 10);
    const refundedCustomer = await pool.query(
      'SELECT credit_balance,purchase_count,loyalty_balance FROM customers WHERE id = $1', [customerId]
    );
    assert.equal(Number(refundedCustomer.rows[0].credit_balance), 0);
    assert.equal(Number(refundedCustomer.rows[0].purchase_count), 0);
    assert.equal(Number(refundedCustomer.rows[0].loyalty_balance), 0);
    const invoiceStatus = await pool.query('SELECT status FROM sales_transactions WHERE id = $1', [first]);
    assert.equal(invoiceStatus.rows[0].status, 'Refunded');
    await assert.rejects(
      () => refundTransaction(first, shopId, 'Duplicate attempt', 'CI Manager', 'Store Manager'),
      /already been refunded/
    );
    const returnLogs = await pool.query(
      "SELECT COUNT(*)::int AS count FROM stock_logs WHERE reference_id = $1 AND type = 'Return'", [first]
    );
    assert.equal(returnLogs.rows[0].count, 1);
  } finally {
    await pool.end();
  }
});
