import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const url=new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/hardware_pos_ci')throw Error('Refusing shared-stock test outside local hardware_pos_ci');
const {pool,initDbTables,createPurchaseOrder,receivePurchaseOrder}=await import('../backend/db.ts');
const {initPackagingDrafts,savePackagingDraft,activatePackaging,checkPackagingActivation}=await import('../backend/packagingDrafts.ts');
const {initSharedStockSchema,deductSharedSale,restoreSharedSale}=await import('../backend/sharedStock.ts');
test('shared packaging activation, purchase, mixed sale and rollback against PostgreSQL',async()=>{
 const suffix=randomUUID(),shop='ci-shared-'+suffix,product='prod-'+suffix,supplier='supplier-'+suffix,po='po-'+suffix;
 const config={baseUnit:'Piece',units:[{id:'piece',label:'Piece',baseUnits:1,sellingPrice:500},{id:'box',label:'Box',baseUnits:12,sellingPrice:5400}]};
 const stock=async()=>Number((await pool.query('SELECT quantity FROM products WHERE id=$1',[product])).rows[0].quantity);
 const previous=process.env.ARS_SHARED_STOCK_PILOT;
 try{
  await initDbTables();await initSharedStockSchema(pool);await initPackagingDrafts(pool);
  await pool.query("INSERT INTO suppliers(id,shop_id,name,company_name,phone) VALUES($1,$2,'CI','CI','0700000000')",[supplier,shop]);
  await pool.query("INSERT INTO products(id,shop_id,name,sku,brand,category,cost_price,selling_price,quantity,reorder_level,warranty,description,variants_json) VALUES($1,$2,'Door lock',$1,'CI','Parts',300,500,0,1,'None','Test','[]'::jsonb)",[product,shop]);
  await savePackagingDraft(pool,shop,product,'CI Manager',config);
  assert.equal((await checkPackagingActivation(pool,shop,product)).eligible,true);
  delete process.env.ARS_SHARED_STOCK_PILOT;
  await assert.rejects(()=>activatePackaging(pool,shop,product,'CI Manager','Store Manager',true),/disabled/);
  process.env.ARS_SHARED_STOCK_PILOT='true';
  await assert.rejects(()=>activatePackaging(pool,shop,product,'CI Cashier','Cashier',true),/confirmation/);
  await activatePackaging(pool,shop,product,'CI Manager','Store Manager',true);
  assert.equal(await stock(),0);
  await createPurchaseOrder({id:po,shopId:shop,poNumber:po,date:new Date().toISOString(),supplierId:supplier,supplierName:'CI',items:[{productId:product,productName:'Door lock',sellingUnitId:'box',quantity:10,costPrice:3600}],total:36000,status:'Pending'});
  await receivePurchaseOrder(po,shop,'CI Manager');
  assert.equal(await stock(),120);
  await assert.rejects(()=>receivePurchaseOrder(po,shop,'CI Manager'),/already received/);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const box=await deductSharedSale(client,shop,product,'box',2);
   const piece=await deductSharedSale(client,shop,product,'piece',4);
   assert.equal(box.baseQuantity,24);assert.equal(box.costPrice,3600);assert.equal(box.sellingPrice,5400);assert.equal(piece.baseQuantity,4);
   await client.query('COMMIT');
   assert.equal(await stock(),92);
   await client.query('BEGIN');
   assert.equal(await restoreSharedSale(client,shop,product,1,box.baseUnitsPerSaleUnit),12);
   await client.query('COMMIT');
   assert.equal(await stock(),104);
   await client.query('BEGIN');
   await deductSharedSale(client,shop,product,'box',8);
   await assert.rejects(()=>deductSharedSale(client,shop,product,'piece',9),/Insufficient/);
   await client.query('ROLLBACK');
   assert.equal(await stock(),104);
   await client.query('BEGIN');
   await assert.rejects(()=>deductSharedSale(client,'other-shop',product,'piece',1),/unavailable/);
   await client.query('ROLLBACK');
  }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
 }finally{if(previous===undefined)delete process.env.ARS_SHARED_STOCK_PILOT;else process.env.ARS_SHARED_STOCK_PILOT=previous;await pool.end();}
});
