import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const product = readFileSync(new URL('../src/components/ProductManagementView.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

test('ARS Add Product shows required fields immediately and keeps Save visible', () => {
  assert.match(product, /id="ars-product-editor"/);
  assert.match(product, /max-h-\[92dvh\] flex flex-col overflow-hidden/);
  assert.match(product, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(product, /id="input-prod-category"/);
  assert.match(product, /id="input-prod-name"/);
  assert.match(product, /id="input-prod-sku"/);
  assert.match(product, /id="input-prod-barcode"/);
  assert.match(product, /id="input-prod-cost"/);
  assert.match(product, /id="input-prod-sell"/);
  assert.match(product, /id="input-prod-qty"/);
  assert.match(product, /id="btn-submit-prod"/);
  assert.doesNotMatch(product, /Enter or select a Category first/);
});
test('simple product creation does not silently override entered price or stock with a dummy variant', () => {
  const open = product.split('const handleOpenAdd = () => {')[1]?.split('// Open form for editing')[0] ?? '';
  assert.match(open, /setVariants\(\[\]\)/);
  assert.doesNotMatch(open, /Default Variant/);
  assert.match(product, /const totalVariantQty = hasVariants/);
  assert.match(product, /costPrice: Number\(primaryVariant\?\.costPrice \?\? costPrice\)/);
  assert.match(server, /const quantity = variants\.length > 0 \? variants\.reduce/);
});
test('basic form uses internal generated scan codes without inventing manufacturer EAN', () => {
  assert.match(product, /'ARS-' \+ crypto\.randomUUID\(\)\.slice/);
  assert.match(product, /setBarcode\(generatedCode\)/);
  assert.match(product, /Barcode \/ Internal Scan Code/);
});
test('advanced product fields remain available but optional for simple goods', () => {
  assert.match(product, /showAdvancedProduct && <div className="col-span-2 grid grid-cols-2 gap-3"/);
  assert.match(product, /Product Variants \(Unit-Based Pricing\)/);
  assert.match(product, /id="input-prod-image"/);
  assert.match(product, /Add product photo/);
  assert.match(product, /alt="Product photo preview"/);
  assert.ok(product.indexOf('id="input-prod-image"') < product.indexOf('showAdvancedProduct && <div'));
  assert.match(product, /disabled=\{isSubmitting \|\| isUploadingImage\}/);
  assert.match(product, /setShowAdvancedProduct\(false\)/);
  assert.match(product, /setShowAdvancedProduct\(value => !value\)/);
  assert.match(product, /notify\.success\(editingProduct/);
});

test('catalog dialogs use viewport portals and table supports bounded scrolling', () => {
  assert.match(product, /isFormOpen && createPortal\(/);
  assert.match(product, /max-h-\[62dvh\] overflow-auto/);
  assert.match(product, /visibleProducts\.map/);
  assert.match(product, /showCatalogMetrics/);
});
