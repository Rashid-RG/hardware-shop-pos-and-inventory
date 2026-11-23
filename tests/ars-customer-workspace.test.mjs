import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const customer = readFileSync(new URL('../src/components/CustomerEmployeeView.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('customers have dedicated full-height file separate from staff', () => {
  assert.match(app, /activeTab === 'customers' \|\| activeTab === 'staff'/);
  assert.match(app, /transactions=\{transactions\}/);
  assert.match(customer, /id="ars-customer-workspace"/);
  assert.match(customer, /aria-label="Customer details and full history"/);
  assert.match(customer, /openCustomerFile\(c\.id\)/);
  assert.match(customer, /setSelectedCustomerId\(null\)/);
});

test('directory filters include customer name id contact and address and show all matches', () => {
  assert.match(customer, /\[c\.name, c\.id, c\.phone, c\.email, c\.address\]/);
  assert.match(customer, /balanceFilter === 'owing'/);
  assert.match(customer, /searchTerm\.trim\(\) \|\| balanceFilter !== 'all'/);
});

test('customer detail renders all scoped invoice and credit repayment records', () => {
  assert.match(customer, /tx\.customerId === selectedCustomer\.id && matchesShop\(tx\.shopId\)/);
  assert.match(customer, /payment\.customerId === selectedCustomer\.id && matchesShop\(payment\.shopId\)/);
  assert.match(customer, /selectedInvoices\.map/);
  assert.match(customer, /selectedPayments\.map/);
  assert.match(customer, /historyRows\.map/);
  assert.doesNotMatch(customer.split('const historyRows =')[1].split('const openCustomerFile')[0], /\.slice\(0, 3\)/);
});

test('history filters by text, record type and date with reset action', () => {
  for (const id of ['customer-history-search', 'customer-history-type', 'customer-history-from', 'customer-history-to']) {
    assert.ok(customer.includes('id="' + id + '"'));
  }
  assert.match(customer, /setCustomerHistoryType\('all'\)/);
});
