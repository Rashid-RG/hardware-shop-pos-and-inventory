import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const customers=readFileSync(new URL('../src/components/CustomerEmployeeView.tsx',import.meta.url),'utf8');
const shipments=readFileSync(new URL('../src/components/ImportShipmentView.tsx',import.meta.url),'utf8');
const settings=readFileSync(new URL('../src/components/AccountingSettingsView.tsx',import.meta.url),'utf8');

test('ARS customer cards keep credit balances visible but disclose secondary actions',()=>{
  assert.match(customers,/Credit Limit/);
  assert.match(customers,/Credit Balance/);
  assert.match(customers,/Credit actions & recent payments/);
  assert.match(customers,/<details className="mt-2 rounded-lg/);
  assert.match(customers,/Record Payment/);
});
test('customer and rep registration dialogs stay within laptop viewport',()=>{
  assert.match(customers,/max-h-\[90dvh\] overflow-y-auto/);
  assert.match(customers,/Add Customer Shop/);
  assert.match(customers,/Add Sales Representative/);
  assert.match(customers,/Register Sales Representative/);
});
test('warehouse receiving remains searchable and history progressively renders',()=>{
  assert.match(shipments,/const visibleRows=rows\.filter/);
  assert.match(shipments,/const displayedRows=showAll\?visibleRows:visibleRows\.slice\(0,12\)/);
  assert.match(shipments,/Search shipments or purchase orders/);
  assert.match(shipments,/Receive quantities/);
  assert.match(shipments,/PartialReceiptPanel/);
});
test('shipment creation is optional and collapsed by default',()=>{
  assert.match(shipments,/Register incoming shipment<\/summary>/);
  assert.match(shipments,/<form onSubmit=\{add\}/);
  assert.match(shipments,/Registering a shipment does not add stock or pay suppliers/);
});
test('ARS company settings use two columns and hide infrequent legal fields',()=>{
  const panel=settings.split('RENDER TAB 2: STORE SETTINGS PANEL')[1]?.split('FIXED LOG OVERHEAD EXPENSE DRAWER MODAL')[0]||'';
  assert.match(panel,/max-w-5xl/);
  assert.match(panel,/lg:grid-cols-2/);
  assert.match(panel,/<details className="rounded-xl border border-slate-200 bg-slate-50\/60 p-3">/);
  assert.match(panel,/Legal registration, support contacts and additional invoice details/);
  assert.match(panel,/sticky bottom-0/);
  assert.match(panel,/id="btn-save-settings"/);
});

test('long customer and representative directories progressively render twelve cards and search resets the page',()=>{
  assert.match(customers,/filteredCustomers\.slice\(0, visibleCount\)/);
  assert.match(customers,/filteredEmployees\.slice\(0, visibleCount\)/);
  assert.match(customers,/Show 12 more customer shops/);
  assert.match(customers,/Show 12 more representatives/);
  assert.match(customers,/setVisibleCount\(12\)/);
});
