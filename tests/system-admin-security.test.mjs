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
  const rendered = admin.split('  return (\n    <div className="space-y-6 motion-safe:animate-fade-in">').at(-1) || '';
  assert.match(rendered, /System Administration/);
  assert.match(rendered, /User Accounts/);
  assert.doesNotMatch(rendered, /Clear Test Data/);
  assert.doesNotMatch(rendered, /Sync app_state to normalized/);
  assert.doesNotMatch(rendered, /Export CSV/);
  assert.match(sidebar, /'Super Admin'/);
});
