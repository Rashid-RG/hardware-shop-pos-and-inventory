// Only the dedicated restored database and HTTP port of the disposable Windows CI job.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
assert.equal(process.platform,'win32');
assert.equal(process.env.ARS_NATIVE_CI,'disposable-windows-runner');
assert.equal(process.env.DATABASE_URL,'postgresql://restore_admin@127.0.0.1:55433/ars_native_restored_ci');
assert.equal(process.env.PORT,'30123');
assert.equal(process.env.ARS_LISTEN_HOST,'127.0.0.1');
const {ARS_TEST_EMAIL:email,ARS_TEST_PASSWORD:password}=process.env;
assert.ok(email?.endsWith('@example.invalid')&&password);
const shopId='shop-main', suffix=randomUUID();
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
let token;
async function request(path,method='GET',body,expected=200){
 const headers={'Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 const res=await fetch('http://127.0.0.1:30123'+path+(path.includes('?')?'&':'?')+'shopId='+shopId,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 assert.equal(res.status,expected,path+' HTTP status');
 return res.json();
}
async function scalar(sql,args){
 const result=await pool.query(sql,args);
 assert.equal(result.rowCount,1);
 return Number(Object.values(result.rows[0])[0]);
}
try{
 await request('/api/financial-accounts','GET',undefined,401);
 token=(await request('/api/auth/login','POST',{email,password,shopId})).token;
 assert.ok(token);
 await request('/api/profile');
 for(const endpoint of ['/api/financial-accounts','/api/receivable-aging','/api/supplier-payable-aging','/api/inventory-valuation','/api/financial-position']) await request(endpoint);
 const product=await request('/api/products','POST',{name:'Native CI product '+suffix,sku:'NC-'+suffix,barcode:'NC-'+suffix,category:'Hardware',costPrice:50,sellingPrice:100,quantity:10,reorderLevel:2,description:'Synthetic CI'});
 const customer=await request('/api/customers','POST',{name:'Native CI customer '+suffix,creditLimit:100000});
 const rep=await request('/api/employees','POST',{name:'Native CI representative '+suffix,role:'Cashier',salary:0},201);
 const account=await request('/api/financial-accounts','POST',{name:'Native CI cash '+suffix,kind:'Office Cash'},201);
 const invoice={requestId:randomUUID(),cartItems:[{product:{id:product.id,name:product.name},quantity:2,discount:0}],customerId:customer.id,salesRepId:rep.id,paymentMethod:'Credit Account',discountAmount:0};
 const tx=await request('/api/transactions','POST',invoice);
 assert.ok(tx.id);
 assert.equal(Number(tx.subtotal),200);
 const stock=()=>scalar('SELECT quantity FROM products WHERE id=$1 AND shop_id=$2',[product.id,shopId]);
 const credit=()=>scalar('SELECT credit_balance FROM customers WHERE id=$1 AND shop_id=$2',[customer.id,shopId]);
 assert.equal(await stock(),8);
 assert.equal(await credit(),Number(tx.total));
 assert.equal((await request('/api/transactions','POST',invoice)).id,tx.id);
 assert.equal(await stock(),8);
 await request('/api/transactions','POST',{...invoice,requestId:randomUUID(),cartItems:[{product:{id:product.id,name:product.name},quantity:99}]},400);
 assert.equal(await stock(),8);
 const payment={requestId:randomUUID(),invoiceId:tx.id,amount:50,paymentMethod:'Cash',destinationAccountId:account.id};
 await request('/api/customers/'+customer.id+'/credit-payment','POST',payment);
 assert.equal(await credit(),Number(tx.total)-50);
 await request('/api/customers/'+customer.id+'/credit-payment','POST',payment);
 assert.equal(await credit(),Number(tx.total)-50);
 assert.equal(await scalar('SELECT count(*) FROM customer_credit_payments WHERE customer_id=$1 AND shop_id=$2',[customer.id,shopId]),1);
 const accounts=await request('/api/financial-accounts');
 const rows=Array.isArray(accounts)?accounts:accounts.accounts;
 assert.equal(Number(rows.find(x=>x.id===account.id)?.balance),50);
 await request('/api/auth/logout','POST');
 token=undefined;
 await request('/api/profile','GET',undefined,401);
 console.log('Native restored CI: authenticated financial reads, invoice, stock, duplicate rejection, credit collection and logout passed.');
}finally{
 if(token)await request('/api/auth/logout','POST').catch(()=>{});
 await pool.end();
}
