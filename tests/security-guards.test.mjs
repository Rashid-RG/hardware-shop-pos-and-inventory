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
