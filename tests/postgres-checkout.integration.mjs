import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// This integration test can only run against the dedicated ephemeral CI database.
const connection = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['127.0.0.1', 'localhost'].includes(connection.hostname) || connection.pathname !== '/hardware_pos_ci') {
  throw new Error('Refusing integration test outside local hardware_pos_ci database');
}

const { pool, initDbTables, checkoutTransaction, refundTransaction, archiveProduct } = await import('../backend/db.ts');

test('real PostgreSQL checkout commits exact variant, credit and invoice atomically', async () => {
  const suffix = randomUUID();
  const shopId = 'ci-shop';
  const productId = 'ci-product-' + suffix;
  const customerId = 'ci-customer-' + suffix;
  const variantId = 'ci-variant-' + suffix;
  try {
    await initDbTables();
    const variants = [{
      id: variantId, name: '50 mm', unit: 'Piece',
      sku: 'CI-50-' + suffix, barcode: 'ci-' + suffix,
      costPrice: 60, sellingPrice: 100, quantity: 10, reorderLevel: 2,
    }];
    await pool.query(
      `INSERT INTO products
       (id,shop_id,name,sku,brand,category,cost_price,selling_price,quantity,reorder_level,warranty,description,variants_json)
       VALUES ($1,$2,'CI pipe',$3,'CI','Pipes',60,100,10,2,'None','Integration fixture',$4::jsonb)`,
      [productId, shopId, 'CI-' + suffix, JSON.stringify(variants)]
    );
    await pool.query(
      `INSERT INTO customers (id,shop_id,name,loyalty_balance,purchase_count,credit_limit,credit_balance)
       VALUES ($1,$2,'CI Trade Customer',0,0,250,0)`,
      [customerId, shopId]
    );
    const tx = (quantity, id) => ({
      id, shopId, invoiceNumber: 'CI-INV-' + id, date: new Date().toISOString(),
      customerId, customerName: 'CI Trade Customer', cashierName: 'CI Cashier',
      items: [{
        productId, productName: 'CI pipe (50 mm)', variantId, variantName: '50 mm',
        variantUnit: 'Piece', variantSku: variants[0].sku, variantBarcode: variants[0].barcode,
        quantity, sellingPrice: 100, costPrice: 60, discount: 0,
      }],
      subtotal: quantity * 100, tax: 0, discountAmount: 0, total: quantity * 100,
      paymentMethod: 'Credit Account', paymentStatus: 'CREDIT SALE',
    });

    const first = 'ci-tx-' + randomUUID();
    await checkoutTransaction(tx(2, first), 'Cashier', 'CI Shop');
    const stock = await pool.query('SELECT quantity, variants_json FROM products WHERE id = $1', [productId]);
    assert.equal(Number(stock.rows[0].quantity), 8);
    assert.equal(stock.rows[0].variants_json[0].quantity, 8);

    const invoice = await pool.query(
      'SELECT variant_id, variant_sku, quantity FROM sales_transaction_items WHERE transaction_id = $1', [first]
    );
    assert.equal(invoice.rows[0].variant_id, variantId);
    assert.equal(invoice.rows[0].variant_sku, variants[0].sku);
    assert.equal(Number(invoice.rows[0].quantity), 2);

    const customer = await pool.query('SELECT credit_balance,purchase_count FROM customers WHERE id = $1', [customerId]);
    assert.equal(Number(customer.rows[0].credit_balance), 200);
    assert.equal(Number(customer.rows[0].purchase_count), 1);

    const rejected = 'ci-tx-' + randomUUID();
    await assert.rejects(
      () => checkoutTransaction(tx(1, rejected), 'Cashier', 'CI Shop'),
      /Credit limit exceeded/
    );
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM sales_transactions WHERE id = $1', [rejected]);
    assert.equal(count.rows[0].count, 0);
    const after = await pool.query('SELECT quantity FROM products WHERE id = $1', [productId]);
    assert.equal(Number(after.rows[0].quantity), 8, 'Failed credit sale must not decrease stock');

    // Wrong-shop refund must fail without touching stock or credit.
    await assert.rejects(
      () => refundTransaction(first, 'ci-other-shop', 'Wrong shop', 'CI Manager', 'Store Manager'),
      /Transaction not found/
    );

    // An account-level payment can make the remaining credit less than the
    // invoice. Never erase the paid portion by silently reducing credit to zero.
    await pool.query('UPDATE customers SET credit_balance = 150 WHERE id = $1', [customerId]);
    await assert.rejects(
      () => refundTransaction(first, shopId, 'Credit already paid', 'CI Manager', 'Store Manager'),
      /Credit balance is below this invoice total/
    );
    const afterFailedRefund = await pool.query('SELECT quantity FROM products WHERE id = $1', [productId]);
    assert.equal(Number(afterFailedRefund.rows[0].quantity), 8, 'Failed refund must roll back stock');

    // Once payments are reconciled, refund restores the precise variant.
    await pool.query('UPDATE customers SET credit_balance = 200 WHERE id = $1', [customerId]);
    await refundTransaction(first, shopId, 'Customer returned goods', 'CI Manager', 'Store Manager');
    const stockRestored = await pool.query('SELECT quantity, variants_json FROM products WHERE id = $1', [productId]);
    assert.equal(Number(stockRestored.rows[0].quantity), 10);
    assert.equal(stockRestored.rows[0].variants_json[0].quantity, 10);
    const refundedCustomer = await pool.query(
      'SELECT credit_balance,purchase_count,loyalty_balance FROM customers WHERE id = $1', [customerId]
    );
    assert.equal(Number(refundedCustomer.rows[0].credit_balance), 0);
    assert.equal(Number(refundedCustomer.rows[0].purchase_count), 0);
    assert.equal(Number(refundedCustomer.rows[0].loyalty_balance), 0);
    const invoiceStatus = await pool.query('SELECT status FROM sales_transactions WHERE id = $1', [first]);
    assert.equal(invoiceStatus.rows[0].status, 'Refunded');
    await assert.rejects(
      () => refundTransaction(first, shopId, 'Duplicate attempt', 'CI Manager', 'Store Manager'),
      /already been refunded/
    );
    const returnLogs = await pool.query(
      "SELECT COUNT(*)::int AS count FROM stock_logs WHERE reference_id = $1 AND type = 'Return'", [first]
    );
    assert.equal(returnLogs.rows[0].count, 1);

    const {initFinancialAccounts,createFinancialAccount,listFinancialAccounts,recordFinancialTransfer}=await import('../backend/financialAccounts.ts');
    await initFinancialAccounts(pool);
    const cash=randomUUID(),bank=randomUUID(),foreign=randomUUID(),day='2026-11-24';
    for(const [id,name,kind,scope] of [[cash,'Checkout cash '+suffix,'Office Cash',shopId],[bank,'Checkout bank '+suffix,'Bank',shopId],[foreign,'Other bank '+suffix,'Bank','other-shop']])await createFinancialAccount(pool,{id,shopId:scope,name,kind,recordedBy:'CI Manager'});
    const balance=async id=>(await listFinancialAccounts(pool,shopId)).find(a=>a.id===id).balance;
    const quantity=async()=>Number((await pool.query('SELECT quantity FROM products WHERE id=$1',[productId])).rows[0].quantity);
    const paid={...tx(2,'ci-paid-'+randomUUID()),paymentMethod:'Cash',paymentStatus:'PAID',cashReceived:250,changeDue:50};
    const request={actor:'CI Manager',fingerprint:'ci-exact-request'};
    const destination={destinationAccountId:cash,recordedBy:'CI Manager',effectiveDate:day};
    await assert.rejects(checkoutTransaction(paid,'Store Manager','CI Shop',undefined,{...destination,destinationAccountId:foreign},request),/matching the payment method/);
    assert.equal(await quantity(),10);
    assert.equal(await balance(cash),0);
    const results=await Promise.all([checkoutTransaction(structuredClone(paid),'Store Manager','CI Shop',undefined,destination,request),checkoutTransaction(structuredClone(paid),'Store Manager','CI Shop',undefined,destination,request)]);
    assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);
    assert.equal(await quantity(),8);assert.equal(await balance(cash),200);
    assert.equal(Number((await pool.query('SELECT credit_balance FROM customers WHERE id=$1',[customerId])).rows[0].credit_balance),0);
    await assert.rejects(checkoutTransaction(paid,'Store Manager','CI Shop',undefined,destination,{...request,fingerprint:'changed'}),/identifier already used/);
    const transfer={requestId:randomUUID(),shopId,fromAccountId:cash,toAccountId:bank,amount:50,effectiveDate:day,recordedBy:'CI Manager'};
    await recordFinancialTransfer(pool,transfer);
    await assert.rejects(refundTransaction(paid.id,shopId,'Insufficient funds','CI Manager','Store Manager'),/Insufficient recorded funds/);
    assert.equal(await quantity(),8);assert.equal(await balance(cash),150);
    assert.equal((await pool.query('SELECT status FROM sales_transactions WHERE id=$1',[paid.id])).rows[0].status,'Completed');
    await recordFinancialTransfer(pool,{...transfer,requestId:randomUUID(),fromAccountId:bank,toAccountId:cash});
    await refundTransaction(paid.id,shopId,'Return paid goods','CI Manager','Store Manager');
    assert.equal(await quantity(),10);assert.equal(await balance(cash),0);
    await assert.rejects(refundTransaction(paid.id,shopId,'Duplicate refund','CI Manager','Store Manager'),/already been refunded/);
    const movements=await pool.query('SELECT movement_kind,amount FROM ars_financial_movements WHERE shop_id=$1 AND source_id=$2 ORDER BY movement_kind',[shopId,paid.id]);
    assert.deepEqual(movements.rows.map(r=>[r.movement_kind,Number(r.amount)]),[['Invoice Payment',200],['Invoice Refund',-200]]);
    const bankPaid={...tx(1,'ci-bank-'+randomUUID()),paymentMethod:'Bank Transfer',paymentStatus:'PAID'};
    await checkoutTransaction(bankPaid,'Store Manager','CI Shop',undefined,{...destination,destinationAccountId:bank},{...request,fingerprint:'bank-payment'});
    assert.equal(await balance(bank),100);assert.equal(await quantity(),9);
    await refundTransaction(bankPaid.id,shopId,'Bank refund','CI Manager','Store Manager');
    assert.equal(await balance(bank),0);assert.equal(await quantity(),10);

    // Historical profit must remain independent of current catalogue costs.
    const {financialProfitReport,financialCashFlow,correctHistoricalInvoiceCost}=await import('../backend/financialAccounts.ts');
    const businessDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const profitSale={...tx(2,'ci-profit-'+randomUUID()),paymentMethod:'Cash',paymentStatus:'PAID',subtotal:200,discountAmount:20,tax:18,total:198,cashReceived:198,changeDue:0};
    await checkoutTransaction(profitSale,'Store Manager','CI Shop');
    const beforeProfit=await financialProfitReport(pool,shopId,businessDay,businessDay);
    assert.equal(beforeProfit.complete,true);
    await pool.query('UPDATE products SET cost_price=999 WHERE id=$1',[productId]);
    const afterCostChange=await financialProfitReport(pool,shopId,businessDay,businessDay);
    assert.deepEqual(afterCostChange,beforeProfit);
    await pool.query('UPDATE sales_transaction_items SET cost_price=0 WHERE transaction_id=$1',[profitSale.id]);
    const incomplete=await financialProfitReport(pool,shopId,businessDay,businessDay);
    assert.equal(incomplete.complete,false);assert.equal(incomplete.grossProfit,null);assert.equal(incomplete.operatingEstimate,null);
    const line=(await pool.query('SELECT id::text AS id,cost_price FROM sales_transaction_items WHERE transaction_id=$1',[profitSale.id])).rows[0];
    const correction={id:randomUUID(),shopId,transactionId:profitSale.id,itemId:line.id,expectedCost:0,correctedCost:65,evidence:'CI supplier invoice',reason:'Verified historical unit cost',recordedBy:'CI Admin'};
    await assert.rejects(correctHistoricalInvoiceCost(pool,{...correction,shopId:'other-shop'}),/not found in this shop/);
    await assert.rejects(correctHistoricalInvoiceCost(pool,{...correction,evidence:''}),/Invalid historical cost correction/);
    await assert.rejects(correctHistoricalInvoiceCost(pool,{...correction,correctedCost:0}),/Invalid historical cost correction/);
    const duplicates=await Promise.all([correctHistoricalInvoiceCost(pool,correction),correctHistoricalInvoiceCost(pool,correction)]);
    assert.deepEqual(duplicates.map(r=>r.replayed).sort(),[false,true]);
    await assert.rejects(correctHistoricalInvoiceCost(pool,{...correction,correctedCost:70}),/identifier already used/);
    const corrected=await financialProfitReport(pool,shopId,businessDay,businessDay);
    assert.equal(corrected.complete,true);assert.equal(corrected.knownCost,beforeProfit.knownCost+10);
    const competing=await Promise.allSettled([60,62].map(correctedCost=>correctHistoricalInvoiceCost(pool,{...correction,id:randomUUID(),expectedCost:65,correctedCost})));
    assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
    const revisions=(await pool.query('SELECT original_cost,previous_cost,corrected_cost FROM ars_invoice_cost_corrections WHERE shop_id=$1 AND transaction_id=$2 AND item_id=$3 ORDER BY revision',[shopId,profitSale.id,line.id])).rows;
    assert.equal(revisions.length,2);assert.equal(Number(revisions[0].original_cost),0);assert.equal(Number(revisions[0].previous_cost),0);assert.equal(Number(revisions[1].previous_cost),65);
    const current=Number(revisions[1].corrected_cost);
    if(current!==60)await correctHistoricalInvoiceCost(pool,{...correction,id:randomUUID(),expectedCost:current,correctedCost:60});
    assert.equal(Number((await pool.query('SELECT cost_price FROM sales_transaction_items WHERE id=$1',[line.id])).rows[0].cost_price),0);
    assert.equal((await financialProfitReport(pool,shopId,businessDay,businessDay)).knownCost,beforeProfit.knownCost);
    // Keep the original zero snapshot and its append-only correction history for backup verification.
    await refundTransaction(profitSale.id,shopId,'Profit report fixture return','CI Manager','Store Manager');
    const afterRefund=await financialProfitReport(pool,shopId,businessDay,businessDay);
    assert.equal(afterRefund.netSales,beforeProfit.netSales-180);
    assert.equal(afterRefund.knownCost,beforeProfit.knownCost-120);
    const otherProfit=await financialProfitReport(pool,'ci-nonexistent-'+suffix,businessDay,businessDay);
    assert.equal(otherProfit.netSales,0);assert.equal(otherProfit.knownCost,0);
    const flow=await financialCashFlow(pool,shopId,'2026-01-01','2099-12-31');
    assert.equal(flow.netTransfers,0);
    assert.equal(flow.closing,flow.opening+flow.operating+flow.openingRegistrations+flow.netTransfers+flow.adjustments);
    // Historical invoices and returned stock must survive archiving a SKU.
    await assert.rejects(
      () => archiveProduct(productId, 'other-shop', 'CI Manager', 'Super Admin'),
      /not found in this shop/
    );
    await archiveProduct(productId, shopId, 'CI Manager', 'Super Admin');
    const archived = await pool.query('SELECT status, quantity FROM products WHERE id=$1', [productId]);
    assert.equal(archived.rows[0].status, 'Inactive');
    assert.equal(Number(archived.rows[0].quantity), 10);
    const preservedItems = await pool.query(
      'SELECT COUNT(*)::int AS count FROM sales_transaction_items WHERE transaction_id=$1', [first]
    );
    assert.equal(preservedItems.rows[0].count, 1);
    await assert.rejects(
      () => archiveProduct(productId, shopId, 'CI Manager', 'Super Admin'),
      /already archived/
    );
    await assert.rejects(
      () => checkoutTransaction(tx(1, 'ci-archived-' + randomUUID()), 'Cashier', 'CI Shop'),
      /archived and cannot be sold/
    );
  } finally {
    await pool.end();
  }
});
