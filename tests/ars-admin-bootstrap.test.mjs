import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { provisionFirstAdmin, validateFirstAdmin } from '../scripts/provision-first-admin.mjs';

test('first admin validates name, email and strong non-placeholder password', () => {
  assert.deepEqual(validateFirstAdmin({
    name: ' Owner ', email: 'OWNER@EXAMPLE.COM', password: 'Unique-long-phrase#2026',
  }), { name: 'Owner', email: 'owner@example.com', password: 'Unique-long-phrase#2026' });
  assert.throws(() => validateFirstAdmin({ name: 'x', email: 'a@b.co', password: 'Good-long-pass-2026!' }), /name/);
  assert.throws(() => validateFirstAdmin({ name: 'Owner', email: 'invalid', password: 'Good-long-pass-2026!' }), /email/);
  assert.throws(() => validateFirstAdmin({ name: 'Owner', email: 'a@b.co', password: 'ChangeMe123!xx' }), /password/);
});

test('first admin refuses any pre-existing user and rolls back without mutation', async () => {
  const commands = [];
  const client = { query: async (sql) => {
    commands.push(sql);
    if (sql.startsWith('SELECT 1 FROM users')) return { rowCount: 1 };
    if (sql.startsWith('INSERT INTO users')) throw new Error('Unexpected mutation');
    return { rowCount: 0 };
  } };
  await assert.rejects(
    provisionFirstAdmin(client, { name: 'Owner', email: 'o@example.com', password: 'Strong-Bootstrap-2026#' }),
    /already exists/,
  );
  assert.deepEqual(commands, [
    'BEGIN',
    'SELECT pg_advisory_xact_lock($1)',
    'SELECT 1 FROM users LIMIT 1',
    'ROLLBACK',
  ]);
});

test('first admin inserts a hashed Super Admin using a serialized transaction', async () => {
  const commands = [];
  let stored;
  const client = { query: async (sql, values = []) => {
    commands.push(sql);
    if (sql.startsWith('SELECT 1 FROM users')) return { rowCount: 0 };
    if (sql.startsWith('INSERT INTO users')) stored = values;
    return { rowCount: 1 };
  } };
  await provisionFirstAdmin(client, {
    name: 'Owner', email: 'owner@example.com', password: 'Strong-Bootstrap-2026#',
  });
  assert.deepEqual(commands, [
    'BEGIN',
    'SELECT pg_advisory_xact_lock($1)',
    'SELECT 1 FROM users LIMIT 1',
    "INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, 'Super Admin', $4)",
    'COMMIT',
  ]);
  assert.deepEqual(stored.slice(0, 3), ['usr-owner-example-com', 'owner@example.com', 'Owner']);
  assert.notEqual(stored[3], 'Strong-Bootstrap-2026#');
  assert.equal(await bcrypt.compare('Strong-Bootstrap-2026#', stored[3]), true);
});

test('bootstrap script requires local interactive console and explicit flag', () => {
  const script = readFileSync(new URL('../scripts/provision-first-admin.mjs', import.meta.url), 'utf8');
  assert.match(script, /ARS_ALLOW_FIRST_ADMIN_BOOTSTRAP !== 'true'/);
  assert.match(script, /!stdin\.isTTY \|\| !stdout\.isTTY/);
  assert.match(script, /Password \(input hidden\)/);
  assert.doesNotMatch(script, /process\.argv\[2\]|--password|CREATE TABLE|DROP TABLE|TRUNCATE/);
});
