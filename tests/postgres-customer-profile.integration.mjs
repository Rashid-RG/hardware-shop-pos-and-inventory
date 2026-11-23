import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hardware_pos_ci') {
  throw new Error('Refusing customer profile integration test outside isolated hardware_pos_ci');
}
const { pool, initDbTables, insertCustomer, updateCustomerContact } = await import('../backend/db.ts');

test('customer contact edits are shop-scoped and preserve financial balances and invoices', async () => {
  const key = randomUUID();
  const customerId = 'ci-customer-profile-' + key;
  const shopId = 'ci-customer-shop-' + key;
  try {
    await initDbTables();
    await insertCustomer({
      id: customerId, shopId, name: 'Original Wholesale Shop',
      phone: '0111111111', email: '', address: 'Old Lane',
      loyaltyBalance: 3, purchaseCount: 2, creditLimit: 50000, creditBalance: 1500,
    });
    await assert.rejects(
      () => updateCustomerContact(customerId, 'another-shop', {
        name: 'Wrong Tenant', phone: '', email: '', address: '',
      }, 'CI Manager'),
      /Customer not found in this shop/
    );
    await updateCustomerContact(customerId, shopId, {
      name: 'Updated Wholesale Shop', phone: '0771234567',
      email: 'shop@example.test', address: 'New Lane',
    }, 'CI Manager');
    const result = await pool.query(
      'SELECT name, phone, email, address, credit_limit, credit_balance, loyalty_balance, purchase_count FROM customers WHERE id=$1 AND shop_id=$2',
      [customerId, shopId]
    );
    assert.equal(result.rows[0].name, 'Updated Wholesale Shop');
    assert.equal(result.rows[0].phone, '0771234567');
    assert.equal(result.rows[0].email, 'shop@example.test');
    assert.equal(result.rows[0].address, 'New Lane');
    assert.equal(Number(result.rows[0].credit_limit), 50000);
    assert.equal(Number(result.rows[0].credit_balance), 1500);
    assert.equal(Number(result.rows[0].loyalty_balance), 3);
    assert.equal(Number(result.rows[0].purchase_count), 2);
    const audit = await pool.query(
      "SELECT action FROM activity_logs WHERE shop_id=$1 AND action='Updated Customer'",
      [shopId]
    );
    assert.equal(audit.rowCount, 1);
  } finally {
    await pool.end();
  }
});
