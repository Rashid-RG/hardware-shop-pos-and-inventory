import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const people=readFileSync(new URL('../src/components/CustomerEmployeeView.tsx',import.meta.url),'utf8');
const shipments=readFileSync(new URL('../src/components/ImportShipmentView.tsx',import.meta.url),'utf8');

test('ARS buyer directory keeps credit limits and balances visible but hides secondary credit actions',()=>{
  assert.match(people,/Credit Limit/);
  assert.match(people,/Credit Balance/);
  assert.match(people,/<details className="mt-2 rounded-lg border border-slate-100 bg-slate-50\/80 p-2 space-y-2">/);
  assert.match(people,/Credit actions & recent payments/);
  assert.match(people,/Record Payment/);
});
test('customer and representative registration stays within the visible laptop viewport',()=>{
  assert.match(people,/max-h-\[90dvh\] overflow-y-auto/);
  assert.match(people,/Add Customer Shop/);
  assert.match(people,/Add Sales Representative/);
  assert.match(people,/Register Sales Representative/);
  assert.match(people,/id="btn-emp-onboard-submit"/);
});
test('warehouse shipment listings remain searchable and progressively render without hiding receiving',()=>{
  assert.match(shipments,/const visibleRows=rows\.filter/);
  assert.match(shipments,/const displayedRows=showAll\?visibleRows:visibleRows\.slice\(0,12\)/);
  assert.match(shipments,/Search shipments or purchase orders/);
  assert.match(shipments,/Show fewer shipments/);
  assert.match(shipments,/Receive quantities/);
  assert.match(shipments,/PartialReceiptPanel/);
});
test('shipment creation is collapsed until selected to avoid dominating the whole page',()=>{
  assert.match(shipments,/Register incoming shipment<\/summary>/);
  assert.match(shipments,/<form onSubmit=\{add\}/);
  assert.match(shipments,/Registering a shipment does not add stock or pay suppliers/);
});
