import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const db=readFileSync(new URL('../backend/db.ts',import.meta.url),'utf8');
const pos=readFileSync(new URL('../src/components/POSView.tsx',import.meta.url),'utf8');
const quotes=readFileSync(new URL('../src/components/QuotationView.tsx',import.meta.url),'utf8');
const pdf=readFileSync(new URL('../src/utils/arsInvoicePdf.ts',import.meta.url),'utf8');

test('registered sales representative selection is mandatory for wholesale checkout',()=>{
  const checkout=server.split("app.post('/api/transactions'")[1]?.split("app.post('/api/transactions/:id/print'")[0]||'';
  assert.match(checkout,/salesRepId/);
  assert.match(checkout,/employee\.shopId === activeShopId/);
  assert.match(checkout,/Select a registered Sales Representative/);
  assert.match(checkout,/salesRepId: rep\.id/);
  assert.match(checkout,/salesRepName: rep\.name/);
  assert.doesNotMatch(checkout,/salesRepName: cashierName/);
});
test('invoices persist representative identity and name for future reprints',()=>{
  assert.match(db,/ADD COLUMN IF NOT EXISTS sales_rep_id TEXT/);
  assert.match(db,/ADD COLUMN IF NOT EXISTS sales_rep_name TEXT/);
  assert.match(db,/tx\.salesRepId \|\| null/);
  assert.match(db,/tx\.salesRepName \|\| null/);
  assert.match(server,/salesRepId: row\.sales_rep_id \|\| undefined/);
  assert.match(server,/salesRepName: row\.sales_rep_name \|\| undefined/);
});
test('customer facing A4 PDF and POS previews display selected rep, not cashier',()=>{
  assert.match(pdf,/row\('Sales Representative', safe\(tx\.salesRepName/);
  assert.doesNotMatch(pdf,/row\('Salesperson', safe\(tx\.cashierName/);
  assert.match(pos,/Select Sales Representative/);
  assert.match(pos,/salesRepId: selectedSalesRepId/);
  assert.match(pos,/tx\.salesRepName/);
  assert.doesNotMatch(pos,/<strong>Cashier:<\/strong>/);
});
test('quotation conversion requires rep selection independently of operator',()=>{
  assert.match(server,/salesRepId:salesRep\.id,salesRepName:salesRep\.name/);
  assert.match(quotes,/salesRepId: selectedSalesRepId/);
});
