import type {Pool,PoolClient} from 'pg';

export async function initReceivableAging(db:Pool|PoolClient){
 await db.query(`CREATE TABLE IF NOT EXISTS ars_invoice_due_dates (
 shop_id TEXT NOT NULL,invoice_id TEXT NOT NULL,due_date DATE NOT NULL,
 evidence TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(shop_id,invoice_id)
 );`);
}

/** Current outstanding snapshot, not a reconstructed historical balance. */
export async function receivableAging(db:Pool,shopId:string){
 const result=await db.query(`WITH today AS (
 SELECT (NOW() AT TIME ZONE 'Asia/Colombo')::date AS day
 ), payments AS (
 SELECT p.customer_id,p.invoice_id,SUM(p.amount) AS paid
 FROM customer_credit_payments p WHERE p.shop_id=$1 GROUP BY p.customer_id,p.invoice_id
 ), invoices AS (
 SELECT t.id,t.invoice_number,t.customer_id,t.customer_name,
 (t.date AT TIME ZONE 'Asia/Colombo')::date AS invoice_day,
 d.due_date,d.evidence AS due_date_evidence,d.recorded_by AS due_date_recorded_by,t.total,COALESCE(p.paid,0) AS paid,
 t.total-COALESCE(p.paid,0) AS outstanding
 FROM sales_transactions t
 LEFT JOIN payments p ON p.invoice_id=t.id AND p.customer_id=t.customer_id
 LEFT JOIN ars_invoice_due_dates d ON d.shop_id=t.shop_id AND d.invoice_id=t.id
 WHERE t.shop_id=$1 AND t.payment_method='Credit Account' AND t.status='Completed'
 ), accounts AS (
 SELECT c.id,c.name,c.credit_balance AS recorded_balance,
 COALESCE((SELECT SUM(i.outstanding) FROM invoices i WHERE i.customer_id=c.id),0) AS invoice_balance,
 COALESCE((SELECT p.paid FROM payments p WHERE p.customer_id=c.id AND p.invoice_id IS NULL),0) AS unallocated_payments
 FROM customers c WHERE c.shop_id=$1
 ), lines AS (
 SELECT i.*,today.day-i.invoice_day AS invoice_age,
 CASE WHEN i.due_date IS NULL THEN NULL ELSE GREATEST(today.day-i.due_date,0) END AS overdue_days,
 CASE WHEN i.outstanding<0 OR i.total<=0 OR i.paid<0 OR i.customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM accounts a WHERE a.id=i.customer_id) THEN 'Review'
 WHEN i.due_date IS NULL THEN 'No due date'
 WHEN i.due_date>=today.day THEN 'Not overdue'
 WHEN today.day-i.due_date<=30 THEN '1–30'
 WHEN today.day-i.due_date<=60 THEN '31–60'
 WHEN today.day-i.due_date<=90 THEN '61–90'
 ELSE '90+' END AS bucket FROM invoices i CROSS JOIN today
 WHERE i.outstanding<>0 OR i.total<=0 OR i.paid<0
 )
 SELECT (SELECT day::text FROM today) AS as_of,
 COALESCE((SELECT jsonb_agg(lines ORDER BY invoice_day,id) FROM lines),'[]'::jsonb) AS invoices,
 COALESCE((SELECT jsonb_agg(a ORDER BY name,id) FROM (SELECT *,recorded_balance-invoice_balance AS difference FROM accounts WHERE recorded_balance<>0 OR invoice_balance<>0 OR unallocated_payments<>0) a),'[]'::jsonb) AS customers`,[shopId]);
 const r=result.rows[0];
 const invoices=r.invoices.map((i:any)=>({...i,total:Number(i.total),paid:Number(i.paid),outstanding:Number(i.outstanding)}));
 const customers=r.customers.map((c:any)=>({...c,recorded_balance:Number(c.recorded_balance),invoice_balance:Number(c.invoice_balance),unallocated_payments:Number(c.unallocated_payments),difference:Number(c.difference)}));
 const buckets=['Not overdue','1–30','31–60','61–90','90+','No due date','Review'].map(bucket=>({bucket,amount:Math.round(invoices.filter((i:any)=>i.bucket===bucket).reduce((n:number,i:any)=>n+i.outstanding,0)*100)/100}));
 const sum=(rows:any[],field:string)=>Math.round(rows.reduce((n,r)=>n+r[field],0)*100)/100;
 return {asOf:r.as_of,invoices,customers,buckets,recordedReceivable:sum(customers,'recorded_balance'),invoiceOutstanding:sum(invoices,'outstanding'),unallocatedPayments:sum(customers,'unallocated_payments'),needsReview:customers.filter((c:any)=>c.difference!==0||c.unallocated_payments!==0).length,invoicesRequiringReview:invoices.filter((i:any)=>i.bucket==='Review').length};
}

/** Register the first verified due date only; changing agreed terms needs an audited amendment. */
export async function registerInvoiceDueDate(db:Pool,input:{shopId:string;invoiceId:string;dueDate:string;evidence:string;recordedBy:string}){
 const {shopId,invoiceId,dueDate,recordedBy}=input,evidence=input.evidence.trim();
 const validDate=/^\d{4}-\d{2}-\d{2}$/.test(dueDate)&&!Number.isNaN(Date.parse(dueDate))&&new Date(dueDate).toISOString().slice(0,10)===dueDate&&dueDate>='1900-01-01'&&dueDate<='9999-12-31';
 if(!shopId||!invoiceId||!recordedBy||!validDate||!evidence||evidence.length>500)throw Error('Valid due date and supporting evidence required.');
 const client=await db.connect();
 try{
 await client.query('BEGIN');
 const invoice=await client.query("SELECT status,payment_method,customer_id,(date AT TIME ZONE 'Asia/Colombo')::date::text AS day FROM sales_transactions WHERE shop_id=$1 AND id=$2 FOR UPDATE",[shopId,invoiceId]);
 const row=invoice.rows[0];
 if(!row||row.payment_method!=='Credit Account'||!row.customer_id)throw Error('Credit invoice not found in this shop.');
 const prior=await client.query('SELECT due_date::text AS day,evidence,recorded_by FROM ars_invoice_due_dates WHERE shop_id=$1 AND invoice_id=$2',[shopId,invoiceId]);
 if(prior.rowCount){const p=prior.rows[0];if(p.day!==dueDate||p.evidence!==evidence||p.recorded_by!==recordedBy)throw Error('Due date already registered. An audited amendment is required.');await client.query('COMMIT');return {invoiceId,dueDate,replayed:true};}
 if(row.status!=='Completed')throw Error('Only completed credit invoices can receive due dates.');
 if(dueDate<row.day)throw Error('Due date cannot precede the invoice date.');
 const customer=await client.query('SELECT 1 FROM customers WHERE id=$1 AND shop_id=$2',[row.customer_id,shopId]);
 if(!customer.rowCount)throw Error('Customer not found in this shop.');
 await client.query('INSERT INTO ars_invoice_due_dates(shop_id,invoice_id,due_date,evidence,recorded_by) VALUES($1,$2,$3,$4,$5)',[shopId,invoiceId,dueDate,evidence,recordedBy]);
 await client.query('COMMIT');return {invoiceId,dueDate,replayed:false};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
