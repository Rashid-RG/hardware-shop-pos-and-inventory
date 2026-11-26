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

import {buildImportReceiptJournal} from '../backend/importCapitalization.ts';
test('paid import charges capitalize once without a second cash payment',()=>{
 const base={goods:100000n,landed:125000n,rounding:0n,verifiedUnusedCharges:25000n,goodsCredits:[{accountCode:'2000',debit:'0.00',credit:'1000.00'}],inventoryAccount:'1300',expenseAccount:'5100',roundingAccount:'5050'};
 const lines=buildImportReceiptJournal(base);
 assert.deepEqual(lines,[{accountCode:'1300',debit:'1250.00',credit:'0.00'},{accountCode:'2000',debit:'0.00',credit:'1000.00'},{accountCode:'5100',debit:'0.00',credit:'250.00'}]);
 assert.equal(validateJournal(lines).totalCents,'125000');
 assert.deepEqual(buildImportReceiptJournal({...base,rounding:2n}).at(-1),{accountCode:'5050',debit:'0.00',credit:'0.02'});
 assert.deepEqual(buildImportReceiptJournal({...base,rounding:-2n}).at(-1),{accountCode:'5050',debit:'0.02',credit:'0.00'});
 assert.throws(()=>buildImportReceiptJournal({...base,verifiedUnusedCharges:24999n}));
 assert.throws(()=>buildImportReceiptJournal({...base,verifiedUnusedCharges:0n}));
 assert.throws(()=>buildImportReceiptJournal({...base,expenseAccount:'1300'}));
 assert.throws(()=>buildImportReceiptJournal({...base,landed:99999n}));
 const domestic=buildImportReceiptJournal({...base,landed:100000n,verifiedUnusedCharges:0n,expenseAccount:'',roundingAccount:''});
 assert.equal(domestic.length,2);
 assert.equal(validateJournal(domestic).totalCents,'100000');
});

import {allocateImportChargeFunding,buildImportLiabilityReceiptJournal,verifiedImportChargeFunding,recordImportReceiptAllocations} from '../backend/importCapitalization.ts';
import {settleImportCreditor} from '../backend/importSettlements.ts';
test('mixed import funding records separate creditor liability and avoids duplicate expenses',()=>{
 const i={goods:100000n,landed:130000n,rounding:-1n,fundedRemaining:10000n,approvedUnpaidRemaining:20000n,goodsCredits:[{accountCode:'2000',debit:'0.00',credit:'1000.00'}],inventoryAccount:'1300',expenseAccount:'5100',roundingAccount:'5050',importPayableAccount:'2050'};
 assert.deepEqual(allocateImportChargeFunding({charges:30000n,fundedRemaining:10000n,approvedUnpaidRemaining:20000n}),{paid:10000n,unpaid:20000n});
 const lines=buildImportLiabilityReceiptJournal(i);
 assert.deepEqual(lines,[{accountCode:'1300',debit:'1299.99',credit:'0.00'},{accountCode:'2000',debit:'0.00',credit:'1000.00'},{accountCode:'5100',debit:'0.00',credit:'100.00'},{accountCode:'2050',debit:'0.00',credit:'200.00'},{accountCode:'5050',debit:'0.01',credit:'0.00'}]);
 assert.equal(validateJournal(lines).totalCents,'130000');
 assert.throws(()=>buildImportLiabilityReceiptJournal({...i,approvedUnpaidRemaining:19999n}));
 assert.throws(()=>buildImportLiabilityReceiptJournal({...i,importPayableAccount:'2000'}));
});
test('PostgreSQL import creditor funding, partial allocation and settlement lifecycle',{timeout:60000},async()=>{
 const db=new pg.Client({connectionString:url.toString()}),schema='import_ci_'+randomUUID().replaceAll('-','');
 await db.connect();const shop='shop-a',day='2026-01-01';
 // A single connection adapter keeps settlement calls inside the isolated schema.
 const pool={connect:async()=>({query:db.query.bind(db),release:()=>{}})};
 try{
 await db.query('CREATE SCHEMA '+schema);await db.query('SET search_path TO '+schema);await initGeneralLedger(db);
 await db.query(`CREATE TABLE ars_landed_cost_approvals(id text PRIMARY KEY,shop_id text,purchase_order_id text,charges_total numeric(16,2),snapshot jsonb);
 CREATE TABLE ars_import_expense_links(shop_id text,approval_id text,charge_kind text,amount numeric(16,2),expense_id text);
 CREATE TABLE ars_receipt_batches(id text PRIMARY KEY,shop_id text,purchase_order_id text);
 CREATE TABLE ars_financial_accounts(id text PRIMARY KEY,shop_id text,kind text,active boolean);
 CREATE TABLE ars_financial_movements(id text PRIMARY KEY,shop_id text,account_id text,amount numeric(16,2),movement_kind text,source_id text,recorded_by text,effective_date date,note text);
 CREATE TABLE ars_supplier_cheques(id text PRIMARY KEY,shop_id text,bank_account_id text,status text,amount numeric(14,2));
 INSERT INTO ars_landed_cost_approvals VALUES('approval','shop-a','po',300,'{"freightLkr":100,"customsLkr":200,"clearanceLkr":0}');
 INSERT INTO ars_gl_accounts(shop_id,code,name,kind) VALUES('shop-a','1000','Bank','Asset'),('shop-a','1300','Inventory','Asset'),('shop-a','2000','Supplier','Liability'),('shop-a','2050','Import creditor','Liability'),('shop-a','5100','Expense','Expense');
 INSERT INTO ars_gl_account_mappings(shop_id,mapping_kind,source_id,account_code,evidence,recorded_by) VALUES('shop-a','importPayables','control','2050','CI','CI'),('shop-a','financialAccount','bank','1000','CI','CI');
 INSERT INTO ars_gl_cutover(shop_id,cutover_date,evidence,approved_by,posting_enabled) VALUES('shop-a','2026-01-01','CI','CI',true);
 INSERT INTO ars_financial_accounts VALUES('bank','shop-a','Bank',true);
 INSERT INTO ars_financial_movements VALUES('opening','shop-a','bank',500,'Opening Balance','opening','CI','2026-01-01','CI');
 INSERT INTO ars_gl_import_obligations(shop_id,id,approval_id,charge_kind,creditor_name,document_reference,amount,due_date,evidence,submitted_by) VALUES('shop-a','creditor','approval','Customs','Customs','INV-1',200,'2026-01-10','CI','submitter');
 INSERT INTO ars_gl_import_obligation_reviews(shop_id,obligation_id,decision,evidence,reviewed_by) VALUES('shop-a','creditor','Approved','CI','reviewer');`);
 const journal=(id,kind,source,lines)=>postJournal(db,{id,shopId:shop,postingDate:day,sourceKind:kind,sourceId:source,description:'CI',actor:'CI',lines});
 await db.query('BEGIN');
 await journal('expense','Expense','expense',[{accountCode:'5100',debit:'100.00',credit:'0.00'},{accountCode:'1000',debit:'0.00',credit:'100.00'}]);
 await db.query("INSERT INTO ars_import_expense_links VALUES('shop-a','approval','Freight',100,'expense')");
 await db.query('COMMIT');
 const settle={shopId:shop,id:'payment-1',obligationId:'creditor',accountId:'bank',amount:'50.00',date:day,evidence:'CI',actor:'CI'};
 await assert.rejects(()=>settleImportCreditor(pool,settle),/exceeds recognized/);
 async function receipt(id,charges,commit=true){
 await db.query('BEGIN');
 await db.query('INSERT INTO ars_receipt_batches VALUES($1,$2,$3)',[id,shop,'po']);
 const f=await verifiedImportChargeFunding(db,shop,'po','5100');
 const a=allocateImportChargeFunding({charges,fundedRemaining:f.fundedRemaining,approvedUnpaidRemaining:f.approvedUnpaidRemaining});
 const lines=buildImportLiabilityReceiptJournal({goods:100000n,landed:100000n+charges,rounding:0n,...f,goodsCredits:[{accountCode:'2000',debit:'0.00',credit:'1000.00'}],inventoryAccount:'1300',expenseAccount:'5100',roundingAccount:'',importPayableAccount:'2050'});
 const j=await journal('receipt:'+id,'ReceiptBatch',id,lines);
 await recordImportReceiptAllocations(db,shop,id,j.id,a.unpaid,f.available);
 await db.query(commit?'COMMIT':'ROLLBACK');
 }
 await receipt('r1',15000n);
 assert.equal((await verifiedImportChargeFunding(db,shop,'po','5100')).approvedUnpaidRemaining,15000n);
 await receipt('r2',15000n,false);
 assert.equal((await verifiedImportChargeFunding(db,shop,'po','5100')).approvedUnpaidRemaining,15000n);
 await receipt('r2',15000n);
 assert.equal((await verifiedImportChargeFunding(db,shop,'po','5100')).approvedUnpaidRemaining,0n);
 assert.equal((await verifiedImportChargeFunding(db,shop,'po','5100')).fundedRemaining,0n);
 await db.query("INSERT INTO ars_supplier_cheques VALUES('commitment','shop-a','bank','Issued',460)");
 await assert.rejects(()=>settleImportCreditor(pool,settle),/Insufficient recorded funds/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM ars_gl_import_settlements')).rows[0].n,0);
 await db.query("UPDATE ars_supplier_cheques SET status='Cancelled' WHERE id='commitment'");
 assert.equal((await settleImportCreditor(pool,settle)).replayed,false);
 assert.equal((await settleImportCreditor(pool,settle)).replayed,true);
 await assert.rejects(()=>settleImportCreditor(pool,{...settle,amount:'51.00'}),/identifier already used/);
 await assert.rejects(()=>settleImportCreditor(pool,{...settle,id:'over',amount:'150.01'}),/exceeds recognized/);
 await settleImportCreditor(pool,{...settle,id:'payment-2',amount:'150.00'});
 const totals=(await db.query("SELECT sum(amount)::text AS paid,count(*)::int AS n FROM ars_gl_import_settlements")).rows[0];
 assert.deepEqual(totals,{paid:'200.00',n:2});
 assert.equal((await db.query("SELECT sum(credit-debit)::text AS balance FROM ars_gl_lines WHERE account_code='2050'")).rows[0].balance,'0.00');
 assert.equal((await db.query("SELECT sum(amount)::text AS balance FROM ars_financial_movements")).rows[0].balance,'300.00');
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.query('SET search_path TO public');await db.query('DROP SCHEMA '+schema+' CASCADE');await db.end();}
});

import {recordSupplierRefund, supplierRefundAvailability, validateSupplierRefund} from '../backend/supplierRefunds.ts';

test('supplier refund limits use exact cents',()=>{
 validateSupplierRefund(15000n,20000n,20000n,0n);
 validateSupplierRefund(5000n,5000n,20000n,15000n);
 for(const args of [[0n,20000n,20000n,0n],[5001n,5000n,20000n,15000n],[10001n,20000n,20000n,10000n],[1n,0n,20000n,0n]])assert.throws(()=>validateSupplierRefund(...args),/exceeds available/);
});

import {supplierReconciliation} from '../backend/supplierReconciliation.ts';

test('supplier refund posting is atomic, scoped and replay safe',{timeout:60000},async()=>{
 const schema='refund_ci_'+randomUUID().replaceAll('-',''),shop='shop-a',day='2026-01-01';
 const admin=new pg.Client({connectionString:url.toString()});
 await admin.connect();
 let pool;
 try{
 await admin.query('CREATE SCHEMA '+schema);
 pool=new pg.Pool({connectionString:url.toString(),options:'-c search_path='+schema});
 await initGeneralLedger(pool);
 await pool.query(`
 CREATE TABLE purchase_orders(id text PRIMARY KEY,shop_id text NOT NULL,po_number text,supplier_name text,status text,total numeric(14,2));
 CREATE TABLE supplier_payments(id text PRIMARY KEY,shop_id text NOT NULL,purchase_order_id text,amount numeric(14,2));
 CREATE TABLE ars_receipt_batches(id text PRIMARY KEY,shop_id text NOT NULL,purchase_order_id text NOT NULL);
 CREATE TABLE ars_financial_accounts(id text,shop_id text,name text,kind text,active boolean,PRIMARY KEY(shop_id,id));
 CREATE TABLE ars_financial_movements(id text PRIMARY KEY,shop_id text,account_id text,amount numeric(14,2),movement_kind text,source_id text,recorded_by text,effective_date date,note text);
 INSERT INTO purchase_orders VALUES('po','shop-a','PO-CI','Supplier CI','Ordered',200.00);
 INSERT INTO ars_gl_accounts(shop_id,code,name,kind) VALUES('shop-a','1000','Bank','Asset'),('shop-a','1010','Cash','Asset'),('shop-a','1250','Advance','Asset'),('shop-a','1300','Inventory','Asset'),('shop-a','2000','Payable','Liability');
 INSERT INTO ars_gl_account_mappings(shop_id,mapping_kind,source_id,account_code,evidence,recorded_by) VALUES('shop-a','supplierAdvances','control','1250','CI','CI'),('shop-a','supplierPayables','control','2000','CI','CI'),('shop-a','financialAccount','bank','1000','CI','CI'),('shop-a','financialAccount','cash','1010','CI','CI');
 INSERT INTO ars_gl_cutover(shop_id,cutover_date,evidence,approved_by,posting_enabled) VALUES('shop-a','2026-01-01','CI','CI',true);
 INSERT INTO ars_financial_accounts VALUES('bank','shop-a','Main bank','Bank',true),('cash','shop-a','Office cash','Office Cash',true),('inactive','shop-a','Inactive','Bank',false),('foreign','shop-b','Other bank','Bank',true);
 INSERT INTO ars_gl_purchase_returns(shop_id,id,purchase_order_id,return_date,reason,evidence,recorded_by) VALUES('shop-a','ret','po','2026-01-01','CI','CI','CI');
 `);
 const c=await pool.connect();
 try{
 await c.query('BEGIN');
 await postJournal(c,{id:'purchase-return:ret',shopId:shop,postingDate:day,sourceKind:'PurchaseReturn',sourceId:'ret',description:'CI return',actor:'CI',lines:[{accountCode:'1250',debit:'200.00',credit:'0.00'},{accountCode:'1300',debit:'0.00',credit:'200.00'}]});
 await c.query('COMMIT');
 }finally{c.release();}
 const request={shopId:shop,id:'refund-1',returnId:'ret',accountId:'bank',amount:'150.00',date:day,evidence:'CI receipt',actor:'CI'};
 const before=await supplierRefundAvailability(pool,shop,'ret');
 assert.equal(before.available,'200.00');
 const reconciliationBefore=await supplierReconciliation(pool,shop,'po');
 assert.equal(reconciliationBefore.advance,'200.00');
 assert.equal(reconciliationBefore.payable,'0.00');
 assert.deepEqual(before.accounts.map(a=>a.id).sort(),['bank','cash']);
 for(const accountId of ['inactive','foreign','missing'])await assert.rejects(()=>recordSupplierRefund(pool,{...request,accountId}),/Active cash or bank/);
 await assert.rejects(()=>recordSupplierRefund(pool,{...request,shopId:'shop-b'}),/Active accounting|Posted purchase return/);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM ars_gl_supplier_refunds')).rows[0].n,0);
 assert.equal((await recordSupplierRefund(pool,request)).replayed,false);
 assert.equal((await recordSupplierRefund(pool,request)).replayed,true);
 await assert.rejects(()=>recordSupplierRefund(pool,{...request,amount:'149.00'}),/identifier already used/);
 assert.equal((await supplierRefundAvailability(pool,shop,'ret')).available,'50.00');
 const reconciliationPartial=await supplierReconciliation(pool,shop,'po');
 assert.equal(reconciliationPartial.advance,'50.00');
 assert.equal(reconciliationPartial.payable,'0.00');
 await assert.rejects(()=>recordSupplierRefund(pool,{...request,id:'over',amount:'50.01'}),/exceeds available/);
 const results=await Promise.allSettled(['refund-2','refund-3'].map(id=>recordSupplierRefund(pool,{...request,id,accountId:'cash',amount:'50.00'})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 assert.equal((await supplierRefundAvailability(pool,shop,'ret')).available,'0.00');
 const reconciliationAfter=await supplierReconciliation(pool,shop,'po');
 assert.equal(reconciliationAfter.advance,'0.00');
 assert.equal(reconciliationAfter.payable,'0.00');
 assert.equal(reconciliationAfter.operationallyReconciled,false);
 await assert.rejects(()=>supplierReconciliation(pool,'shop-b','po'),/Purchase order not found/);
 assert.deepEqual((await pool.query('SELECT count(*)::int AS n,sum(amount)::text AS total FROM ars_gl_supplier_refunds')).rows[0],{n:2,total:'200.00'});
 assert.deepEqual((await pool.query("SELECT count(*)::int AS n,sum(amount)::text AS total FROM ars_financial_movements WHERE movement_kind='Supplier Return Refund'")).rows[0],{n:2,total:'200.00'});
 assert.equal((await pool.query("SELECT sum(debit-credit)::text AS net FROM ars_gl_lines WHERE account_code='1250'")).rows[0].net,'0.00');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM (SELECT journal_id FROM ars_gl_lines GROUP BY journal_id HAVING sum(debit)<>sum(credit)) x")).rows[0].n,0);
 }finally{if(pool)await pool.end();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();}
});

test('import return allocation conserves cents across partial Box/Piece returns',async()=>{
 const {allocateImportReturnCost}=await import('../backend/importReturnCost.ts');
 const input={receipts:[{baseQuantity:12,landedCost:'130.01'}],goodsCostPerPurchaseUnit:'100.00',purchaseFactor:12};
 let goods=0n,charges=0n;
 for(const [previous,quantity] of [[0,4],[4,5],[9,3]]){
 const a=allocateImportReturnCost({...input,previousReturnedBaseQuantity:previous,returnBaseQuantity:quantity});
 goods+=a.goodsCost;charges+=a.allocatedCharges;
 }
 assert.equal(goods,10000n);assert.equal(charges,3001n);
 assert.throws(()=>allocateImportReturnCost({...input,previousReturnedBaseQuantity:9,returnBaseQuantity:4}),/exceeds/);
 assert.throws(()=>allocateImportReturnCost({...input,receipts:[],previousReturnedBaseQuantity:0,returnBaseQuantity:1}),/receipt history/);
 assert.throws(()=>allocateImportReturnCost({...input,receipts:[{baseQuantity:12,landedCost:'99.99'}],previousReturnedBaseQuantity:0,returnBaseQuantity:1}),/reconcile/);
});
test('import recovery limits prevent category and overall over-recovery',async()=>{
 const {recoveryLimit}=await import('../backend/importChargeRecoveries.ts');
 assert.equal(recoveryLimit(3000000n,2000000n,500000n,1000000n,200000n),800000n);
 assert.equal(recoveryLimit(3000000n,1000000n,900000n,2000000n,0n),100000n);
 assert.equal(recoveryLimit(3000000n,0n,0n,1000000n,0n),0n);
 assert.equal(recoveryLimit(3000000n,2000000n,2000000n,1000000n,0n),0n);
 assert.equal(recoveryLimit(3000000n,2000000n,1000000n,1000000n,1000000n),0n);
 assert.throws(()=>recoveryLimit(3000000n,2000000n,-1n,1000000n,0n),/reconciliation/);
});
test('import return posts carrying variance once, not historical freight twice',async()=>{
 const {buildImportPurchaseReturnJournal}=await import('../backend/purchaseReturnJournal.ts');
 const result=buildImportPurchaseReturnJournal({inventoryCost:'130000.00',supplierCredit:'100000.00',outstandingPayable:'80000.00',inventoryAccount:'1200',payableAccount:'2100',advanceAccount:'1250',varianceAccount:'5100',importVarianceAccount:'5100',historicalGoodsCost:'100000.00',historicalImportCharges:'30000.00'});
 assert.equal(result.historicalLandedCost,13000000n);
 assert.equal(result.carryingVariance,3000000n);
 assert.deepEqual(result.lines.find(l=>l.accountCode==='5100'),{accountCode:'5100',debit:'30000.00',credit:'0.00'});
 assert.equal(result.lines.find(l=>l.accountCode==='1250').debit,'20000.00');
 assert.equal(validateJournal(result.lines).totalCents,'13000000');
});

import {payrollAccountingOverview} from '../backend/payrollAccountingOverview.ts';
import {reconcilePayroll} from '../backend/payrollReconciliation.ts';
import {reconcileSalaryPayable} from '../backend/salaryPayableReconciliation.ts';
import {reconcileEmployeeAdvances} from '../backend/employeeAdvanceReconciliation.ts';
import {reconcileStatutoryControls} from '../backend/statutoryControlReconciliation.ts';
test('real PostgreSQL payroll controls: isolated schema, partial payment and tenant isolation',{timeout:60000},async()=>{
 const schema='payroll_ci_'+randomUUID().replaceAll('-',''),shop='shop-a',other='shop-b',day='2026-11-01';
 const admin=new pg.Client({connectionString:url.toString()});
 await admin.connect();let pool;
 try{
 await admin.query('CREATE SCHEMA '+schema);
 pool=new pg.Pool({connectionString:url.toString(),options:'-c search_path='+schema});
 await initGeneralLedger(pool);
 await pool.query(`
 CREATE TABLE ars_financial_accounts(id text,shop_id text,kind text,active boolean,PRIMARY KEY(shop_id,id));
 CREATE TABLE ars_financial_movements(id text PRIMARY KEY,shop_id text,account_id text,amount numeric(14,2),movement_kind text,source_id text,recorded_by text,effective_date date,note text);
 `);
 for(const id of [shop,other]){
 await pool.query("INSERT INTO ars_gl_accounts(shop_id,code,name,kind) VALUES($1,'1000','Bank','Asset'),($1,'1200','Employee advances','Asset'),($1,'2100','Salary payable','Liability'),($1,'2110','EPF','Liability'),($1,'2120','ETF','Liability'),($1,'5000','Salary','Expense')",[id]);
 await pool.query("INSERT INTO ars_gl_account_mappings(shop_id,mapping_kind,source_id,account_code,evidence,recorded_by) VALUES($1,'financialAccount','bank','1000','CI','CI'),($1,'employeeAdvances','control','1200','CI','CI'),($1,'salaryPayable','control','2100','CI','CI'),($1,'epfPayable','control','2110','CI','CI'),($1,'etfPayable','control','2120','CI','CI'),($1,'salary','control','5000','CI','CI')",[id]);
 await pool.query("INSERT INTO ars_gl_cutover(shop_id,cutover_date,evidence,approved_by,posting_enabled) VALUES($1,$2,'CI','CI',true)",[id,day]);
 await pool.query("INSERT INTO ars_financial_accounts VALUES('bank',$1,'Bank',true)",[id]);
 }
 const empty=await payrollAccountingOverview(pool,shop);
 assert.equal(empty.checksPassed,true);assert.equal(empty.controls.length,4);assert.equal(empty.postingEnabled,false);
 const journal=(c,id,sourceKind,sourceId,lines)=>postJournal(c,{id,shopId:shop,postingDate:day,sourceKind,sourceId,description:'Synthetic payroll CI',actor:'CI',lines});
 const tx=async(fn)=>{const c=await pool.connect();try{await c.query('BEGIN');await fn(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 await tx(async c=>{
 await journal(c,'payroll-accrual:p1','PayrollAccrual','p1',[{accountCode:'5000',debit:'50000.01',credit:'0.00'},{accountCode:'2100',debit:'0.00',credit:'50000.01'}]);
 await c.query("INSERT INTO ars_gl_payroll_accruals(shop_id,id,employee_id,employee_name,period_key,base_salary,gross_amount,posting_date,evidence,journal_id,recorded_by) VALUES($1,'p1','e1','Synthetic employee','2026-11',50000.01,50000.01,$2,'CI','payroll-accrual:p1','CI')",[shop,day]);
 });
 const pay=async(id,value)=>tx(async c=>{
 const j='salary-payment:'+id;
 await journal(c,j,'SalaryPayment',id,[{accountCode:'2100',debit:value,credit:'0.00'},{accountCode:'1000',debit:'0.00',credit:value}]);
 await c.query("INSERT INTO ars_financial_movements VALUES($1,$2,'bank',-$3::numeric,'Salary Payment',$4,'CI',$5,'CI')",[j,shop,value,id,day]);
 await c.query("INSERT INTO ars_gl_salary_payments(shop_id,id,accrual_id,financial_account_id,amount,posting_date,journal_id,evidence,recorded_by) VALUES($1,$2,'p1','bank',$3,$4,$5,'CI','CI')",[shop,id,value,day,j]);
 });
 await pay('pay1','20000.02');
 const salary=await reconcileSalaryPayable(pool,shop);
 assert.equal(salary.checksPassed,true);assert.equal(salary.verifiedOutstanding,'29999.99');
 assert.equal((await reconcileSalaryPayable(pool,other)).verifiedOutstanding,'0.00');
 const monthly=await reconcilePayroll(pool,shop,'2026-11');assert.equal(monthly.checksPassed,true);
 const advance=await reconcileEmployeeAdvances(pool,shop);assert.equal(advance.checksPassed,true);
 // Real approved employee advance and direct recovery, with same-transaction journal guards.
 await pool.query("INSERT INTO ars_gl_employee_advance_requests(shop_id,id,employee_id,employee_name,amount,requested_date,evidence,submitted_by) VALUES($1,'req1','e1','Synthetic employee',12500.03,$2,'CI','submitter')",[shop,day]);
 await pool.query("INSERT INTO ars_gl_employee_advance_reviews(shop_id,request_id,decision,evidence,reviewed_by) VALUES($1,'req1','Approved','CI','reviewer')",[shop]);
 await tx(async c=>{
 await journal(c,'advance:d1','EmployeeAdvanceDisbursement','d1',[{accountCode:'1200',debit:'12500.03',credit:'0.00'},{accountCode:'1000',debit:'0.00',credit:'12500.03'}]);
 await c.query("INSERT INTO ars_financial_movements VALUES('advance:d1',$1,'bank',-12500.03,'Employee Advance','d1','CI',$2,'CI')",[shop,day]);
 await c.query("INSERT INTO ars_gl_employee_advance_disbursements(shop_id,id,request_id,employee_id,financial_account_id,amount,posting_date,journal_id,evidence,recorded_by) VALUES($1,'d1','req1','e1','bank',12500.03,$2,'advance:d1','CI','CI')",[shop,day]);
 });
 const issued=await reconcileEmployeeAdvances(pool,shop);
 assert.equal(issued.checksPassed,true);assert.equal(issued.advances[0].outstanding,'12500.03');
 const repay=(id,value)=>tx(async c=>{
 const j='advance-repayment:'+id;
 await journal(c,j,'EmployeeAdvanceRepayment',id,[{accountCode:'1000',debit:value,credit:'0.00'},{accountCode:'1200',debit:'0.00',credit:value}]);
 await c.query("INSERT INTO ars_financial_movements VALUES($1,$2,'bank',$3::numeric,'Employee Advance',$1,'CI',$4,'CI')",[j,shop,value,day]);
 await c.query("INSERT INTO ars_gl_employee_advance_recoveries(shop_id,id,disbursement_id,employee_id,recovery_kind,financial_account_id,amount,posting_date,journal_id,evidence,recorded_by) VALUES($1,$2,'d1','e1','DirectRepayment','bank',$3,$4,$5,'CI','CI')",[shop,id,value,day,j]);
 });
 await repay('r1','2500.01');
 const partial=await reconcileEmployeeAdvances(pool,shop);
 assert.equal(partial.checksPassed,true);assert.equal(partial.advances[0].outstanding,'10000.02');assert.equal(partial.ledgerBalance,'10000.02');
 assert.equal((await payrollAccountingOverview(pool,shop)).controls.find(c=>c.id==='advances').recordedBalance,'10000.02');
 assert.equal((await reconcileEmployeeAdvances(pool,other)).advances.length,0);
 await assert.rejects(()=>repay('over','10000.03'),/exceeds outstanding amount/);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM ars_gl_journals WHERE id='advance-repayment:over'")).rows[0].n,0);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM ars_financial_movements WHERE id='advance-repayment:over'")).rows[0].n,0);
 // A second payroll period recovers part of the advance through net pay.
 const {calculateStatutoryPayroll}=await import('../backend/payrollCalculation.ts');
 const {planDetailedPayrollJournal}=await import('../backend/payrollJournalPlan.ts');
 const {createHash}=await import('node:crypto');
 const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 const payrollDay='2026-12-01',period='2026-12',proposal='p2';
 const rules={version:1,employeeEligibility:'StandardCoveredEmployee',exceptions:'None',epf:{included:['Base'],subtractUnpaidLeave:false},etf:{included:['Base'],subtractUnpaidLeave:false}};
 const policy={id:'policy-ci',employee_epf_bp:800,employer_epf_bp:1200,employer_etf_bp:300,eligibility_rules:rules,authority_reference:'Synthetic CI policy'};
 const sourceInputs={baseSalary:'50000.00',earnings:[],deductions:[{id:'advance:d1',kind:'AdvanceRecovery',amount:'4000.02',evidence:'CI recovery'}],contributions:[],policyReference:'CI'};
 const {inputs,results}=calculateStatutoryPayroll(sourceInputs,policy);
 const detailHash=createHash('sha256').update(canonical({version:1,inputs,results})).digest('hex');
 const eligibilityEvidence='Synthetic eligibility';
 const bindingHash=createHash('sha256').update(canonical({version:1,shopId:shop,proposalId:proposal,employeeId:'e1',period,policyId:policy.id,eligibilityId:'elig-ci',eligibilityEvidence,sourceInputs,expectedResults:results,detailHash})).digest('hex');
 await pool.query("INSERT INTO ars_gl_accounts(shop_id,code,name,kind) VALUES($1,'5100','Employer contributions','Expense')",[shop]);
 await pool.query("INSERT INTO ars_gl_account_mappings(shop_id,mapping_kind,source_id,account_code,evidence,recorded_by) VALUES($1,'employerContributions','control','5100','CI','CI')",[shop]);
 await pool.query("INSERT INTO ars_gl_payroll_policies(shop_id,id,effective_month,employee_epf_bp,employer_epf_bp,employer_etf_bp,eligibility_rules,authority_reference,evidence,submitted_by) VALUES($1,$2,$3,800,1200,300,$4,'Synthetic CI policy','CI','submitter')",[shop,policy.id,period,JSON.stringify(rules)]);
 await pool.query("INSERT INTO ars_gl_payroll_policy_reviews(shop_id,policy_id,decision,evidence,reviewed_by) VALUES($1,$2,'Approved','CI','reviewer')",[shop,policy.id]);
 await pool.query("INSERT INTO ars_gl_payroll_eligibility(shop_id,id,employee_id,employee_name,effective_month,classification,authority_reference,evidence,submitted_by) VALUES($1,'elig-ci','e1','Synthetic employee',$2,'StandardCoveredEmployee','CI',$3,'submitter')",[shop,period,eligibilityEvidence]);
 await pool.query("INSERT INTO ars_gl_payroll_eligibility_reviews(shop_id,eligibility_id,decision,evidence,reviewed_by) VALUES($1,'elig-ci','Approved','CI','reviewer')",[shop]);
 await pool.query("INSERT INTO ars_gl_payroll_proposals(shop_id,id,employee_id,employee_name,period_key,base_salary,posting_date,evidence,submitted_by) VALUES($1,$2,'e1','Synthetic employee',$3,50000,$4,'CI','submitter')",[shop,proposal,period,payrollDay]);
 await pool.query("INSERT INTO ars_gl_payroll_reviews(shop_id,proposal_id,decision,evidence,reviewed_by) VALUES($1,$2,'Approved','CI','reviewer')",[shop,proposal]);
 await pool.query("INSERT INTO ars_gl_payroll_details(shop_id,proposal_id,calculation_version,inputs,results,snapshot_hash,gross_salary,total_deductions,net_salary,employer_contributions,employer_cost,recorded_by) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,'CI')",[shop,proposal,JSON.stringify(inputs),JSON.stringify(results),detailHash,results.grossSalary,results.totalDeductions,results.netSalary,results.employerContributions,results.employerCost]);
 await pool.query("INSERT INTO ars_gl_payroll_statutory_snapshots(shop_id,proposal_id,policy_id,eligibility_id,snapshot_version,source_inputs,eligibility_evidence,binding_hash,recorded_by) VALUES($1,$2,$3,'elig-ci',1,$4,$5,$6,'CI')",[shop,proposal,policy.id,JSON.stringify(sourceInputs),eligibilityEvidence,bindingHash]);
 const plan=planDetailedPayrollJournal(inputs),codes={salary:'5000',employerContributions:'5100',salaryPayable:'2100',employeeAdvances:'1200',epfPayable:'2110',etfPayable:'2120'};
 await tx(async c=>{
 await postJournal(c,{id:'payroll-accrual:p2',shopId:shop,postingDate:payrollDay,sourceKind:'PayrollAccrual',sourceId:proposal,description:'Detailed CI payroll',actor:'CI',lines:plan.lines.map(({control,...l})=>({...l,accountCode:codes[control]}))});
 await c.query("INSERT INTO ars_gl_payroll_accruals(shop_id,id,employee_id,employee_name,period_key,base_salary,gross_amount,posting_date,evidence,journal_id,recorded_by) VALUES($1,$2,'e1','Synthetic employee',$3,50000,50000,$4,'CI','payroll-accrual:p2','CI')",[shop,proposal,period,payrollDay]);
 await c.query("INSERT INTO ars_gl_employee_advance_recoveries(shop_id,id,disbursement_id,employee_id,recovery_kind,payroll_proposal_id,amount,posting_date,journal_id,evidence,recorded_by) VALUES($1,'payroll-recovery','d1','e1','PayrollRecovery',$2,4000.02,$3,'payroll-accrual:p2','CI','CI')",[shop,proposal,payrollDay]);
 });
 const payrollRecovery=await reconcileEmployeeAdvances(pool,shop);
 assert.equal(payrollRecovery.checksPassed,true);assert.equal(payrollRecovery.advances[0].outstanding,'6000.00');
 assert.equal(results.netSalary,'41999.98');
 const detail=await reconcileSalaryPayable(pool,shop);assert.equal(detail.checksPassed,true);assert.equal(detail.rows.find(r=>r.id===proposal).amounts.netSalary,'41999.98');
 const statutoryDetail=await reconcileStatutoryControls(pool,shop);
 assert.equal(statutoryDetail.controls.find(c=>c.fund==='EPF').subledgerBalance,'10000.00');
 assert.equal(statutoryDetail.controls.find(c=>c.fund==='ETF').subledgerBalance,'1500.00');
 // Direct settlement after payroll recovery must not predate the recorded recovery.
 await tx(async c=>{
 const j='advance-repayment:r2';
 await postJournal(c,{id:j,shopId:shop,postingDate:payrollDay,sourceKind:'EmployeeAdvanceRepayment',sourceId:'r2',description:'CI final repayment',actor:'CI',lines:[{accountCode:'1000',debit:'6000.00',credit:'0.00'},{accountCode:'1200',debit:'0.00',credit:'6000.00'}]});
 await c.query("INSERT INTO ars_financial_movements VALUES($1,$2,'bank',6000,'Employee Advance',$1,'CI',$3,'CI')",[j,shop,payrollDay]);
 await c.query("INSERT INTO ars_gl_employee_advance_recoveries(shop_id,id,disbursement_id,employee_id,recovery_kind,financial_account_id,amount,posting_date,journal_id,evidence,recorded_by) VALUES($1,'r2','d1','e1','DirectRepayment','bank',6000,$2,$3,'CI','CI')",[shop,payrollDay,j]);
 });

 const recovered=await reconcileEmployeeAdvances(pool,shop);
 assert.equal(recovered.checksPassed,true);assert.equal(recovered.advances[0].outstanding,'0.00');assert.equal(recovered.ledgerBalance,'0.00');

 const stat=await reconcileStatutoryControls(pool,shop);assert.equal(stat.checksPassed,false);assert.ok(stat.exceptions.some(e=>e.issues.includes('STATUTORY_COVERAGE_UNVERIFIED')));
 const combined=await payrollAccountingOverview(pool,shop);assert.equal(combined.checksPassed,false);assert.equal(combined.controls.find(c=>c.id==='salary').checksPassed,true);
 await assert.rejects(()=>pay('over','30000.00'),/exceeds outstanding net salary/);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM ars_gl_journals WHERE shop_id=$1 AND id='salary-payment:over'",[shop])).rows[0].n,0);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM ars_financial_movements WHERE id='salary-payment:over'")).rows[0].n,0);
 await pay('pay2','29999.99');assert.equal((await reconcileSalaryPayable(pool,shop)).verifiedOutstanding,'41999.98');
 assert.equal((await payrollAccountingOverview(pool,other)).checksPassed,true);
 }finally{if(pool)await pool.end();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await admin.end();}
});
