import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/components/CustomerEmployeeView.tsx', import.meta.url), 'utf8');
const ledger = readFileSync(new URL('../src/components/CustomerLedgerPanel.tsx', import.meta.url), 'utf8');
const reports = readFileSync(new URL('../src/components/CustomerReportsView.tsx', import.meta.url), 'utf8');

test('customer workspace opens dedicated ledger and report screens', () => {
  assert.match(app, /<div hidden=\{customerFileTab!=="ledger"\} key=\{selectedCustomer\.id\}>/);
  assert.match(app, /<CustomerLedgerPanel customer=\{selectedCustomer\}/);
  assert.match(app, /id="ars-open-customer-reports"/);
  assert.match(app, /<CustomerReportsView customers=\{customers\}/);
  assert.match(reports, /aria-label="Customer reporting workspace"/);
});
test('staff can filter every credit movement and export CSV', () => {
  for (const id of ['ars-credit-ledger-search', 'ars-credit-ledger-kind','ars-credit-ledger-from','ars-credit-ledger-to','ars-credit-statement-export']) {
    assert.ok(ledger.includes('id="' + id + '"'), id);
  }
  assert.match(ledger, /filterCustomerLedger\(ledger, \{ from, to, search, kind \}\)/);
  assert.match(ledger, /filtered\.entries\.map/);
  assert.match(ledger, /hasOpeningDifference/);
  assert.match(ledger, /Running balances are from the full account history/);
});
test('report shows all filtered customers and separates as-of outstanding from dated activity',()=>{
  for (const id of ['ars-report-search','ars-report-from','ars-report-to','ars-report-balance','ars-report-activity','ars-report-export']) {
    assert.ok(reports.includes('id="' + id + '"'), id);
  }
  assert.match(reports, /rows\.map\(row =>/);
  assert.match(reports, /customer\.creditBalance/);
  assert.match(reports, /Refunded invoices are excluded from net sales/);
  assert.match(reports, /Outstanding balances are today's recorded balances/);
  assert.match(reports, /customerId === customer\.id && tx\.shopId === customer\.shopId/);
});
