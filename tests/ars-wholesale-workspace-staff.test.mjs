import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pos = readFileSync(new URL('../src/components/POSView.tsx', import.meta.url), 'utf8');
const inventory = readFileSync(new URL('../src/components/InventoryView.tsx', import.meta.url), 'utf8');

test('wholesale billing starts without silently assigning the first customer', () => {
  const selected = pos.split('const [selectedCustomer, setSelectedCustomer]')[1]?.split('const [billingCustomerName')[0] || '';
  assert.match(selected, /id: ''/);
  assert.doesNotMatch(selected, /customers\.find/);
  assert.match(pos, /id="pos-open-customer"/);
  assert.match(pos, /id="pos-setup-confirm"/);
});

test('billing shop selector finds all records by name id phone email or address', () => {
  assert.match(pos, /\[c\.name, c\.id, c\.phone, c\.email, c\.address\]/);
  assert.match(pos, /availableWholesaleCustomers\.map/);
  assert.doesNotMatch(pos, /availableWholesaleCustomers\.slice/);
});

test('unrequested AI selling suggestions do not clutter invoice screen', () => {
  assert.doesNotMatch(pos, /ai-smart-suggest-section|predict-complementary|Partner AI Companion Sales Matches/);
  assert.doesNotMatch(pos, /aiCrossSells|setIsLoadingCross/);
});

test('filtered stock searches show all matching products and movements', () => {
  assert.match(inventory, /isProductFiltered \? matchingProducts : matchingProducts\.slice/);
  assert.match(inventory, /isLedgerFiltered \? filteredLogs : filteredLogs\.slice/);
  assert.match(inventory, /logDateFrom/);
  assert.match(inventory, /logDateTo/);
  assert.match(inventory, /ledger-export-csv/);
  assert.match(inventory, /filteredLogs\.map\(\(log\) => \[/);
});
