import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {initGeneralLedger,validateJournal} from '../backend/generalLedger.ts';

const url=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
assert.equal(url.pathname,'/hardware_pos_ci','Refuse non-CI database');

test('journal arithmetic uses exact cents and rejects malformed entries',()=>{
 const d=(amount)=>({accountCode:'1000',debit:amount,credit:'0'});
 const c=(amount)=>({accountCode:'3000',debit:'0',credit:amount});
 assert.deepEqual(validateJournal([d('0.10'),d('0.20'),c('0.30')]),{totalCents:'30'});
 for(const lines of [[d('1'),c('0.99')],[d('1.001'),c('1.001')],[d('0'),c('0')],[d('-1'),c('-1')],[d('1')]]) assert.throws(()=>validateJournal(lines));
});

test('PostgreSQL journal constraints and transaction rollback', {timeout:60000},async()=>{
 const db=new pg.Client({connectionString:url.toString()});
 const suffix=randomUUID().replaceAll('-','');
 const schema='gl_ci_'+suffix;
 const shop='shop-a',other='shop-b';
 const day='2026-01-01';
 await db.connect();
 try{
  await db.query('CREATE SCHEMA '+schema);
  await db.query('SET search_path TO '+schema);
  await initGeneralLedger(db);
  await db.query("INSERT INTO ars_gl_accounts(shop_id,code,name,kind,active) VALUES ($1,'1000','Cash','Asset',true),($1,'3000','Capital','Equity',true),($1,'5000','Inactive','Expense',false),($2,'9999','Other shop','Asset',true)",[shop,other]);
  const header=(id,source=id,date=day)=>db.query("INSERT INTO ars_gl_journals(shop_id,id,posting_date,source_kind,source_id,description,recorded_by) VALUES ($1,$2,$3,'Test',$4,'CI fixture','CI')",[shop,id,date,source]);
  const line=(id,n,code,d,c)=>db.query("INSERT INTO ars_gl_lines(shop_id,journal_id,line_no,account_code,debit,credit) VALUES ($1,$2,$3,$4,$5,$6)",[shop,id,n,code,d,c]);
  const rejected=async(fn,code='23514')=>{
   await db.query('BEGIN');
   try{await assert.rejects(async()=>{await fn();await db.query('COMMIT');},e=>e.code===code);}
   finally{await db.query('ROLLBACK');}
  };
  await rejected(()=>header('disabled'));
  await db.query("INSERT INTO ars_gl_cutover(shop_id,cutover_date,evidence,approved_by,posting_enabled) VALUES ($1,$2,'CI sample','CI',true)",[shop,day]);
  await rejected(()=>header('before','before','2025-12-31'));
  await rejected(()=>header('empty'));
  await rejected(async()=>{await header('unbalanced');await line('unbalanced',1,'1000','10','0');await line('unbalanced',2,'3000','0','9');});
  await rejected(async()=>{await header('inactive');await line('inactive',1,'5000','10','0');});
  await rejected(async()=>{await header('cross-shop');await line('cross-shop',1,'9999','10','0');});
  assert.equal((await db.query('SELECT count(*)::int n FROM ars_gl_journals')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM ars_gl_lines')).rows[0].n,0);
  await db.query('BEGIN');
  await header('balanced');
  await line('balanced',1,'1000','10.10','0');
  await line('balanced',2,'3000','0','10.10');
  await db.query('COMMIT');
  await rejected(()=>header('duplicate','balanced'),'23505');
  await rejected(()=>line('balanced',3,'1000','1','0'));
  for(const sql of ["UPDATE ars_gl_lines SET debit=20 WHERE line_no=1","DELETE FROM ars_gl_lines","UPDATE ars_gl_journals SET description='Changed'","DELETE FROM ars_gl_journals"]) await rejected(()=>db.query(sql));
  assert.deepEqual((await db.query('SELECT count(*)::int n,sum(debit)::text debit,sum(credit)::text credit FROM ars_gl_lines')).rows[0],{n:2,debit:'10.10',credit:'10.10'});
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.query('SET search_path TO public');
  await db.query('DROP SCHEMA '+schema+' CASCADE');
  await db.end();
 }
});

import {buildSalesJournal} from '../backend/salesJournal.ts';
test('wholesale sales journal records net revenue, tax and selling-unit inventory costs',()=>{
 const accounts={destination:'1200',sales:'4000',tax:'2200',inventory:'1300',costOfGoods:'5000'};
 const invoice={total:'3000.00',tax:'300.00',items:[{quantity:4,costPerSellingUnit:'500.00'}]};
 assert.deepEqual(buildSalesJournal(invoice,accounts),[
 {accountCode:'1200',debit:'3000.00',credit:'0.00'},
 {accountCode:'4000',debit:'0.00',credit:'2700.00'},
 {accountCode:'2200',debit:'0.00',credit:'300.00'},
 {accountCode:'5000',debit:'2000.00',credit:'0.00'},
 {accountCode:'1300',debit:'0.00',credit:'2000.00'}]);
 const cash=buildSalesJournal({total:'12000',tax:'0',items:[{quantity:2,costPerSellingUnit:'4500'}]},{...accounts,destination:'1000'});
 assert.equal(cash.length,4);
 assert.equal(cash[0].accountCode,'1000');
 assert.equal(cash[2].debit,'9000.00');
 assert.equal(validateJournal(cash).totalCents,'2100000');
 for(const bad of [{...invoice,tax:'3001'},{...invoice,total:'0'},{...invoice,items:[]},{...invoice,items:[{quantity:0,costPerSellingUnit:'500'}]},{...invoice,items:[{quantity:1.5,costPerSellingUnit:'500'}]},{...invoice,items:[{quantity:4,costPerSellingUnit:'0'}]},{...invoice,items:[{quantity:4,costPerSellingUnit:'0.001'}]}])assert.throws(()=>buildSalesJournal(bad,accounts));
 assert.throws(()=>buildSalesJournal(invoice,{...accounts,inventory:'1200'}));
 assert.throws(()=>buildSalesJournal(invoice,{...accounts,tax:'bad'}));
});

import {allocateSupplierPayment,allocateSupplierReceipt,supplierOrderBalances,supplierReceiptCredits} from '../backend/supplierAdvance.ts';
import {postJournal} from '../backend/ledgerPosting.ts';

test('supplier advance allocation uses exact cents over multiple receipts',()=>{
 assert.deepEqual(allocateSupplierPayment(30000n,0n),{applied:0n,advance:30000n});
 assert.deepEqual(allocateSupplierReceipt(20000n,30000n),{applied:20000n,payable:0n});
 assert.deepEqual(allocateSupplierReceipt(40000n,10000n),{applied:10000n,payable:30000n});
 assert.deepEqual(allocateSupplierPayment(70000n,70000n),{applied:70000n,advance:0n});
 assert.deepEqual(allocateSupplierPayment(10001n,10000n),{applied:10000n,advance:1n});
 for(const fn of [allocateSupplierPayment,allocateSupplierReceipt]){assert.throws(()=>fn(0n,0n));assert.throws(()=>fn(100n,-1n));}
});

test('supplier order journal balances across partial receipts, settlement and rollback', {timeout:60000},async()=>{
 const db=new pg.Client({connectionString:url.toString()}),schema='advance_ci_'+randomUUID().replaceAll('-','');
 const shop='shop-a',day='2026-01-01',po='po-1';
 await db.connect();
 try{
  await db.query('CREATE SCHEMA '+schema);
  await db.query('SET search_path TO '+schema);
  await initGeneralLedger(db);
  // Minimal operational fixtures: deliberately isolated from real shop tables.
  await db.query(`CREATE TABLE purchase_orders(id text PRIMARY KEY,shop_id text NOT NULL);
   CREATE TABLE supplier_payments(id text PRIMARY KEY,shop_id text NOT NULL,purchase_order_id text);
   CREATE TABLE ars_receipt_batches(id text PRIMARY KEY,shop_id text NOT NULL,purchase_order_id text NOT NULL);
   INSERT INTO purchase_orders VALUES ('po-1','shop-a'),('po-2','shop-a'),('po-3','shop-b');
   INSERT INTO ars_gl_accounts(shop_id,code,name,kind) VALUES ('shop-a','1000','Bank','Asset'),('shop-a','1250','Advance','Asset'),('shop-a','1300','Inventory','Asset'),('shop-a','2000','Payables','Liability');
   INSERT INTO ars_gl_account_mappings(shop_id,mapping_kind,source_id,account_code,evidence,recorded_by) VALUES ('shop-a','supplierAdvances','control','1250','CI','CI'),('shop-a','supplierPayables','control','2000','CI','CI');
   INSERT INTO ars_gl_cutover(shop_id,cutover_date,evidence,approved_by,posting_enabled) VALUES ('shop-a','2026-01-01','CI','CI',true);
  `);
  const journal=(id,kind,source,lines)=>postJournal(db,{id,shopId:shop,postingDate:day,sourceKind:kind,sourceId:source,description:'CI fixture',actor:'CI',lines});
  const d=(accountCode,debit)=>({accountCode,debit,credit:'0.00'}),c=(accountCode,credit)=>({accountCode,debit:'0.00',credit});
  const balances=async(order=po)=>{const b=await supplierOrderBalances(db,shop,order);return [b.advance,b.payable];};
  await db.query('BEGIN');
  await db.query("INSERT INTO supplier_payments VALUES ('payment-1','shop-a','po-1')");
  await journal('payment:1','SupplierPayment','payment-1',[d('1250','300.00'),c('1000','300.00')]);
  await db.query('COMMIT');
  assert.deepEqual(await balances(),[30000n,0n]);
  assert.deepEqual(await balances('po-2'),[0n,0n]);
  async function receive(id,cents,amount,commit=true){
   await db.query('BEGIN');
   await db.query('INSERT INTO ars_receipt_batches VALUES ($1,$2,$3)',[id,shop,po]);
   const credits=await supplierReceiptCredits(db,shop,po,cents);
   await journal('receipt:'+id,'ReceiptBatch',id,[d('1300',amount),...credits]);
   await db.query(commit?'COMMIT':'ROLLBACK');
  }
  await receive('r1',20000n,'200.00');
  assert.deepEqual(await balances(),[10000n,0n]);
  await receive('r2',40000n,'400.00',false);
  assert.deepEqual(await balances(),[10000n,0n]);
  await receive('r2',40000n,'400.00');
  assert.deepEqual(await balances(),[0n,30000n]);
  await receive('r3',40000n,'400.00');
  assert.deepEqual(await balances(),[0n,70000n]);
  await db.query('BEGIN');
  await db.query("INSERT INTO supplier_payments VALUES ('payment-2','shop-a','po-1')");
  await journal('payment:2','SupplierPayment','payment-2',[d('2000','700.00'),c('1000','700.00')]);
  await db.query('COMMIT');
  assert.deepEqual(await balances(),[0n,0n]);
  await db.query('BEGIN');
  await assert.rejects(()=>journal('duplicate','ReceiptBatch','r1',[d('1300','200.00'),c('1250','200.00')]));
  await db.query('ROLLBACK');
  assert.deepEqual(await balances(),[0n,0n]);
  await assert.rejects(()=>balances('po-3'),/order not found/);
  await db.query("INSERT INTO supplier_payments VALUES ('historical','shop-a','po-2')");
  await assert.rejects(()=>balances('po-2'),/Historical supplier payments/);
 }finally{
  await db.query('ROLLBACK').catch(()=>{});
  await db.query('SET search_path TO public');
  await db.query('DROP SCHEMA '+schema+' CASCADE');
  await db.end();
 }
});
