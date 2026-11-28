import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editor = readFileSync(new URL('../src/components/ProductManagementView.tsx', import.meta.url), 'utf8');

test('ARS product quick entry includes the essential staff fields', () => {
  for (const id of ['input-prod-category', 'input-prod-name', 'input-prod-cost', 'input-prod-sell', 'input-prod-qty']) {
    assert.match(editor, new RegExp('id="' + id + '"'));
  }
  assert.match(editor, /Category \*/);
  assert.match(editor, /More product options \(optional\)/);
  assert.match(editor, /Save Product & Finish/);
});

test('technical codes are auto-generated and retained in optional product settings', () => {
  assert.match(editor, /crypto\.randomUUID\(\)/);
  assert.match(editor, /setSku\(generatedCode\)/);
  assert.match(editor, /setBarcode\(generatedCode\)/);
  const technicalSection = editor.split('showAdvancedProduct && <div')[1] || '';
  assert.match(technicalSection, /id="input-prod-sku"/);
  assert.match(technicalSection, /id="input-prod-barcode"/);
  assert.match(editor, /setShowAdvancedProduct\(false\)/);
});

test('product details stay optional without removing saved descriptions and variants', () => {
  assert.match(editor, /description,/);
  assert.match(editor, /longDescription,/);
  assert.match(editor, /variants: finalVariants/);
  assert.match(editor, /await onEditProduct/);
  assert.match(editor, /await onAddProduct/);
});

test('quick entry warns staff about an existing product name', () => {
  assert.match(editor, /matchingProducts\.length > 0/);
  assert.match(editor, /This product name is already in your catalog/);
  assert.match(editor, /Edit existing:/);
  assert.match(editor, /handleOpenEdit\(match\)/);
});
