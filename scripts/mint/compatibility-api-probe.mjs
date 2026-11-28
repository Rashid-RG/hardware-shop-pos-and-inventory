// Run only inside the disconnected update-test container, with synthetic credentials.
import assert from 'node:assert/strict';
const db = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert.equal(db.hostname, '127.0.0.1');
assert.equal(db.pathname, '/ars_update_test');
assert.equal(process.env.ARS_LISTEN_HOST, '127.0.0.1');
const origin = 'http://127.0.0.1:3000';
const email = process.env.ARS_TEST_EMAIL;
const password = process.env.ARS_TEST_PASSWORD;
const shopId = process.env.ARS_TEST_SHOP;
assert.ok(email?.endsWith('@example.invalid') && password && shopId);
async function request(path, method='GET', token, body) {
  const headers = {'Content-Type':'application/json'};
  if(token) headers.Authorization = 'Bearer '+token;
  return fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
}
const endpoints=['/api/financial-accounts','/api/receivable-aging','/api/supplier-payable-aging','/api/inventory-valuation','/api/financial-position'];
for (const path of endpoints) assert.equal((await request(path)).status,401,path+' anonymous access');
const login=await request('/api/auth/login','POST',undefined,{email,password,shopId});
assert.equal(login.status,200,'Synthetic administrator login');
const {token}=await login.json();
assert.ok(token);
assert.equal((await request('/api/profile','GET',token)).status,200);
for(const path of endpoints){
  const response=await request(path+'?shopId='+encodeURIComponent(shopId),'GET',token);
  assert.equal(response.status,200,path+' authorized read');
  const data=await response.json();
  assert.ok(data && typeof data==='object',path+' structured data');
}
const logout=await request('/api/auth/logout','POST',token);
assert.equal(logout.status,200);
assert.equal((await request('/api/profile','GET',token)).status,401);
console.log('Authenticated financial read and session probes passed.');
