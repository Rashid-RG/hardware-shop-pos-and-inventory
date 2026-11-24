import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { provisionFirstAdmin } from '../scripts/provision-first-admin.mjs';

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
let origin = '';
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
        PORT: '0', ARS_LISTEN_HOST: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });

    let started = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode != null) break;
      const bound = output.match(/Server fully functional on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!bound) { await sleep(300); continue; }
      origin = 'http://127.0.0.1:' + bound[1];
      try {
        const response = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(500) });
        if (response.ok) { started = true; break; }
      } catch {}
      await sleep(300);
    }
    assert.ok(started, 'New database POS startup failed: ' + output.slice(-2000));

    // Opening a newly created company database must never populate example
    // inventory, people, orders or financial records from the old demo.
    const freshProbe = new Client({ connectionString: scratchUrl.href });
    try {
      await freshProbe.connect();
      for (const table of ['users', 'products', 'customers', 'suppliers', 'employees',
        'sales_transactions', 'purchase_orders', 'manual_expenses']) {
        const count = await freshProbe.query('SELECT COUNT(*)::int AS n FROM "' + table + '"');
        assert.equal(count.rows[0].n, 0, 'Unexpected demo rows in fresh table ' + table);
      }
      const shop = await freshProbe.query("SELECT store_name FROM store_settings WHERE id='default'");
      assert.equal(shop.rows[0]?.store_name, 'ARS Distributor');
    } finally {
      await freshProbe.end().catch(() => {});
    }


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

    // ARS importer and partnership modules must behave against real isolated
    // PostgreSQL tables with an authenticated administrator.
    const authorized = (method = 'GET', body) => ({
      method,
      headers: { Authorization: 'Bearer ' + data.token, 'X-Shop-Id': 'shop-main',
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const anonymousPartners = await fetch(origin + '/api/ars/partners');
    assert.equal(anonymousPartners.status, 401, 'Partner financial data must require authentication');
    const firstPartner = await fetch(origin + '/api/ars/partners', authorized('POST', {
      name: 'Test Import Partner 1', ownershipPercent: 60,
    }));
    assert.equal(firstPartner.status, 201, await firstPartner.text().then(t => 'Partner create failed: ' + t));
    // Check partnership transaction does not infer additional owners or shares.
    const firstPartnerId = (await (await fetch(origin + '/api/ars/partners', authorized())).json()).partners[0].id;
    const partnerCapital = await fetch(origin + '/api/ars/partner-capital', authorized('POST', {
      partnerId: firstPartnerId, entryType: 'Contribution', amountLkr: 5000.25,
      reference: 'CI-BANK-REF-01', note: 'Test funding only', entryDate: '2026-11-22',
    }));
    assert.equal(partnerCapital.status, 201, 'Authenticated capital insert failed');
    const capitalResponse = await fetch(origin + '/api/ars/partners', authorized());
    const partnerLedger = await capitalResponse.json();
    assert.equal(partnerLedger.partners.length, 1);
    assert.equal(partnerLedger.entries.length, 1);
    assert.equal(partnerLedger.entries[0].reference, 'CI-BANK-REF-01');
    const excessiveShares = await fetch(origin + '/api/ars/partners', authorized('POST', {
      name: 'Second Partner', ownershipPercent: 50,
    }));
    assert.equal(excessiveShares.status, 409, 'Total ownership must never exceed 100%');
    const nonexistentShipment = await fetch(origin + '/api/ars/import-shipments', authorized('POST', {
      purchaseOrderId: 'no-such-order', shipmentReference: 'TEST-BL-01',
      currency: 'CNY', exchangeRateLkr: 45, freightLkr: 300,
      customsLkr: 50, clearanceLkr: 25,
    }));
    assert.equal(nonexistentShipment.status, 409, 'Shipments must reference a valid open purchase order');
    const shipments = await fetch(origin + '/api/ars/import-shipments', authorized());
    assert.equal(shipments.status, 200);
    assert.deepEqual(await shipments.json(), []);

    const scratch = new Client({ connectionString: scratchUrl.href });
    try {
      await scratch.connect();
      await assert.rejects(
        provisionFirstAdmin(scratch, {
          name: 'Unexpected second owner', email: 'second-owner@example.invalid',
          password: 'Second-Strong-Owner-2026#',
        }),
        /First administrator already exists/,
        'Console provisioning must honor the same permanent one-owner bootstrap rule',
      );
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
