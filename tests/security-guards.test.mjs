import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

test('normal POS database hydration omits user credentials', () => {
  const section = server.split("app.get('/api/db',")[1]?.split("app.post('/api/db/reset'")[0] || '';
  assert.match(section, /users:\s*_privateUsers,\s*\.\.\.publicState/);
  assert.match(section, /\.\.\.publicState/);
  assert.doesNotMatch(section, /\.\.\.db\s*,/);
});

test('database browser excludes credential storage tables', () => {
  assert.match(server, /hiddenTables\s*=\s*new Set\(\['users', 'app_state'\]\)/);
  assert.match(server, /requested === 'users' \|\| requested === 'app_state'/);
});

test('dangerous database reset endpoints fail closed by default', () => {
  assert.match(server, /!IS_PRODUCTION && process\.env\.ENABLE_DESTRUCTIVE_ADMIN_TOOLS === 'true'/);
  assert.match(server, /req\.body\?\.confirmation !== 'DELETE ALL TEST DATA'/);
  for (const route of ['reset', 'clear-test-data', 'sync-normalized']) {
    assert.match(server, new RegExp(`app.post\\('/api/db/${route}',[^\\n]*requireExplicitDataReset`));
  }
});

test('failed database save reloads committed state and prevents unsafe follow-up writes', () => {
  const saveDbSection = server.split('const saveDb = async () => {')[1]?.split('type AppRequest')[0] || '';
  assert.match(saveDbSection, /await syncNormalizedFromState\(nextState\)/);
  assert.match(saveDbSection, /const committedState = await loadStateFromNormalized\(\)/);
  assert.match(saveDbSection, /db = committedState/);
  assert.match(saveDbSection, /databaseWriteHealthy = false/);
  const queue = server.split('let writeQueue: Promise<void>')[1]?.split('--- API Implementation ---')[0] || '';
  assert.match(queue, /if \(!databaseWriteHealthy\)/);
  assert.match(queue, /res\.status\(503\)/);
  assert.match(server, /database: 'recovery-required'/);
});

test('legacy database enforces single server writer with PostgreSQL advisory lease', () => {
  assert.match(server, /pg_try_advisory_lock\(\$1::integer, \$2::integer\)/);
  assert.match(server, /pg_advisory_unlock\(\$1::integer, \$2::integer\)/);
  assert.match(server, /Another Hardware POS server already owns this database/);
  const startup = server.split('async function startServer() {')[1] || '';
  assert.ok(startup.indexOf('await acquireSingleWriterLease()') < startup.indexOf('await initPostgres()'));
  assert.match(startup, /await releaseSingleWriterLease\(\)/);
  assert.match(server, /single-writer lease connection lost; writes disabled/);
});

test('cash shift closing is scoped to the authenticated active shop', () => {
  const route = server.split("app.post('/api/shifts/:id/close'")[1]?.split('// ── Reports Route')[0] || '';
  assert.match(route, /s\.id === req\.params\.id && s\.shopId === activeShopId/);
  assert.match(route, /Shift not found in this shop/);
});
