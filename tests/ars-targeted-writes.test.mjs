import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const settings = server.split("app.put('/api/settings'")[1]?.split("app.get('/api/manual-expenses'")[0] || '';
const staff = server.split("app.post('/api/employees'")[1]?.split('// --- Server-Side Gemini AI Endpoints')[0] || '';
const legacy = server.split('const saveStateToNormalized = ')[1]?.split('const syncNormalizedFromState')[0] || '';

test('company settings use targeted SQL instead of whole-state database rewrite', () => {
  assert.match(settings, /INSERT INTO store_settings/);
  assert.match(settings, /ON CONFLICT \(id\) DO UPDATE/);
  assert.doesNotMatch(settings, /await saveDb\(\)/);
  assert.match(settings, /databaseWriteHealthy=false/);
});
test('branch managers cannot write settings for other branches or global defaults', () => {
  assert.match(settings, /profile\.id !== activeShopId/);
  assert.match(settings, /isAdmin \? String\(payload\.storeName/);
  assert.match(settings, /managerProfiles/);
  assert.match(settings, /return res\.status\(403\)/);
});
test('staff writes are shop scoped and do not truncate business records', () => {
  assert.match(staff, /INSERT INTO employees/);
  assert.match(staff, /UPDATE employees SET/);
  assert.match(staff, /WHERE id=\$8 AND shop_id=\$9/);
  assert.doesNotMatch(staff, /await saveDb\(\)/);
  assert.match(staff, /refreshCommittedEmployeeState\(res\)/);
});
test('legacy whole-state rewrite fails closed after receipt batches exist', () => {
  assert.match(legacy, /ars_receipt_batches/);
  assert.match(legacy, /Legacy full-state rewrite blocked/);
});

test('manual expenses commit with an audit entry and no whole-state rewrite', () => {
  const expenses=server.split("app.post('/api/manual-expenses'")[1]?.split('// Products Routes')[0] || '';
  assert.match(expenses,/INSERT INTO manual_expenses/);
  assert.match(expenses,/INSERT INTO activity_logs/);
  assert.match(expenses,/await client\.query\('BEGIN'\)/);
  assert.match(expenses,/await client\.query\('COMMIT'\)/);
  assert.match(expenses,/await client\.query\('ROLLBACK'\)/);
  assert.doesNotMatch(expenses,/await saveDb\(\)/);
});
