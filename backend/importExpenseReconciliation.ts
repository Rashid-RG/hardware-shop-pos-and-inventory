import type {Pool,PoolClient} from 'pg';
export async function initImportExpenseReconciliation(db:Pool|PoolClient){
 await db.query(`CREATE TABLE IF NOT EXISTS ars_import_expense_links (
 id TEXT PRIMARY KEY,shop_id TEXT NOT NULL,approval_id TEXT NOT NULL REFERENCES ars_landed_cost_approvals(id),
 expense_id TEXT NOT NULL,charge_kind TEXT NOT NULL CHECK(charge_kind IN ('Freight','Customs','Clearance')),
 amount NUMERIC(16,2) NOT NULL CHECK(amount>0),evidence TEXT NOT NULL,recorded_by TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expense_snapshot JSONB NOT NULL,
 UNIQUE(shop_id,expense_id)
 ); CREATE INDEX IF NOT EXISTS ars_import_expense_links_approval ON ars_import_expense_links(shop_id,approval_id,charge_kind);`);
}
/** One verified whole payment per link. Splitting and reversing links require a separate audited workflow. */
export async function linkImportExpense(db:Pool,input:{id:string;shopId:string;approvalId:string;expenseId:string;chargeKind:'Freight'|'Customs'|'Clearance';expectedAmount:number;evidence:string;recordedBy:string}){
 const {id,shopId,approvalId,expenseId,chargeKind,expectedAmount,recordedBy}=input,evidence=input.evidence.trim();
 if(!id||!shopId||!approvalId||!expenseId||!recordedBy||!['Freight','Customs','Clearance'].includes(chargeKind)||!Number.isFinite(expectedAmount)||expectedAmount<=0||expectedAmount>1e9||Math.abs(expectedAmount*100-Math.round(expectedAmount*100))>0.001||!evidence||evidence.length>500)throw Error('Valid verified payment and evidence required.');
 const client=await db.connect();
 try{
 await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['import-expense-'+id]);
 const prior=await client.query('SELECT * FROM ars_import_expense_links WHERE id=$1',[id]);
 if(prior.rowCount){const p=prior.rows[0];if(p.shop_id!==shopId||p.approval_id!==approvalId||p.expense_id!==expenseId||p.charge_kind!==chargeKind||Number(p.amount)!==expectedAmount||p.evidence!==evidence||p.recorded_by!==recordedBy)throw Error('Reconciliation request identifier already used.');await client.query('COMMIT');return {id,replayed:true};}
 const a=await client.query('SELECT snapshot FROM ars_landed_cost_approvals WHERE id=$1 AND shop_id=$2 FOR UPDATE',[approvalId,shopId]);
 if(!a.rowCount)throw Error('Approved shipment not found in this shop.');
 const e=await client.query('SELECT id,description,category,amount,date::text AS day FROM manual_expenses WHERE id=$1 AND shop_id=$2 FOR UPDATE',[expenseId,shopId]);
 if(!e.rowCount||Number(e.rows[0].amount)!==expectedAmount)throw Error('Expense missing or amount changed. Refresh before linking.');
 const movement=await client.query("SELECT id,account_id,amount,effective_date::text AS day FROM ars_financial_movements WHERE shop_id=$1 AND source_id=$2 AND movement_kind='Expense'",[shopId,expenseId]);
 if(movement.rowCount!==1||Number(movement.rows[0].amount)!==-expectedAmount||movement.rows[0].day!==e.rows[0].day)throw Error('Expense must have one matching verified financial payment.');
 const duplicate=await client.query('SELECT 1 FROM ars_import_expense_links WHERE shop_id=$1 AND expense_id=$2',[shopId,expenseId]);
 if(duplicate.rowCount)throw Error('Expense already reconciled.');
 const s=a.rows[0].snapshot,cap=Number(chargeKind==='Freight'?s.freightLkr:chargeKind==='Customs'?s.customsLkr:s.clearanceLkr);
 if(!Number.isFinite(cap)||cap<0)throw Error('Invalid approved charge amount.');
 const remaining=await client.query('SELECT $4::numeric-COALESCE(SUM(amount),0)>=$5::numeric AS sufficient FROM ars_import_expense_links WHERE shop_id=$1 AND approval_id=$2 AND charge_kind=$3',[shopId,approvalId,chargeKind,cap,expectedAmount]);
 if(!remaining.rows[0].sufficient)throw Error('Payment exceeds remaining approved shipment charge.');
 await client.query('INSERT INTO ars_import_expense_links(id,shop_id,approval_id,expense_id,charge_kind,amount,evidence,recorded_by,expense_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',[id,shopId,approvalId,expenseId,chargeKind,expectedAmount,evidence,recordedBy,JSON.stringify({...e.rows[0],movement:movement.rows[0]})]);
 await client.query('COMMIT');return {id,replayed:false};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

export async function listImportExpenseReview(db:Pool,shopId:string){
 const result=await db.query(`WITH approvals AS (
 SELECT a.id,a.shipment_id,a.purchase_order_id,a.approved_at,a.snapshot->>'poNumber' AS po_number,
 a.snapshot->>'freightLkr' AS freight,a.snapshot->>'customsLkr' AS customs,a.snapshot->>'clearanceLkr' AS clearance,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'expenseId',l.expense_id,'kind',l.charge_kind,'amount',l.amount,'evidence',l.evidence,'recordedBy',l.recorded_by,'recordedAt',l.recorded_at) ORDER BY l.recorded_at,l.id) FROM ars_import_expense_links l WHERE l.shop_id=a.shop_id AND l.approval_id=a.id),'[]'::jsonb) AS links
 FROM ars_landed_cost_approvals a WHERE a.shop_id=$1 ORDER BY a.approved_at DESC,a.id LIMIT 250
 ), expenses AS (
 SELECT e.id,e.description,e.category,e.amount,e.date::text AS day
 FROM manual_expenses e WHERE e.shop_id=$1 AND e.amount>0
 AND NOT EXISTS(SELECT 1 FROM ars_import_expense_links l WHERE l.shop_id=e.shop_id AND l.expense_id=e.id)
 AND 1=(SELECT COUNT(*) FROM ars_financial_movements m WHERE m.shop_id=e.shop_id AND m.source_id=e.id AND m.movement_kind='Expense')
 AND EXISTS(SELECT 1 FROM ars_financial_movements m WHERE m.shop_id=e.shop_id AND m.source_id=e.id AND m.movement_kind='Expense' AND m.amount=-e.amount AND m.effective_date=e.date::date)
 ORDER BY e.date DESC,e.id LIMIT 500
 )
 SELECT COALESCE((SELECT jsonb_agg(approvals ORDER BY approved_at DESC,id) FROM approvals),'[]'::jsonb) AS approvals,
 COALESCE((SELECT jsonb_agg(expenses ORDER BY day DESC,id) FROM expenses),'[]'::jsonb) AS expenses`,[shopId]);
 return result.rows[0];
}
