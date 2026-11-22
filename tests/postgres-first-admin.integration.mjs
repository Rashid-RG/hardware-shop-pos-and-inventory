import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

const sourceUrl = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['127.0.0.1', 'localhost'].includes(sourceUrl.hostname) || sourceUrl.pathname !== '/hardware_pos_ci') {
  throw new Error('Refusing first-admin setup integration outside isolated CI PostgreSQL.');
}
const { Client } = pg;
const dbName = 'hardware_pos_bootstrap_ci_' + randomUUID().replaceAll('-', '').slice(0, 12);
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const scratchUrl = new URL(sourceUrl);
scratchUrl.pathname = '/' + dbName;
const apiPort = 39388;
const origin = 'http://127.0.0.1:' + apiPort;
const email = 'ci-first-owner@example.invalid';
const password = 'CI-FirstOwner-Strong-31#';
const admin = new Client({ connectionString: adminUrl.href });

test('first owner setup creates only one PostgreSQL admin and becomes permanently unavailable', { timeout: 120000 }, async () => {
  let child;
  let output = '';
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE "' + dbName + '"');
    child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: scratchUrl.href,
        NODE_ENV: 'production',
        JWT_SECRET: 'ci-bootstrap-key-8c4b2e78d19f3a6c5e7f01b0a4d39567',
        PORT: String(apiPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });

    let started = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode != null) break;
      try {
        const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(500) });
        if (response.ok) { started = true; break; }
      } catch {}
      await sleep(300);
    }
    assert.ok(started, 'New database POS startup failed: ' + output.slice(-2000));

    const status = await fetch(origin + '/api/auth/setup-status');
    assert.equal(status.status, 200);
    assert.equal((await status.json()).setupRequired, true);

    const bad = await fetch(origin + '/api/auth/setup-admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'First Owner', email, password: 'short', confirmPassword: 'short' }),
    });
    assert.equal(bad.status, 400);

    const request = () => fetch(origin + '/api/auth/setup-admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'First Owner', email, password, confirmPassword: password }),
    });
    const created = await request();
    assert.equal(created.status, 201, 'Setup should succeed: ' + output.slice(-1200));
    assert.equal((await created.json()).success, true);

    const statusAfter = await fetch(origin + '/api/auth/setup-status');
    assert.equal((await statusAfter.json()).setupRequired, false);
    const retry = await request();
    assert.equal(retry.status, 409, 'Setup must reject all attempts when any user exists');

    const login = await fetch(origin + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, shopId: 'shop-main' }),
    });
    assert.equal(login.status, 200, output.slice(-1400));
    const data = await login.json();
    assert.equal(data.user.role, 'Super Admin');
    assert.ok(data.token);

    const scratch = new Client({ connectionString: scratchUrl.href });
    try {
      await scratch.connect();
      const result = await scratch.query('SELECT email, role FROM users');
      assert.equal(result.rowCount, 1);
      assert.equal(result.rows[0].email, email);
      assert.equal(result.rows[0].role, 'Super Admin');
    } finally {
      await scratch.end().catch(() => {});
    }
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(100);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    // Delete only the test database created by this exact test.
    await admin.query('DROP DATABASE IF EXISTS "' + dbName + '" WITH (FORCE)').catch(() => {});
    await admin.end();
  }
});
