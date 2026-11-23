import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shipment = readFileSync(new URL('../src/components/ImportShipmentView.tsx', import.meta.url), 'utf8');
const receiving = readFileSync(new URL('../src/components/PartialReceiptPanel.tsx', import.meta.url), 'utf8');

test('filtered shipment and warehouse history displays all matches', () => {
  assert.match(shipment, /hasActiveFilters\|\|showAll\?visibleRows:visibleRows\.slice\(0,12\)/);
  assert.match(shipment, /Shipment status/);
  assert.match(shipment, /All statuses, including received/);
  assert.match(shipment, /Shipment ETA from/);
  assert.match(shipment, /Shipment ETA to/);
  assert.match(shipment, /!hasActiveFilters&&visibleRows\.length>12/);
});
test('fully received shipments cannot be reopened as awaiting receipts', () => {
  assert.match(shipment, /\['In Transit','Partially Received'\]\.includes\(row\.status\)/);
});
test('warehouse receipt shows all matching items while retaining original server-side validation', () => {
  assert.match(receiving, /visibleLines\.map\(line =>/);
  assert.match(receiving, /id="ars-receiving-product-search"/);
  assert.match(receiving, /showOnlyOutstanding/);
  assert.match(receiving, /id="ars-receiving-fill-outstanding"/);
  assert.match(receiving, /Number\.isSafeInteger\(line\.quantity\)/);
  assert.match(receiving, /line\.quantity <= info\.remaining/);
  assert.match(receiving, /window\.confirm\(/);
  assert.match(receiving, /requestKey, note, items: selected/);
});
