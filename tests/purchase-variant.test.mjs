import assert from 'node:assert/strict';
import test from 'node:test';
import { purchaseVariant } from '../backend/purchaseVariant.ts';

const sizes = [{ id: '20mm' }, { id: '25mm' }];
test('chooses the ordered size even if the catalogue is reordered', () => {
  for (const list of [sizes, [...sizes].reverse()]) {
    assert.equal(purchaseVariant(list, '25mm', 'Pipe'), sizes[1]);
  }
});
test('plain products receive without a variant', () => {
  assert.equal(purchaseVariant([], null, 'Hammer'), undefined);
});
test('missing and removed variants cannot silently receive stock', () => {
  for (const list of [sizes, []]) assert.throws(() => purchaseVariant(list, 'removed', 'Pipe'));
  assert.throws(() => purchaseVariant(sizes, null, 'Pipe', true));
  assert.throws(() => purchaseVariant([sizes[0]], null, 'Pipe'));
});
test('old orders with one available variant can still be received', () => {
  assert.equal(purchaseVariant([sizes[1]], null, 'Pipe', true), sizes[1]);
});
