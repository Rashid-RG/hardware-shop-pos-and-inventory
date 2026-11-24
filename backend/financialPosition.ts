import type {Pool} from 'pg';

/** Current operational position, not a statutory balance sheet. No balancing plug. */
export async function financialPosition(db:Pool,shopId:string){
 const client=await db.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const result=await client.query(`WITH accounts AS (
    SELECT a.kind,COALESCE(SUM(m.amount),0) AS balance FROM ars_financial_accounts a
    LEFT JOIN ars_financial_movements m ON m.shop_id=a.shop_id AND m.account_id=a.id
    WHERE a.shop_id=$1 GROUP BY a.id,a.kind
  ), capital AS (
    SELECT COALESCE(SUM(amount_lkr) FILTER(WHERE entry_type='Contribution'),0) AS contributions,
    COALESCE(SUM(amount_lkr) FILTER(WHERE entry_type='Drawing'),0) AS drawings
    FROM ars_partner_capital_entries WHERE shop_id=$1
  ), receivables AS (
    SELECT COALESCE(SUM(credit_balance) FILTER(WHERE credit_balance>0),0) AS positive,
    COALESCE(-SUM(credit_balance) FILTER(WHERE credit_balance<0),0) AS credits
    FROM customers WHERE shop_id=$1
  )
  SELECT (NOW() AT TIME ZONE 'Asia/Colombo')::date::text AS day,
    COALESCE((SELECT SUM(balance) FROM accounts WHERE kind IN ('Office Cash','Bank','Representative Cash') AND balance>0),0) AS cash,
    COALESCE((SELECT -SUM(balance) FROM accounts WHERE kind IN ('Office Cash','Bank','Representative Cash') AND balance<0),0) AS negative_cash,
    COALESCE((SELECT SUM(balance) FROM accounts WHERE kind='Settlement'),0) AS settlement,
    (SELECT COUNT(*) FROM accounts WHERE kind='Settlement' AND balance<>0) AS settlement_count,
    (SELECT positive FROM receivables) AS receivables,(SELECT credits FROM receivables) AS customer_credits,
    (SELECT contributions FROM capital) AS contributions,(SELECT drawings FROM capital) AS drawings,
    (SELECT COUNT(*) FROM purchase_orders WHERE shop_id=$1 AND status='Partially Received') AS partial_orders,
    (SELECT COUNT(*) FROM ars_partner_profit_allocations WHERE shop_id=$1) AS allocations`,[shopId]);
  const r=result.rows[0];
  const lines=await client.query(`SELECT o.id,o.total,COALESCE(SUM(p.amount),0) AS paid
    FROM purchase_orders o LEFT JOIN supplier_payments p ON p.shop_id=o.shop_id AND p.supplier_id=o.supplier_id AND p.purchase_order_id=o.id
    WHERE o.shop_id=$1 AND o.status='Received' GROUP BY o.id`,[shopId]);
  const round=(n:number)=>Math.round(n*100)/100;
  const receivedOrderOutstandingEstimate=round(lines.rows.reduce((n,o)=>n+Math.max(0,Number(o.total)-Number(o.paid)),0));
  const overpaidOrders=lines.rows.filter(o=>Number(o.paid)>Number(o.total)||Number(o.total)<=0||Number(o.paid)<0).length;
  const unmatched=await client.query(`SELECT COUNT(*) AS count FROM supplier_payments p WHERE p.shop_id=$1 AND NOT EXISTS(
    SELECT 1 FROM purchase_orders o WHERE o.shop_id=p.shop_id AND o.supplier_id=p.supplier_id AND o.id=p.purchase_order_id AND o.status='Received')`,[shopId]);
  await client.query('COMMIT');
  return {asOf:r.day,recordedCashAndBank:Number(r.cash),negativeCashAccounts:Number(r.negative_cash),
    netSettlementBalance:Number(r.settlement),nonzeroSettlementAccounts:Number(r.settlement_count),
    recordedReceivables:Number(r.receivables),customerCredits:Number(r.customer_credits),
    recordedContributions:Number(r.contributions),recordedDrawings:Number(r.drawings),
    recordedNetCapital:round(Number(r.contributions)-Number(r.drawings)),
    receivedOrderOutstandingEstimate,partialOrders:Number(r.partial_orders),overpaidOrders,
    unmatchedSupplierPayments:Number(unmatched.rows[0].count),profitAllocations:Number(r.allocations),
    complete:false,totalAssets:null,totalLiabilities:null,totalEquity:null,balanceDifference:null,
    limitations:['Inventory and fixed assets require verified valuation.','Supplier liabilities require invoice reconciliation.','Opening equity, retained earnings, taxes and other liabilities require verified ledger balances.','Settlement accounts and partner allocations require classification and reconciliation.']};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
