import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/components/DBAdminView.tsx', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');

test('JWT authorization consults current account before granting access', () => {
  const requireAuth = server.split('const requireAuth: express.RequestHandler =')[1]?.split('const requireRole =')[0] || '';
  assert.match(requireAuth, /currentAccount = db\.users\.find/);
  assert.match(requireAuth, /decoded\.authRevision !== getAuthRevision\(currentAccount\)/);
  assert.match(requireAuth, /decoded\.role !== currentAccount\.role/);
  assert.match(requireAuth, /resolveUserShopAccess\(toAuthRecordFromUser\(currentAccount\)/);
  assert.match(server, /authRevision: getAuthRevision\(currentAccount\)/);
});

test('raw database endpoints are protected from non-admin and production access', () => {
  assert.match(server, /IS_PRODUCTION \|\| process\.env\.ENABLE_DATABASE_DIAGNOSTICS !== 'true'/);
  assert.match(server, /app\.get\('\/api\/db-admin\/tables', requireRole\(\['Super Admin'\]\), requireLocalDatabaseDiagnostics/);
  assert.match(server, /app\.get\('\/api\/db-admin\/table\/:tableName', requireRole\(\['Super Admin'\]\), requireLocalDatabaseDiagnostics/);
});

test('system admin UI does not present destructive database buttons or raw table lists', () => {
  const rendered = admin.split('  return (\n    <div className="space-y-3 motion-safe:animate-fade-in">').at(-1) || '';
  assert.match(rendered, /aria-label="Administration workspaces"/);
  assert.match(rendered, /User Accounts/);
  assert.doesNotMatch(rendered, /Clear Test Data/);
  assert.doesNotMatch(rendered, /Sync app_state to normalized/);
  assert.doesNotMatch(rendered, /Export CSV/);
  assert.match(sidebar, /'Super Admin'/);
});

test('user changes do not trigger the destructive whole-database rewrite', () => {
  const endpoints = server.split("app.put('/api/profile'")[1]?.split("app.post(\n  '/api/uploads/product-image'")[0] || '';
  assert.ok(endpoints.includes("app.post('/api/users'"));
  assert.match(endpoints, /INSERT INTO users/);
  assert.match(endpoints, /UPDATE users SET email/);
  assert.match(endpoints, /DELETE FROM users/);
  assert.doesNotMatch(endpoints, /syncNormalizedFromState\(db\)/);
  assert.match(endpoints, /Cannot delete the last System Administrator/);
  assert.match(endpoints, /Cannot demote the last System Administrator/);
  assert.match(endpoints, /at least 12 characters/);
});
