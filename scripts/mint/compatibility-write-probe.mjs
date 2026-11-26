// Synthetic write probe. Invoke only in disconnected disposable update-test containers.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
// Resolve dependencies from the isolated application root even when invoked via a data URL.
const pg = createRequire('/app/package.json')('pg');
const url=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
assert.equal(url.hostname,'127.0.0.1');
assert.equal(url.pathname,'/ars_update_test');
assert.equal(url.username,'restore_admin');
assert.equal(process.env.ARS_LISTEN_HOST,'127.0.0.1');
assert.equal(process.env.ARS_TEST_ALLOW_WRITES,'isolated-disposable');
const {ARS_TEST_EMAIL:email,ARS_TEST_PASSWORD:password,ARS_TEST_SHOP:shopId}=process.env;
assert.ok(email?.endsWith('@example.invalid')&&password&&shopId);
const pool=new pg.Pool({connectionString:url.toString()});
const suffix=randomUUID();
let token;
async function request(path,method='GET',body,expected=200){
  const headers={'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  const res=await fetch('http://127.0.0.1:3000'+path+(path.includes('?')?'&':'?')+'shopId='+encodeURIComponent(shopId),{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  assert.equal(res.status,expected,path+' HTTP status');
  return res.json();
}
async function scalar(sql,args){
  const r=await pool.query(sql,args);
  assert.equal(r.rowCount,1);
  return Number(Object.values(r.rows[0])[0]);
}
try{
  token=(await request('/api/auth/login','POST',{email,password,shopId})).token;
  assert.ok(token);
  const product=await request('/api/products','POST',{name:'Update test product '+suffix,sku:'UT-'+suffix,barcode:'UT-'+suffix,category:'Hardware',costPrice:50,sellingPrice:100,quantity:10,reorderLevel:2,description:'Synthetic update test'});
  const customer=await request('/api/customers','POST',{name:'Update test customer '+suffix,creditLimit:100000});
  const rep=await request('/api/employees','POST',{name:'Update test representative '+suffix,role:'Cashier',salary:0},201);
  const account=await request('/api/financial-accounts','POST',{name:'Update test cash '+suffix,kind:'Office Cash'},201);
  const invoice={requestId:randomUUID(),cartItems:[{product:{id:product.id,name:product.name},quantity:2,discount:0}],customerId:customer.id,salesRepId:rep.id,paymentMethod:'Credit Account',discountAmount:0};
  const tx=await request('/api/transactions','POST',invoice);
  assert.ok(tx.id&&Number(tx.total)>=200);
  assert.equal(Number(tx.subtotal),200);
  assert.equal(await scalar('SELECT quantity FROM products WHERE id=$1 AND shop_id=$2',[product.id,shopId]),8);
  assert.equal(await scalar('SELECT credit_balance FROM customers WHERE id=$1 AND shop_id=$2',[customer.id,shopId]),Number(tx.total));
  const replay=await request('/api/transactions','POST',invoice);
  assert.equal(replay.id,tx.id);
  assert.equal(await scalar('SELECT quantity FROM products WHERE id=$1 AND shop_id=$2',[product.id,shopId]),8);
  await request('/api/transactions','POST',{...invoice,requestId:randomUUID(),cartItems:[{product:{id:product.id,name:product.name},quantity:99}]},400);
  assert.equal(await scalar('SELECT quantity FROM products WHERE id=$1 AND shop_id=$2',[product.id,shopId]),8);
  const payment={requestId:randomUUID(),invoiceId:tx.id,amount:50,paymentMethod:'Cash',destinationAccountId:account.id};
  const paid=await request('/api/customers/'+customer.id+'/credit-payment','POST',payment);
  assert.equal(Number(paid.customer.creditBalance),Number(tx.total)-50);
  const accounts=await request('/api/financial-accounts');
  const rows=Array.isArray(accounts)?accounts:accounts.accounts;
  assert.ok(Array.isArray(rows),'Financial account response');
  assert.equal(Number(rows.find(x=>x.id===account.id)?.balance),50);
  await request('/api/customers/'+customer.id+'/credit-payment','POST',payment);
  assert.equal(await scalar('SELECT credit_balance FROM customers WHERE id=$1 AND shop_id=$2',[customer.id,shopId]),Number(tx.total)-50);
  assert.equal(await scalar('SELECT count(*) FROM customer_credit_payments WHERE customer_id=$1 AND shop_id=$2',[customer.id,shopId]),1);
  console.log('Synthetic invoice, duplicate prevention, stock and customer collection checks passed.');
}finally{
  if(token)await request('/api/auth/logout','POST').catch(()=>{});
  await pool.end();
}
