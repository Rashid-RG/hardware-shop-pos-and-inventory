import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/hardware_pos_ci')
  throw new Error('ARS operational tests only run against isolated hardware_pos_ci PostgreSQL.');
const {pool,initDbTables,checkoutTransaction}=await import('../backend/db.ts');

test('ARS quotation-to-invoice: registered customer, rep snapshot, shop isolation, expiry, concurrent conversion, and rollback', {timeout:60000},async()=>{
  const id=randomUUID().slice(0,12);
  const shopId='ci-operational-shop-'+id;
  const otherShop='ci-operational-other-'+id;
  const productId='ci-operational-product-'+id;
  const customerId='ci-operational-customer-'+id;
  const repId='ci-operational-rep-'+id;
  const sourceQuote='ci-operational-quote-'+id;
  const expiredQuote='ci-expired-quote-'+id;
  const shortageQuote='ci-short-quote-'+id;
  const tomorrow=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const yesterday='2020-01-01';
  const item=(quantity)=>({productId,productName:'ARS test hardware item',
    invoiceDescription:'4m length · 50mm heavy-duty pipe (invoice-specific)',
    quantity,sellingPrice:100,costPrice:50,discount:0,discountAmount:0});
  const sale=(txId,quantity=2,shop=shopId)=>({
    id:txId,shopId:shop,invoiceNumber:'CI-ARS-'+txId,date:new Date().toISOString(),
    customerId,customerName:'Operational Test Hardware Shop',
    cashierName:'Test Operator (internal only)',salesRepId:repId,salesRepName:'Test Sales Representative',
    items:[item(quantity)],subtotal:100*quantity,tax:0,discountAmount:0,total:100*quantity,
    paymentMethod:'Cash',paymentStatus:'PAID',cashReceived:100*quantity,changeDue:0,
    status:'Completed'
  });
  const insertQuote=async(quoteId,quantity,validUntil=tomorrow)=>pool.query(
    `INSERT INTO quotations
      (id,shop_id,quote_number,date,valid_until,customer_id,customer_name,items,
       subtotal,tax,discount_amount,total,status,created_by)
      VALUES($1,$2,$3,NOW(),$4,$5,$6,$7::jsonb,$8,0,0,$8,'Accepted','CI Operator')`,
    [quoteId,shopId,'CI-Q-'+quoteId,validUntil,customerId,'Operational Test Hardware Shop',
      JSON.stringify([{productId,productName:'ARS test hardware item',quantity,sellingPrice:100,
        discount:0,discountAmount:0}]),quantity*100]
  );
  try{
    await initDbTables();
    await pool.query(
      `INSERT INTO products(id,shop_id,name,sku,brand,category,cost_price,selling_price,
        quantity,reorder_level,warranty,description)
       VALUES($1,$2,'ARS test hardware item',$3,'ARS','Hardware',50,100,10,2,'None','CI isolated test')`,
      [productId,shopId,'CI-ARS-'+id]
    );
    await pool.query(
      `INSERT INTO customers(id,shop_id,name,phone,address,loyalty_balance,purchase_count,credit_limit,credit_balance)
       VALUES($1,$2,'Operational Test Hardware Shop','0770000000','CI only',0,0,10000,0)`,
      [customerId,shopId]
    );
    await insertQuote(sourceQuote,2);
    await insertQuote(expiredQuote,1,yesterday);
    await insertQuote(shortageQuote,99);

    await assert.rejects(
      checkoutTransaction(sale('ci-wrong-shop-'+id,2,otherShop),'Cashier','Wrong ARS shop',sourceQuote),
      /Quotation not found in this branch/
    );
    await assert.rejects(
      checkoutTransaction(sale('ci-mismatch-'+id,1),'Cashier','ARS CI shop',sourceQuote),
      /Quotation was modified/
    );
    await assert.rejects(
      checkoutTransaction(sale('ci-expired-tx-'+id,1),'Cashier','ARS CI shop',expiredQuote),
      /Quotation validity has expired/
    );
    await assert.rejects(
      checkoutTransaction(sale('ci-short-tx-'+id,99),'Cashier','ARS CI shop',shortageQuote),
      /Insufficient stock/
    );
    const stillTen=await pool.query('SELECT quantity FROM products WHERE id=$1',[productId]);
    assert.equal(Number(stillTen.rows[0].quantity),10,'Rejected invoice conversion must not touch stock');

    const firstId='ci-good-a-'+id;
    const secondId='ci-good-b-'+id;
    const results=await Promise.allSettled([
      checkoutTransaction(sale(firstId),'Cashier','ARS CI shop',sourceQuote),
      checkoutTransaction(sale(secondId),'Cashier','ARS CI shop',sourceQuote),
    ]);
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1,'Quote must convert only once');
    assert.equal(results.filter(row=>row.status==='rejected').length,1,'Concurrent duplicate must reject');

    const quote=await pool.query('SELECT status,converted_to_tx_id FROM quotations WHERE id=$1',[sourceQuote]);
    assert.equal(quote.rows[0].status,'Converted');
    assert.ok([firstId,secondId].includes(quote.rows[0].converted_to_tx_id));
    const saved=await pool.query(
      `SELECT id,customer_id,shop_id,cashier_name,sales_rep_id,sales_rep_name,
        payment_method,total FROM sales_transactions WHERE id IN ($1,$2)`,[firstId,secondId]);
    assert.equal(saved.rowCount,1);
    assert.equal(saved.rows[0].shop_id,shopId);
    assert.equal(saved.rows[0].customer_id,customerId);
    assert.equal(saved.rows[0].sales_rep_id,repId);
    assert.equal(saved.rows[0].sales_rep_name,'Test Sales Representative');
    assert.equal(saved.rows[0].cashier_name,'Test Operator (internal only)');
    assert.equal(saved.rows[0].payment_method,'Cash');
    assert.equal(Number(saved.rows[0].total),200);
    const sold=await pool.query('SELECT quantity FROM products WHERE id=$1',[productId]);
    assert.equal(Number(sold.rows[0].quantity),8,'Only one authorized checkout may deduct inventory');
    const items=await pool.query(
      'SELECT COUNT(*)::integer AS count FROM sales_transaction_items WHERE transaction_id=$1',
      [saved.rows[0].id]);
    assert.equal(items.rows[0].count,1);
    const printedDescription=await pool.query(
      'SELECT invoice_description FROM sales_transaction_items WHERE transaction_id=$1',
      [saved.rows[0].id]);
    assert.equal(printedDescription.rows[0].invoice_description,
      '4m length · 50mm heavy-duty pipe (invoice-specific)',
      'Reprint must use saved invoice description and not the current product master.');
    const logs=await pool.query(
      `SELECT action FROM activity_logs WHERE shop_id=$1 AND user_name='Test Operator (internal only)' AND action='Invoice Created'`,[shopId]);
    assert.equal(logs.rowCount,1,'Successful conversion has exactly one operator-audit entry');
    const failed=await pool.query(
      'SELECT COUNT(*)::integer AS count FROM sales_transactions WHERE id LIKE $1',
      ['ci-%-'+id]);
    assert.equal(failed.rows[0].count,1,'Failed and duplicate invoices must leave no partial transaction');
    const unconverted=await pool.query(
      'SELECT status,converted_to_tx_id FROM quotations WHERE id IN ($1,$2) ORDER BY id',
      [expiredQuote,shortageQuote]);
    assert.equal(unconverted.rowCount,2);
    assert.ok(unconverted.rows.every(q=>q.status==='Accepted'&&!q.converted_to_tx_id));
  } finally {
    await pool.end();
  }
});
