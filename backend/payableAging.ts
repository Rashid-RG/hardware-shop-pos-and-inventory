import type {Pool,PoolClient} from 'pg';

export async function initPayableAging(db:Pool|PoolClient){
  await db.query(`CREATE TABLE IF NOT EXISTS ars_supplier_due_dates (
    shop_id TEXT NOT NULL,purchase_order_id TEXT NOT NULL,due_date DATE NOT NULL,
    evidence TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(shop_id,purchase_order_id)
  )`);
}

/** Operational estimate from received POs, not a certified supplier invoice ledger. */
export async function supplierPayableAging(db:Pool,shopId:string){
  const result=await db.query(`WITH today AS (
    SELECT (NOW() AT TIME ZONE 'Asia/Colombo')::date AS day
  ), payments AS (
    SELECT supplier_id,purchase_order_id,SUM(amount) AS paid
    FROM supplier_payments WHERE shop_id=$1 GROUP BY supplier_id,purchase_order_id
  ), orders AS (
    SELECT o.id,o.po_number,o.supplier_id,o.supplier_name,o.status,
      (o.date AT TIME ZONE 'Asia/Colombo')::date AS order_day,
      o.total,COALESCE(p.paid,0) AS paid,d.due_date,
      CASE WHEN o.status='Received' THEN o.total-COALESCE(p.paid,0) ELSE NULL END AS outstanding
    FROM purchase_orders o
    LEFT JOIN payments p ON p.purchase_order_id=o.id AND p.supplier_id=o.supplier_id
    LEFT JOIN ars_supplier_due_dates d ON d.shop_id=o.shop_id AND d.purchase_order_id=o.id
    WHERE o.shop_id=$1
  ), lines AS (
    SELECT o.*,CASE
      WHEN o.status<>'Received' THEN 'Review'
      WHEN o.total<=0 OR o.paid<0 OR o.outstanding<0 OR NOT EXISTS(SELECT 1 FROM suppliers s WHERE s.id=o.supplier_id AND s.shop_id=$1) THEN 'Review'
      WHEN o.due_date IS NULL THEN 'No due date'
      WHEN o.due_date>=today.day THEN 'Not overdue'
      WHEN today.day-o.due_date<=30 THEN '1-30'
      WHEN today.day-o.due_date<=60 THEN '31-60'
      WHEN today.day-o.due_date<=90 THEN '61-90'
      ELSE '90+' END AS bucket
    FROM orders o CROSS JOIN today
    WHERE (o.status='Received' AND (o.outstanding<>0 OR o.total<=0 OR o.paid<0))
       OR (o.status<>'Received' AND (o.paid<>0 OR o.status='Partially Received'))
  ), unmatched AS (
    SELECT p.supplier_id,p.purchase_order_id,p.paid FROM payments p
    WHERE p.purchase_order_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM orders o WHERE o.id=p.purchase_order_id AND o.supplier_id=p.supplier_id)
  )
  SELECT (SELECT day::text FROM today) AS as_of,
    COALESCE((SELECT jsonb_agg(lines ORDER BY order_day,id) FROM lines),'[]'::jsonb) AS orders,
    COALESCE((SELECT jsonb_agg(unmatched ORDER BY supplier_id,purchase_order_id) FROM unmatched),'[]'::jsonb) AS unmatched_payments`,[shopId]);
  const r=result.rows[0];
  const orders=r.orders.map((o:any)=>({...o,total:Number(o.total),paid:Number(o.paid),outstanding:o.outstanding===null?null:Number(o.outstanding)}));
  const unmatchedPayments=r.unmatched_payments.map((p:any)=>({...p,paid:Number(p.paid)}));
  const buckets=['Not overdue','1-30','31-60','61-90','90+','No due date'].map(bucket=>({bucket,amount:Math.round(orders.filter((o:any)=>o.bucket===bucket).reduce((n:number,o:any)=>n+o.outstanding,0)*100)/100}));
  return {asOf:r.as_of,orders,unmatchedPayments,buckets,estimatedPayable:Math.round(buckets.reduce((n,b)=>n+b.amount,0)*100)/100,needsReview:orders.filter((o:any)=>o.bucket==='Review').length+unmatchedPayments.length};
}
