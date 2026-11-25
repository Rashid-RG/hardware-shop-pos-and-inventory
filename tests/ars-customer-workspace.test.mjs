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
  assert.match(customer, /filteredCustomers\.slice\(0, visibleCount\)/);
  assert.match(customer, /filteredCustomers\.length > visibleCount/);
  assert.match(customer, /Show 12 more customer shops/);
  assert.match(customer, /setSearchTerm\(e\.target\.value\); setVisibleCount\(12\)/);
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

test('full customer file lets staff open invoice items and price breakdown', () => {
  assert.match(customer, /setSelectedInvoiceId\(row\.id\)/);
  assert.match(customer, /Selected customer invoice details/);
  assert.match(customer, /selectedInvoice\.items\.map/);
  assert.match(customer, /item\.invoiceDescription/);
  assert.match(customer, /selectedInvoice\.discountAmount/);
  assert.match(customer, /selectedInvoice\.tax/);
  assert.match(customer, /selectedInvoice\.total/);
});

test('customer contact editing is a dedicated manager-only modal', () => {
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const db = readFileSync(new URL('../backend/db.ts', import.meta.url), 'utf8');
  assert.match(server, /app\.put\('\/api\/customers\/:id\/profile', requireRole\(\['Super Admin', 'Store Manager'\]\)/);
  assert.match(server, /updateCustomerContact\(customer\.id, activeShopId, details/);
  assert.match(db, /UPDATE customers SET name=\$1, phone=\$2, email=\$3, address=\$4/);
  assert.match(customer, /aria-label="Edit customer shop details"/);
  assert.match(customer, /onUpdateCustomer\(editingCustomer\.id/);
});

test('customer directory and customer file export complete filtered results', () => {
  const engine = readFileSync(new URL('../src/utils/businessReport.ts', import.meta.url), 'utf8');
  const menu = readFileSync(new URL('../src/components/ReportExportMenu.tsx', import.meta.url), 'utf8');
  assert.match(customer, /rows:filteredCustomers\.map/);
  assert.match(customer, /rows:historyRows\.map/);
  assert.match(customer, /report=\{customerDirectoryReport\}/);
  assert.match(customer, /report=\{customerStatementReport\}/);
  assert.match(menu, /saveReportCsv\(data,\s*settings\)/);
  assert.ok(engine.includes('...report.rows'));
  assert.ok(engine.includes('[=+@-]'));
  assert.ok(engine.includes('.replace(/"/g,\'""\')'));
});
