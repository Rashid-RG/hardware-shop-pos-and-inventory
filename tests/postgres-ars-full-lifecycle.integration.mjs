import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Never run this integration acceptance test against a customer database.
const connection = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['127.0.0.1', 'localhost'].includes(connection.hostname) || connection.pathname !== '/hardware_pos_ci') {
  throw new Error('ARS end-to-end acceptance only runs against isolated hardware_pos_ci PostgreSQL.');
}
const { pool, initDbTables, createPurchaseOrder, checkoutTransaction, addCustomerCreditPayment, refundTransaction } =
  await import('../backend/db.ts');
const { initPartialReceivingTables, receivePartialOrder } = await import('../backend/partialReceiving.ts');

test('ARS wholesale lifecycle: supplier PO, partial goods receipt, billing, repayment, audit and isolation', { timeout: 60000 }, async () => {
  const suffix = randomUUID();
  const shopId = 'ci-flow-shop-' + suffix;
  const wrongShop = 'ci-flow-other-' + suffix;
  const supplierId = 'ci-flow-supplier-' + suffix;
  const productId = 'ci-flow-product-' + suffix;
  const customerId = 'ci-flow-customer-' + suffix;
  const poId = 'ci-flow-po-' + suffix;
  const txId = 'ci-flow-sale-' + suffix;
  const date = new Date().toISOString();
  const readStock = async () => Number((await pool.query('SELECT quantity FROM products WHERE id=$1 AND shop_id=$2', [productId, shopId])).rows[0].quantity);
  const readDebt = async () => Number((await pool.query('SELECT credit_balance FROM customers WHERE id=$1 AND shop_id=$2', [customerId, shopId])).rows[0].credit_balance);
  try {
    await initDbTables();
    await initPartialReceivingTables(pool);
    await pool.query(
      `INSERT INTO products (id,shop_id,name,sku,brand,category,cost_price,selling_price,quantity,reorder_level,warranty,description)
       VALUES ($1,$2,'ARS Trade Pipe',$3,'ARS','Pipes',120,200,0,2,'None','CI wholesale item')`,
      [productId, shopId, 'CI-FLOW-' + suffix]
    );
    await pool.query(
      `INSERT INTO suppliers (id,shop_id,name,company_name,phone)
       VALUES ($1,$2,'CI China Supplier','CI Import Supplier','0700000000')`,
      [supplierId, shopId]
    );
    await pool.query(
      `INSERT INTO customers(id,shop_id,name,phone,address,loyalty_balance,purchase_count,credit_limit,credit_balance)
       VALUES($1,$2,'CI Registered Trade Shop','0770000000','CI Street',0,0,2000,0)`,
      [customerId, shopId]
    );
    const po = {
      id: poId, shopId, poNumber: 'CI-FLOW-PO-' + suffix, date,
      supplierId, supplierName: 'CI China Supplier', status: 'Pending',
      items: [{ productId, productName: 'ARS Trade Pipe', quantity: 8, costPrice: 120 }],
      total: 960,
    };
    await createPurchaseOrder(po);
    assert.equal(await readStock(), 0, 'Creating a PO must never add available stock');
    const itemResult = await pool.query('SELECT id FROM purchase_order_items WHERE purchase_order_id=$1', [poId]);
    assert.equal(itemResult.rowCount, 1);
    const lineId = Number(itemResult.rows[0].id);
    const receipt = (key, quantity, shop = shopId) => receivePartialOrder(pool, {
      shopId: shop, poId, requestKey: key, user: 'CI Warehouse Staff',
      items: [{ purchaseOrderItemId: lineId, quantity }],
      note: 'Physically counted test delivery',
    });

    await assert.rejects(() => receipt('wrong-shop-' + suffix, 3, wrongShop), /Purchase order not found in this shop/);
    assert.equal(await readStock(), 0);
    const first = await receipt('first-' + suffix, 5);
    assert.equal(first.status, 'Partially Received');
    assert.equal(first.repeated, false);
    assert.equal(await readStock(), 5, 'First receipt must only add the five physically received units');
    const repeated = await receipt('first-' + suffix, 5);
    assert.equal(repeated.repeated, true, 'Retried request must be idempotent');
    assert.equal(await readStock(), 5, 'Retry must never double-post inventory');
    await assert.rejects(() => receipt('excess-' + suffix, 4), /exceeds ordered quantity/);
    assert.equal(await readStock(), 5, 'Rejected excess must roll back inventory');
    const last = await receipt('second-' + suffix, 3);
    assert.equal(last.status, 'Received');
    assert.equal(await readStock(), 8);
    await assert.rejects(() => receipt('third-' + suffix, 1), /Order is not open for receiving/);

    const sale = {
      id: txId, shopId, invoiceNumber: 'CI-FLOW-INV-' + suffix, date: new Date().toISOString(),
      customerId, customerName: 'CI Registered Trade Shop', customerPhone: '0770000000',
      cashierName: 'CI Cashier', salesRepName: 'CI Representative',
      items: [{ productId, productName: 'ARS Trade Pipe',
        invoiceDescription: 'One 4m heavy duty pipe · invoice snapshot', quantity: 3,
        sellingPrice: 200, costPrice: 120, discount: 0, discountAmount: 0 }],
      subtotal: 600, tax: 0, discountAmount: 0, total: 600,
      paymentMethod: 'Credit Account', paymentStatus: 'CREDIT SALE',
      status: 'Completed',
    };
    await checkoutTransaction(sale, 'Cashier', 'ARS CI Test');
    assert.equal(await readStock(), 5, 'Credit invoice must deduct exactly three units');
    assert.equal(await readDebt(), 600, 'Only credit invoice must increase customer debt');
    const invoiceItem = await pool.query(
      'SELECT invoice_description,quantity FROM sales_transaction_items WHERE transaction_id=$1', [txId]
    );
    assert.equal(invoiceItem.rows[0].invoice_description, sale.items[0].invoiceDescription);
    assert.equal(Number(invoiceItem.rows[0].quantity), 3);

    const paymentId = 'ci-flow-payment-' + suffix;
    const payment = {
      id: paymentId, shopId, customerId, customerName: sale.customerName,
      amount: 250, date: date.slice(0, 10), paymentMethod: 'Bank Transfer',
      note: 'CI customer settlement', createdBy: 'CI Manager',
    };
    await assert.rejects(() => addCustomerCreditPayment({ ...payment, id: 'ci-flow-wrong-' + suffix, shopId: wrongShop }), /Customer not found in this shop/);
    await addCustomerCreditPayment(payment);
    assert.equal(await readDebt(), 350, 'Repayment must reduce credit by exactly the paid amount');
    assert.equal(await readStock(), 5, 'Repayment must never alter inventory');
    await assert.rejects(() => addCustomerCreditPayment({ ...payment, id: 'ci-flow-overpay-' + suffix, amount: 351 }), /exceeds the customer outstanding credit balance/);
    assert.equal(await readDebt(), 350);
    // Historical account payments remain preserved and cannot be guessed onto invoices.
    await assert.rejects(()=>addCustomerCreditPayment({...payment,id:'ci-flow-legacy-linked-'+suffix,invoiceId:txId,amount:50}),/Historical unallocated payments/);
    const historical=await pool.query('SELECT invoice_id,receipt_snapshot FROM customer_credit_payments WHERE id=$1',[paymentId]);
    assert.equal(historical.rows[0].invoice_id,null);
    assert.equal(historical.rows[0].receipt_snapshot.balanceAfter,350);

    // Separate new customer: exact invoice allocations with no historical ambiguity.
    const linkedCustomer='ci-linked-customer-'+suffix;
    const linkedInvoice='ci-linked-invoice-'+suffix;
    await pool.query("INSERT INTO customers(id,shop_id,name,loyalty_balance,purchase_count,credit_limit,credit_balance) VALUES($1,$2,'CI Linked Customer',0,0,2000,0)",[linkedCustomer,shopId]);
    const linkedSale={...sale,id:linkedInvoice,invoiceNumber:'CI-LINKED-'+suffix,customerId:linkedCustomer,customerName:'CI Linked Customer',items:[{...sale.items[0],quantity:2}],subtotal:400,total:400};
    await checkoutTransaction(linkedSale,'Cashier','ARS CI Test');
    const linkedStock=await readStock();
    const linkedPayment=(key,amount,overrides={})=>({...payment,id:'ci-linked-'+key+'-'+suffix,customerId:linkedCustomer,customerName:'CI Linked Customer',invoiceId:linkedInvoice,amount,...overrides});
    const linkedState=async()=>{
      const {rows:[row]}=await pool.query('SELECT t.payment_status,t.total,c.credit_balance FROM sales_transactions t JOIN customers c ON c.id=t.customer_id AND c.shop_id=t.shop_id WHERE t.id=$1',[linkedInvoice]);
      return [row.payment_status,Number(row.total),Number(row.credit_balance)];
    };
    await assert.rejects(()=>addCustomerCreditPayment(linkedPayment('wrong',100,{shopId:wrongShop})),/belonging to this customer/);
    await assert.rejects(()=>addCustomerCreditPayment(linkedPayment('wrong-customer',100,{customerId})),/belonging to this customer/);
    const firstPayment=linkedPayment('first',100);
    const snapshot=await addCustomerCreditPayment(firstPayment);
    assert.deepEqual(snapshot,{invoiceNumber:linkedSale.invoiceNumber,invoiceTotal:400,previousPayments:0,balanceAfter:300});
    assert.deepEqual(await linkedState(),['PARTIALLY PAID',400,300]);
    await assert.rejects(()=>addCustomerCreditPayment(firstPayment),/duplicate key/);
    await assert.rejects(()=>addCustomerCreditPayment(linkedPayment('excess',301)),/exceeds/);
    await assert.rejects(()=>addCustomerCreditPayment(linkedPayment('unallocated',50,{invoiceId:undefined})),/Select an invoice/);
    await assert.rejects(()=>refundTransaction(linkedInvoice,shopId,'CI refund before reconciliation','CI Manager','Store Manager'),/Reconcile customer payments/);
    assert.deepEqual(await linkedState(),['PARTIALLY PAID',400,300]);
    const outcomes=await Promise.allSettled([addCustomerCreditPayment(linkedPayment('concurrent-a',200)),addCustomerCreditPayment(linkedPayment('concurrent-b',200))]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.deepEqual(await linkedState(),['PARTIALLY PAID',400,100]);
    const finalRequest=linkedPayment('final',100);
    const finalResults=await Promise.all([addCustomerCreditPayment(finalRequest,true),addCustomerCreditPayment(finalRequest,true)]);
    assert.deepEqual(finalResults[0],finalResults[1],'Concurrent identical requests must return the same receipt');
    const finalSnapshot=finalResults[0];
    assert.equal(finalSnapshot.balanceAfter,0);
    assert.deepEqual(await linkedState(),['PAID',400,0]);
    assert.deepEqual(await addCustomerCreditPayment(finalRequest,true),finalSnapshot,'Retry after full settlement must succeed');
    assert.deepEqual(await addCustomerCreditPayment(firstPayment,true),snapshot,'Earlier payment retry must preserve its original balance');
    for(const changed of [{amount:99},{shopId:wrongShop},{customerId},{invoiceId:txId},{paymentMethod:'Cash'},{date:'2025-01-01'},{note:'Different note'},{createdBy:'Different operator'}]){
      await assert.rejects(()=>addCustomerCreditPayment({...finalRequest,...changed},true),/Payment request ID already used for different details/);
    }
    assert.deepEqual(await linkedState(),['PAID',400,0]);
    const replayAudit=await pool.query("SELECT COUNT(*)::int AS n FROM activity_logs WHERE id=$1",['credit-payment-'+finalRequest.id]);
    assert.equal(replayAudit.rows[0].n,1,'Replays must not duplicate payment audit entries');
    assert.equal(await readStock(),linkedStock,'Payment and rejected refund never change stock');
    const saved=await pool.query('SELECT receipt_snapshot FROM customer_credit_payments WHERE id=$1',[firstPayment.id]);
    assert.deepEqual(saved.rows[0].receipt_snapshot,snapshot,'Later payments must not rewrite earlier receipt balances');
    const linkedCount=await pool.query('SELECT COUNT(*)::int AS n FROM customer_credit_payments WHERE invoice_id=$1',[linkedInvoice]);
    assert.equal(linkedCount.rows[0].n,3);
    const received = await pool.query('SELECT status FROM purchase_orders WHERE id=$1', [poId]);
    assert.equal(received.rows[0].status, 'Received');
    const warehouse = await pool.query("SELECT COALESCE(SUM(quantity),0) AS qty FROM stock_logs WHERE shop_id=$1 AND product_id=$2 AND type='Stock In'", [shopId, productId]);
    const sales = await pool.query("SELECT COALESCE(SUM(quantity),0) AS qty FROM stock_logs WHERE shop_id=$1 AND product_id=$2 AND type='Stock Out'", [shopId, productId]);
    assert.equal(Number(warehouse.rows[0].qty), 8);
    assert.equal(Number(sales.rows[0].qty), -5);
    assert.equal(Number(warehouse.rows[0].qty) + Number(sales.rows[0].qty), await readStock());
    const customer = await pool.query('SELECT purchase_count,credit_balance FROM customers WHERE id=$1 AND shop_id=$2', [customerId, shopId]);
    assert.equal(Number(customer.rows[0].purchase_count), 1);
    const receipts = await pool.query('SELECT COUNT(*)::int AS count FROM ars_receipt_batches WHERE purchase_order_id=$1', [poId]);
    assert.equal(receipts.rows[0].count, 2, 'Only two distinct goods receipts should be recorded');
  } finally {
    await pool.end();
  }
});
