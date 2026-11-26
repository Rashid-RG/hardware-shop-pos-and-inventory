import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hardware_pos_ci') {
  throw new Error('Refusing authenticated API test outside isolated hardware_pos_ci database.');
}
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let origin = '';

test('real login, logout and password rotation revoke previous session tokens', { timeout: 120000 }, async () => {
  const suffix = randomUUID();
  const email = 'ci-auth-' + suffix + '@example.invalid';
  const password = 'StrongCI-A1-' + suffix.slice(0, 16);
  const updatedPassword = 'StrongCI-B2-' + suffix.slice(0, 16);
  const userId = 'ci-auth-' + suffix;
  let child;
  let output = '';
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL, password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(
      'INSERT INTO users (id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,$5)',
      [userId, email, 'CI Login Worker', 'Cashier', bcrypt.hashSync(password, 10)]
    );

    child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env, NODE_ENV: 'production', PORT: '0', ARS_LISTEN_HOST: '127.0.0.1',
        PASSWORD_RECOVERY_ENABLED: 'false',
        JWT_SECRET: 'auth_ci_hex_721e5bfc1d3a6e094b9c503e88cc2247',
        ADMIN_PASSWORD: 'admin-CI-28-value-long',
        MANAGER_PASSWORD: 'manager-CI-28-value-long',
        WHOLESALE_MANAGER_PASSWORD: 'wholesale-CI-28-value-long',
        CASHIER_PASSWORD: 'cashier-CI-28-value-long',
        INVENTORY_PASSWORD: 'inventory-CI-28-value-long',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });

    let ready = false;
    for (let n = 0; n < 90; n++) {
      if (child.exitCode != null) break;
      const bound = output.match(/Server fully functional on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!bound) { await pause(300); continue; }
      origin = 'http://127.0.0.1:' + bound[1];
      try {
        const res = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(600) });
        if (res.ok) { ready = true; break; }
      } catch {}
      await pause(350);
    }
    assert.ok(ready, 'POS server failed to start: ' + output.slice(-3000));

    const recoveryStatus = await fetch(origin + '/api/auth/recovery-status');
    assert.equal(recoveryStatus.status, 200);
    assert.equal((await recoveryStatus.json()).emailEnabled, false);
    const disabledRecovery = await fetch(origin + '/api/auth/recovery/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.equal(disabledRecovery.status, 503, 'Unconfigured email recovery must fail closed');

    const login = async (pass) => fetch(origin + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, shopId: 'shop-main' }),
    });
    const withToken = (token) => ({ Authorization: 'Bearer ' + token });
    const first = await login(password);
    assert.equal(first.status, 200, output.slice(-3000));
    const firstJson = await first.json();
    assert.ok(firstJson.token);
    const valid = await fetch(origin + '/api/profile', { headers: withToken(firstJson.token) });
    assert.equal(valid.status, 200);
    // Packaging mutation endpoints must reject unauthorized roles before touching stock.
    for (const [method,action] of [['PUT','packaging-draft'],['GET','packaging-eligibility'],['POST','packaging-activate'],['PUT','packaging-prices']]) {
      const endpoint=origin+'/api/products/nonexistent-ci-product/'+action;
      const anonymous=await fetch(endpoint,{method});
      assert.equal(anonymous.status,401,action+' requires authentication');
      const forbidden=await fetch(endpoint,{method,headers:withToken(firstJson.token)});
      assert.equal(forbidden.status,403,action+' must reject cashier access');
    }
    // Confidential payroll endpoints must reject anonymous and cashier requests.
    const payrollPaths=['policies','policies/effective?period=2026-11','proposals?period=2026-11','statutory-settlements/reconciliation?period=2026-11','statutory-settlements/banks','statutory-settlements/balances?period=2026-11','statutory-settlements?period=2026-11','advances/reconciliation','statutory-settlements/controls','salary-payable/reconciliation','accounting-overview','reconciliation?period=2026-11','monthly-report/pdf?period=2026-11','monthly-report?period=2026-11','payslips/ci-missing/pdf','salary-payments/balances?period=2026-11','salary-payments?period=2026-11','advances','advances/balances','eligibility','eligibility/effective?period=2026-11'];
    const payrollWrites=['policies','policies/ci-missing/review','statutory-settlements','salary-payments','advances','advances/ci-missing/review','advances/ci-missing/disburse','advances/ci-missing/repay','eligibility','eligibility/ci-missing/review','calculate-statutory','calculate','proposals','proposals/ci-missing/review','proposals/ci-missing/post'];
    for(const [method,paths] of [['GET',payrollPaths],['POST',payrollWrites]])for(const path of paths){
      const endpoint=origin+'/api/ars/payroll/'+path;
      const anonymous=await fetch(endpoint,{method});assert.equal(anonymous.status,401,path+' requires authentication');await anonymous.text();
      const forbidden=await fetch(endpoint,{method,headers:{...withToken(firstJson.token),'X-Shop-Id':'shop-main'}});assert.equal(forbidden.status,403,path+' must reject cashier access');await forbidden.text();
    }
    const logout = await fetch(origin + '/api/auth/logout', {
      method: 'POST', headers: withToken(firstJson.token),
    });
    assert.equal(logout.status, 200);
    const signedOut = await fetch(origin + '/api/profile', { headers: withToken(firstJson.token) });
    assert.equal(signedOut.status, 401, 'Signed-out token must be revoked');

    const second = await login(password);
    assert.equal(second.status, 200, output.slice(-3000));
    const secondJson = await second.json();
    const rotate = await fetch(origin + '/api/profile', {
      method: 'PUT', headers: { ...withToken(secondJson.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: password, newPassword: updatedPassword }),
    });
    assert.equal(rotate.status, 200, output.slice(-3000));
    const rotated = await rotate.json();
    assert.ok(rotated.token);
    const stale = await fetch(origin + '/api/profile', { headers: withToken(secondJson.token) });
    assert.equal(stale.status, 401, 'Password rotation must invalidate old token');
    const fresh = await fetch(origin + '/api/profile', { headers: withToken(rotated.token) });
    assert.equal(fresh.status, 200);
    const wrongPassword = await login(password);
    assert.equal(wrongPassword.status, 401);
    const newPasswordLogin = await login(updatedPassword);
    assert.equal(newPasswordLogin.status, 200);
  } finally {
    if (child && child.exitCode == null) {
      child.kill('SIGTERM');
      for (let n = 0; n < 30 && child.exitCode == null; n++) await pause(100);
      if (child.exitCode == null) child.kill('SIGKILL');
    }
    await pool.end();
  }
});
