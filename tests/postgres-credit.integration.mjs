import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hardware_pos_ci') {
  throw new Error('Refusing credit integration test outside the local hardware_pos_ci database');
}

const { pool, initDbTables, addCustomerCreditPayment, updateCustomerCreditLimit } =
  await import('../backend/db.ts');

test('real PostgreSQL credit payments are atomic, scoped, and reject overpayments', async () => {
  const suffix = randomUUID();
  const shopId = 'ci-credit-shop';
  const customerId = 'ci-credit-customer-' + suffix;
  try {
    await initDbTables();
    await pool.query(
      `INSERT INTO customers
       (id, shop_id, name, loyalty_balance, purchase_count, credit_limit, credit_balance)
       VALUES ($1, $2, 'CI Credit Customer', 0, 0, 1000, 350)`,
      [customerId, shopId]
    );
    const payment = (id, amount, selectedShop = shopId) => ({
      id, shopId: selectedShop, customerId, customerName: 'CI Credit Customer',
      amount, date: new Date().toISOString().slice(0, 10),
      paymentMethod: 'Cash', createdBy: 'CI Cashier',
    });
    await assert.rejects(
      () => addCustomerCreditPayment(payment('ci-wrong-' + suffix, 50, 'other-shop')),
      /Customer not found in this shop/
    );
    await assert.rejects(
      () => updateCustomerCreditLimit(customerId, 'other-shop', 800),
      /Customer not found in this shop/
    );
    await updateCustomerCreditLimit(customerId, shopId, 800);

    await assert.rejects(
      () => addCustomerCreditPayment(payment('ci-over-' + suffix, 351)),
      /Payment exceeds/
    );
    let current = await pool.query('SELECT credit_balance, credit_limit FROM customers WHERE id = $1', [customerId]);
    assert.equal(Number(current.rows[0].credit_balance), 350);
    assert.equal(Number(current.rows[0].credit_limit), 800);

    const id = 'ci-credit-payment-' + suffix;
    await addCustomerCreditPayment(payment(id, 125.5));
    current = await pool.query('SELECT credit_balance FROM customers WHERE id = $1', [customerId]);
    assert.equal(Number(current.rows[0].credit_balance), 224.5);
    await assert.rejects(() => addCustomerCreditPayment(payment(id, 125.5)), /duplicate key/);
    current = await pool.query('SELECT credit_balance FROM customers WHERE id = $1', [customerId]);
    assert.equal(Number(current.rows[0].credit_balance), 224.5, 'Repeated payment must roll back');

    const count = await pool.query('SELECT COUNT(*)::integer AS n FROM customer_credit_payments WHERE id = $1', [id]);
    assert.equal(count.rows[0].n, 1);
    await assert.rejects(
      () => addCustomerCreditPayment(payment('ci-cents-' + suffix, 0.001)),
      /two decimal places/
    );
  } finally {
    await pool.end();
  }
});
