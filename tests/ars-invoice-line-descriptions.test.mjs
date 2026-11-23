import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pos=readFileSync(new URL('../src/components/POSView.tsx',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const db=readFileSync(new URL('../backend/db.ts',import.meta.url),'utf8');
const pdf=readFileSync(new URL('../src/utils/arsInvoicePdf.ts',import.meta.url),'utf8');
const types=readFileSync(new URL('../src/types.ts',import.meta.url),'utf8');

test('adding a product copies saved description into invoice line, not product master',()=>{
  assert.match(pos,/invoiceDescription: String\(product\.description \|\| product\.longDescription \|\| ''\)/);
  assert.match(types,/invoiceDescription\?: string/);
  assert.match(pos,/setCart\(current => current\.map\(item =>/);
  assert.match(pos,/invoiceDescription: clean/);
  assert.doesNotMatch(pos,/setProducts\(.*invoiceDescription/);
});
test('invoice item descriptions open a focused popup and are optional',()=>{
  assert.match(pos,/id="pos-description-backdrop"/);
  assert.match(pos,/id="pos-description-input"/);
  assert.match(pos,/id="pos-description-save"/);
  assert.match(pos,/maxLength=\{250\}/);
  assert.match(pos,/setEditingDescriptionKey\(lineKey\)/);
  assert.match(pos,/saveInvoiceLineDescription/);
  assert.match(pos,/Editing this invoice never changes the product catalog/);
  assert.match(pos,/item\.invoiceDescription && <span/);
});
test('server accepts only bounded text, defaults to saved product data and saves transaction snapshot',()=>{
  assert.match(server,/typeof item\.invoiceDescription !== 'string'/);
  assert.match(server,/dbProduct\.description \|\| dbProduct\.longDescription/);
  assert.match(server,/invoiceDescription\.length > 250/);
  assert.match(server,/invoiceDescription,\s*variantId: targetVariant/);
  assert.match(db,/ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS invoice_description TEXT/);
  assert.match(db,/item\.invoiceDescription \?\? null/);
  assert.match(db,/invoiceDescription: item\.invoice_description \?\? undefined/);
  assert.match(server,/invoiceDescription: item\.invoice_description \?\? undefined/);
});
test('A4 invoice wraps product descriptions with row-aware page breaks and retains legacy empty lines',()=>{
  assert.match(pdf,/const detail = String\(item\.invoiceDescription \|\| ''\)\.trim\(\)/);
  assert.match(pdf,/doc\.heightOfString\(detail/);
  assert.match(pdf,/const height = Math\.max\(24, nameHeight \+ detailHeight/);
  assert.match(pdf,/if \(y \+ height > 570\)/);
  assert.match(pdf,/\.text\(detail, columns\[1\] \+ 4/);
  assert.match(pdf,/notesAndTotals\(y\)/);
});
