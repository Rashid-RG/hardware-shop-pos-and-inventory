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

    const adminEmail='ci-payroll-admin-'+suffix+'@example.invalid';
    await pool.query('INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5)', ['ci-payroll-admin-'+suffix,adminEmail,'CI Payroll Administrator','Super Admin',bcrypt.hashSync(password,10)]);

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
    const adminLogin=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:adminEmail,password,shopId:'shop-main'})});
    assert.equal(adminLogin.status,200,'Administrator login failed');
    const adminSession=await adminLogin.json();assert.equal(adminSession.user.scopedShopId,'shop-main');
    const adminHeaders={...withToken(adminSession.token),'X-Shop-Id':'shop-main'};
    for(const path of ['accounting-overview','salary-payable/reconciliation','advances/reconciliation','statutory-settlements/controls','monthly-report?period=1901-01','reconciliation?period=1901-01']){
      const response=await fetch(origin+'/api/ars/payroll/'+path,{headers:adminHeaders});
      assert.equal(response.status,200,path+' administrator read failed');
      assert.match(response.headers.get('cache-control')||'',/no-store/);
      const data=await response.json();assert.equal(data.postingEnabled,false,path+' must not enable posting');
      const denied=await fetch(origin+'/api/ars/payroll/'+path,{headers:{...adminHeaders,'X-Shop-Id':'ci-unauthorized-shop-'+suffix}});
      assert.equal(denied.status,403,path+' must reject unauthorized shop header');await denied.text();
    }
    for(const path of ['salary-payments','statutory-settlements','advances/ci-missing/disburse','advances/ci-missing/repay','proposals/ci-missing/post']){
      const response=await fetch(origin+'/api/ars/payroll/'+path,{method:'POST',headers:adminHeaders});
      assert.equal(response.status,409,path+' posting must remain locked');await response.text();
    }
    // Exercise the real authenticated GRN route using committed, isolated CI fixtures.
    const poId='ci-grn-po-'+suffix,batchId='ci-grn-'+suffix,otherPo='ci-other-po-'+suffix,otherBatch='ci-other-grn-'+suffix;
    const grnPath=(po,batch)=>origin+'/api/ars/purchases/'+encodeURIComponent(po)+'/receipts/'+encodeURIComponent(batch)+'/document';
    const endpoint=grnPath(poId,batchId);
    assert.equal((await fetch(endpoint)).status,401);
    assert.equal((await fetch(endpoint,{headers:{...withToken(firstJson.token),'X-Shop-Id':'shop-main'}})).status,403);
    assert.equal((await fetch(endpoint,{headers:adminHeaders})).status,404);
    // Existing purchase and receipt tables are initialized by the running server.
    const supplier='ci-grn-supplier-'+suffix,product='ci-grn-product-'+suffix;
    await pool.query("INSERT INTO suppliers(id,shop_id,name,company_name,phone) VALUES($1,'shop-main','CI GRN Supplier','CI GRN Supplier','')",[supplier]);
    await pool.query("INSERT INTO products(id,shop_id,name,sku,brand,category,cost_price,selling_price,quantity,reorder_level,warranty,description,variants_json) VALUES($1,'shop-main','CI GRN Lock',$2,'CI','Parts',10,20,0,1,'None','CI','[]'::jsonb)",[product,product]);
    await pool.query("INSERT INTO purchase_orders(id,shop_id,po_number,date,supplier_id,supplier_name,total,status) VALUES($1,'shop-main',$2,NOW(),$3,'CI GRN Supplier',100,'Partially Received')",[poId,poId,supplier]);
    const line=await pool.query("INSERT INTO purchase_order_items(purchase_order_id,product_id,product_name,quantity,cost_price,selling_unit_label,base_units_per_purchase_unit) VALUES($1,$2,'CI GRN Lock',10,10,'Box',5) RETURNING id",[poId,product]);
    await pool.query("INSERT INTO ars_receipt_batches(id,shop_id,purchase_order_id,request_key,received_by,note) VALUES($1,'shop-main',$2,$1,'CI Receiver','First batch'),($3,'shop-main',$2,$3,'CI Receiver','Second batch')",[batchId,poId,batchId+'-second']);
    await pool.query("INSERT INTO ars_receipt_batch_items(batch_id,purchase_order_item_id,quantity) VALUES($1,$2,2),($3,$2,3)",[batchId,line.rows[0].id,batchId+'-second']);
    const beforeStock=await pool.query('SELECT quantity FROM products WHERE id=$1',[product]);
    for(let repeat=0;repeat<2;repeat++){
      const result=await fetch(endpoint,{headers:adminHeaders});assert.equal(result.status,200,'GRN read failed');
      assert.match(result.headers.get('cache-control')||'',/no-store/);
      const grn=await result.json();
      assert.equal(grn.id,batchId);assert.equal(grn.shopId,'shop-main');assert.equal(grn.recorded_count,1);
      assert.deepEqual(grn.items,[{productName:'CI GRN Lock',unit:'Box',quantity:2,baseUnitsPerUnit:5}]);
      assert.equal(grn.note,'First batch');assert.ok(!('request_key' in grn));
    }
    assert.equal((await fetch(grnPath(poId,batchId+'-missing'),{headers:adminHeaders})).status,404);
    assert.equal((await fetch(grnPath(otherPo,batchId),{headers:adminHeaders})).status,404);
    assert.equal((await fetch(endpoint,{headers:{...adminHeaders,'X-Shop-Id':'ci-unauthorized-shop-'+suffix}})).status,403);
    assert.deepEqual((await pool.query('SELECT quantity FROM products WHERE id=$1',[product])).rows,beforeStock.rows);
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM ars_receipt_batches WHERE purchase_order_id=$1',[poId])).rows[0].n),2);
    const adminLogout=await fetch(origin+'/api/auth/logout',{method:'POST',headers:adminHeaders});assert.equal(adminLogout.status,200);
    const revoked=await fetch(origin+'/api/ars/payroll/accounting-overview',{headers:adminHeaders});assert.equal(revoked.status,401);await revoked.text();
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
