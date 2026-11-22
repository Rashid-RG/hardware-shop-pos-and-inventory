import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const purchases=readFileSync(new URL('../src/components/SupplierPurchaseView.tsx',import.meta.url),'utf8');
const inventory=readFileSync(new URL('../src/components/InventoryView.tsx',import.meta.url),'utf8');
const reports=readFileSync(new URL('../src/components/ReportsView.tsx',import.meta.url),'utf8');

test('purchases show searchable purchase orders with hidden line details until requested',()=>{
  assert.match(purchases,/visiblePurchaseOrders\.slice\(0,visiblePurchaseCount\)/);
  assert.match(purchases,/Find purchase orders/);
  assert.match(purchases,/product lines · view PO details/);
  assert.match(purchases,/Show more purchase orders/);
  assert.match(purchases,/Use Warehouse Receiving to record checked quantities/);
});
test('supplier directory is compact with payments accessible and persistent',()=>{
  assert.match(purchases,/filteredSuppliers\.slice\(0,visibleSupplierCount\)/);
  assert.match(purchases,/Show more suppliers/);
  assert.match(purchases,/<summary className="cursor-pointer text-\[10px\] uppercase font-semibold text-slate-500 mb-2">Recent Payments<\/summary>/);
  assert.match(purchases,/Record Payment/);
});
test('PO composer keeps total and save controls in a bounded dialog',()=>{
  assert.match(purchases,/max-h-\[90dvh\] flex flex-col/);
  assert.match(purchases,/min-h-0 flex-1 overflow-y-auto/);
  assert.match(purchases,/Estimated Order Cost/);
  assert.match(purchases,/id="btn-po-create-submit"/);
});
test('inventory shelf and stock ledger show progressive results',()=>{
  assert.match(inventory,/Find shelf stock product/);
  assert.match(inventory,/matchingProducts\.slice\(0,productLimit\)/);
  assert.match(inventory,/filteredLogs\.slice\(0,logLimit\)/);
  assert.match(inventory,/Show more stock movements/);
  assert.match(inventory,/id="adjust-dialog-backdrop"/);
});
test('sales report and CSV show the saved sales representative, not the operator',()=>{
  assert.match(reports,/<th className="px-4 py-3">Sales Representative<\/th>/);
  assert.match(reports,/t\.salesRepName \|\| 'Not recorded'/);
  assert.match(reports,/Sales Representative,Items,Subtotal/);
  assert.doesNotMatch(reports,/<th className="px-4 py-3">Cashier<\/th>/);
  assert.doesNotMatch(reports,/t\.cashierName/);
});
test('report tables progressively render but CSV still exports the full date range',()=>{
  assert.match(reports,/filteredTx\.slice\(0,visibleRows\)/);
  assert.match(reports,/productSales\.slice\(0,visibleRows\)/);
  assert.match(reports,/filteredExpenses\.slice\(0,visibleRows\)/);
  assert.match(reports,/Show 20 more records/);
  assert.match(reports,/filteredTx\.forEach/);
});
