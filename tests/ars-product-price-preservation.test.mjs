import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editor = readFileSync(new URL('../src/components/ProductManagementView.tsx', import.meta.url), 'utf8');

test('quick editor preserves existing wholesale and dealer prices', () => {
  assert.match(editor, /wholesalePrice: Number\(primaryVariant\?\.wholesalePrice \?\? editingProduct\?\.wholesalePrice \?\? 0\)/);
  assert.match(editor, /dealerPrice: Number\(primaryVariant\?\.dealerPrice \?\? editingProduct\?\.dealerPrice \?\? 0\)/);
});

test('explicit zero prices and reorder levels are not silently replaced', () => {
  assert.match(editor, /costPrice: Number\(primaryVariant\?\.costPrice \?\? costPrice\)/);
  assert.match(editor, /sellingPrice: Number\(primaryVariant\?\.sellingPrice \?\? sellingPrice\)/);
  assert.match(editor, /reorderLevel: Number\(primaryVariant\?\.reorderLevel \?\? reorderLevel\)/);
});
