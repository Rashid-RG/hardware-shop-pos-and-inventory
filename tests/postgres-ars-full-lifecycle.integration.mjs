import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Never run this integration acceptance test against a customer database.
const connection = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['127.0.0.1', 'localhost'].includes(connection.hostname) || connection.pathname !== '/hardware_pos_ci') {
  throw new Error('ARS end-to-end acceptance only runs against isolated hardware_pos_ci PostgreSQL.');
}
const { pool, initDbTables, createPurchaseOrder, checkoutTransaction, addCustomerCreditPayment } =
  await import('../backend/db.ts');
const { initPartialReceivingTables, receivePartialOrder } = await import('../backend/partialReceiving.ts');

test('ARS wholesale lifecycle: supplier PO, partial goods receipt, billing, repayment, audit and isolation', { timeout: 60000 }, async () => {
  const suffix = randomUUID();
  const shopId = 'ci-flow-shop-' + suffix;
  const wrongShop = 'ci-flow-other-' + suffix;
  const supplierId = 'ci-flow-supplier-' + suffix;
  const productId = 'ci-flow-product-' + suffix;
  const customerId = 'ci-flow-customer-' + suffix;
  const poId = 'ci-flow-po-' + suffix;
  const txId = 'ci-flow-sale-' + suffix;
  const date = new Date().toISOString();
  const readStock = async () => Number((await pool.query('SELECT quantity FROM products WHERE id=$1 AND shop_id=$2', [productId, shopId])).rows[0].quantity);
  const readDebt = async () => Number((await pool.query('SELECT credit_balance FROM customers WHERE id=$1 AND shop_id=$2', [customerId, shopId])).rows[0].credit_balance);
  try {
    await initDbTables();
    await initPartialReceivingTables(pool);
    await pool.query(
      `INSERT INTO products (id,shop_id,name,sku,brand,category,cost_price,selling_price,quantity,reorder_level,warranty,description)
       VALUES ($1,$2,'ARS Trade Pipe',$3,'ARS','Pipes',120,200,0,2,'None','CI wholesale item')`,
      [productId, shopId, 'CI-FLOW-' + suffix]
    );
    await pool.query(
      `INSERT INTO suppliers (id,shop_id,name,company_name,phone)
       VALUES ($1,$2,'CI China Supplier','CI Import Supplier','0700000000')`,
      [supplierId, shopId]
    );
    await pool.query(
      `INSERT INTO customers(id,shop_id,name,phone,address,loyalty_balance,purchase_count,credit_limit,credit_balance)
       VALUES($1,$2,'CI Registered Trade Shop','0770000000','CI Street',0,0,2000,0)`,
      [customerId, shopId]
    );
    const po = {
      id: poId, shopId, poNumber: 'CI-FLOW-PO-' + suffix, date,
      supplierId, supplierName: 'CI China Supplier', status: 'Pending',
      items: [{ productId, productName: 'ARS Trade Pipe', quantity: 8, costPrice: 120 }],
      total: 960,
    };
    await createPurchaseOrder(po);
    assert.equal(await readStock(), 0, 'Creating a PO must never add available stock');
    const itemResult = await pool.query('SELECT id FROM purchase_order_items WHERE purchase_order_id=$1', [poId]);
    assert.equal(itemResult.rowCount, 1);
    const lineId = Number(itemResult.rows[0].id);
    const receipt = (key, quantity, shop = shopId) => receivePartialOrder(pool, {
      shopId: shop, poId, requestKey: key, user: 'CI Warehouse Staff',
      items: [{ purchaseOrderItemId: lineId, quantity }],
      note: 'Physically counted test delivery',
    });

    await assert.rejects(() => receipt('wrong-shop-' + suffix, 3, wrongShop), /Purchase order not found in this shop/);
    assert.equal(await readStock(), 0);
    const first = await receipt('first-' + suffix, 5);
    assert.equal(first.status, 'Partially Received');
    assert.equal(first.repeated, false);
    assert.equal(await readStock(), 5, 'First receipt must only add the five physically received units');
    const repeated = await receipt('first-' + suffix, 5);
    assert.equal(repeated.repeated, true, 'Retried request must be idempotent');
    assert.equal(await readStock(), 5, 'Retry must never double-post inventory');
    await assert.rejects(() => receipt('excess-' + suffix, 4), /exceeds ordered quantity/);
    assert.equal(await readStock(), 5, 'Rejected excess must roll back inventory');
    const last = await receipt('second-' + suffix, 3);
    assert.equal(last.status, 'Received');
    assert.equal(await readStock(), 8);
    await assert.rejects(() => receipt('third-' + suffix, 1), /Order is not open for receiving/);

    const sale = {
      id: txId, shopId, invoiceNumber: 'CI-FLOW-INV-' + suffix, date: new Date().toISOString(),
      customerId, customerName: 'CI Registered Trade Shop', customerPhone: '0770000000',
      cashierName: 'CI Cashier', salesRepName: 'CI Representative',
      items: [{ productId, productName: 'ARS Trade Pipe',
        invoiceDescription: 'One 4m heavy duty pipe · invoice snapshot', quantity: 3,
        sellingPrice: 200, costPrice: 120, discount: 0, discountAmount: 0 }],
      subtotal: 600, tax: 0, discountAmount: 0, total: 600,
      paymentMethod: 'Credit Account', paymentStatus: 'CREDIT SALE',
      status: 'Completed',
    };
    await checkoutTransaction(sale, 'Cashier', 'ARS CI Test');
    assert.equal(await readStock(), 5, 'Credit invoice must deduct exactly three units');
    assert.equal(await readDebt(), 600, 'Only credit invoice must increase customer debt');
    const invoiceItem = await pool.query(
      'SELECT invoice_description,quantity FROM sales_transaction_items WHERE transaction_id=$1', [txId]
    );
    assert.equal(invoiceItem.rows[0].invoice_description, sale.items[0].invoiceDescription);
    assert.equal(Number(invoiceItem.rows[0].quantity), 3);

    const paymentId = 'ci-flow-payment-' + suffix;
    const payment = {
      id: paymentId, shopId, customerId, customerName: sale.customerName,
      amount: 250, date: date.slice(0, 10), paymentMethod: 'Bank Transfer',
      note: 'CI customer settlement', createdBy: 'CI Manager',
    };
    await assert.rejects(() => addCustomerCreditPayment({ ...payment, id: 'ci-flow-wrong-' + suffix, shopId: wrongShop }), /Customer not found in this shop/);
    await addCustomerCreditPayment(payment);
    assert.equal(await readDebt(), 350, 'Repayment must reduce credit by exactly the paid amount');
    assert.equal(await readStock(), 5, 'Repayment must never alter inventory');
    await assert.rejects(() => addCustomerCreditPayment({ ...payment, id: 'ci-flow-overpay-' + suffix, amount: 351 }), /exceeds the customer outstanding credit balance/);
    assert.equal(await readDebt(), 350);
    const received = await pool.query('SELECT status FROM purchase_orders WHERE id=$1', [poId]);
    assert.equal(received.rows[0].status, 'Received');
    const warehouse = await pool.query("SELECT COALESCE(SUM(quantity),0) AS qty FROM stock_logs WHERE shop_id=$1 AND product_id=$2 AND type='Stock In'", [shopId, productId]);
    const sales = await pool.query("SELECT COALESCE(SUM(quantity),0) AS qty FROM stock_logs WHERE shop_id=$1 AND product_id=$2 AND type='Stock Out'", [shopId, productId]);
    assert.equal(Number(warehouse.rows[0].qty), 8);
    assert.equal(Number(sales.rows[0].qty), -3);
    assert.equal(Number(warehouse.rows[0].qty) + Number(sales.rows[0].qty), await readStock());
    const customer = await pool.query('SELECT purchase_count,credit_balance FROM customers WHERE id=$1 AND shop_id=$2', [customerId, shopId]);
    assert.equal(Number(customer.rows[0].purchase_count), 1);
    const receipts = await pool.query('SELECT COUNT(*)::int AS count FROM ars_receipt_batches WHERE purchase_order_id=$1', [poId]);
    assert.equal(receipts.rows[0].count, 2, 'Only two distinct goods receipts should be recorded');
  } finally {
    await pool.end();
  }
});
