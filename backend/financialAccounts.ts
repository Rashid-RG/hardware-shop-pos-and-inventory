import type { Pool, PoolClient } from 'pg';

export type FinancialAccountKind='Office Cash'|'Bank'|'Representative Cash'|'Settlement';
export async function initFinancialAccounts(db:Pool|PoolClient){
  await db.query(`
    CREATE TABLE IF NOT EXISTS ars_financial_accounts (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
      kind TEXT NOT NULL CHECK(kind IN ('Office Cash','Bank','Representative Cash','Settlement')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(shop_id,id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ars_financial_account_name ON ars_financial_accounts(shop_id,lower(trim(name)));
    CREATE TABLE IF NOT EXISTS ars_financial_movements (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL CHECK(amount<>0),
      movement_kind TEXT NOT NULL CHECK(movement_kind IN ('Opening Balance','Customer Collection','Transfer In','Transfer Out','Supplier Payment','Expense','Adjustment')),
      source_id TEXT NOT NULL,
      recorded_by TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      effective_date DATE NOT NULL,
      note TEXT,
      FOREIGN KEY(shop_id,account_id) REFERENCES ars_financial_accounts(shop_id,id),
      UNIQUE(shop_id,movement_kind,source_id,account_id)
    );

    CREATE TABLE IF NOT EXISTS ars_customer_cheques (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      invoice_id TEXT,
      cheque_number TEXT NOT NULL CHECK(length(trim(cheque_number)) BETWEEN 1 AND 80),
      issuing_bank TEXT NOT NULL CHECK(length(trim(issuing_bank)) BETWEEN 1 AND 120),
      drawer_name TEXT NOT NULL CHECK(length(trim(drawer_name)) BETWEEN 1 AND 160),
      amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
      received_date DATE NOT NULL,
      due_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'Received' CHECK(status IN ('Received','Deposited','Cleared','Bounced','Cancelled','Returned')),
      deposit_account_id TEXT,
      payment_id TEXT UNIQUE,
      recorded_by TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      note TEXT,
      UNIQUE(shop_id,id),
      FOREIGN KEY(shop_id,deposit_account_id) REFERENCES ars_financial_accounts(shop_id,id),
      CHECK(status NOT IN ('Deposited','Cleared') OR deposit_account_id IS NOT NULL),
      CHECK((status='Cleared')=(payment_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS ars_customer_cheque_due ON ars_customer_cheques(shop_id,status,due_date);
    CREATE TABLE IF NOT EXISTS ars_customer_cheque_events (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      cheque_id TEXT NOT NULL,
      previous_status TEXT,
      next_status TEXT NOT NULL CHECK(next_status IN ('Received','Deposited','Cleared','Bounced','Cancelled','Returned')),
      effective_date DATE NOT NULL,
      recorded_by TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      note TEXT,
      FOREIGN KEY(shop_id,cheque_id) REFERENCES ars_customer_cheques(shop_id,id)
    );
    CREATE INDEX IF NOT EXISTS ars_customer_cheque_history ON ars_customer_cheque_events(shop_id,cheque_id,recorded_at);

    CREATE TABLE IF NOT EXISTS ars_financial_reconciliations (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      effective_date DATE NOT NULL,
      expected_amount NUMERIC(20,2) NOT NULL,
      observed_amount NUMERIC(20,2) NOT NULL,
      variance NUMERIC(20,2) GENERATED ALWAYS AS (observed_amount-expected_amount) STORED,
      reference TEXT NOT NULL CHECK(length(trim(reference)) BETWEEN 1 AND 200),
      note TEXT,
      recorded_by TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      FOREIGN KEY(shop_id,account_id) REFERENCES ars_financial_accounts(shop_id,id),
      CHECK(observed_amount=expected_amount OR length(trim(COALESCE(note,'')))>0)
    );
    CREATE INDEX IF NOT EXISTS ars_financial_reconciliation_history ON ars_financial_reconciliations(shop_id,account_id,effective_date);
    CREATE INDEX IF NOT EXISTS ars_financial_movement_account ON ars_financial_movements(shop_id,account_id,effective_date);
    CREATE UNIQUE INDEX IF NOT EXISTS ars_financial_collection_once ON ars_financial_movements(shop_id,source_id) WHERE movement_kind='Customer Collection';
  `);
}
export async function listFinancialAccounts(db:Pool|PoolClient,shopId:string){
  const result=await db.query(`
    SELECT a.id,a.name,a.kind,a.active,COALESCE(SUM(m.amount),0) AS balance
    FROM ars_financial_accounts a LEFT JOIN ars_financial_movements m ON m.shop_id=a.shop_id AND m.account_id=a.id
    WHERE a.shop_id=$1 GROUP BY a.id ORDER BY a.kind,a.name
  `,[shopId]);
  return result.rows.map(row=>({id:row.id,name:row.name,kind:row.kind,active:row.active,balance:Number(row.balance)}));
}
export async function createFinancialAccount(db:Pool|PoolClient,input:{id:string;shopId:string;name:string;kind:FinancialAccountKind;recordedBy:string}){
  const name=input.name.trim();
  if(!input.shopId||!input.id||!input.recordedBy||!name||name.length>120||!['Office Cash','Bank','Representative Cash','Settlement'].includes(input.kind))throw Error('Invalid financial account details.');
  await db.query('INSERT INTO ars_financial_accounts(id,shop_id,name,kind,created_by) VALUES($1,$2,$3,$4,$5)',[input.id,input.shopId,name,input.kind,input.recordedBy]);
}

/** Register a nonzero opening balance before any account activity.
 * The account row lock serializes concurrent opening registrations.
 * Authorization and shop scope must be established by the caller.
 */
export async function registerFinancialOpeningBalance(db:Pool,input:{
  id:string;shopId:string;accountId:string;amount:number;effectiveDate:string;recordedBy:string;note?:string;
}){
  const {id,shopId,accountId,amount,effectiveDate,recordedBy}=input;
  if(!id||!shopId||!accountId||!recordedBy||!Number.isFinite(amount)||amount===0||
    Math.abs(amount)>999999999999.99||Math.abs(amount*100-Math.round(amount*100))>0.001||
    !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))throw Error('Invalid opening balance details.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const account=await client.query('SELECT id FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active=TRUE FOR UPDATE',[shopId,accountId]);
    if(!account.rowCount)throw Error('Active financial account not found.');
    const existing=await client.query('SELECT 1 FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2 LIMIT 1',[shopId,accountId]);
    if(existing.rowCount)throw Error('Opening balance requires an account with no recorded movements.');
    await client.query(`INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note)
      VALUES($1,$2,$3,$4,'Opening Balance',$3,$5,$6,$7)`,[id,shopId,accountId,amount,recordedBy,effectiveDate,input.note?.trim()||null]);
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{client.release();}
}

/** Move recorded funds without creating revenue or expense. All movement writers
 * must lock the affected account rows before inserting ledger entries. */
export async function recordFinancialTransfer(db:Pool,input:{
  requestId:string;shopId:string;fromAccountId:string;toAccountId:string;amount:number;effectiveDate:string;recordedBy:string;note?:string;currentBusinessDate?:string;handover?:boolean;
}){
  const {requestId,shopId,fromAccountId,toAccountId,amount,effectiveDate,recordedBy}=input;
  const rawNote=input.note?.trim()||'';
  const note=input.handover?'Representative cash handover: '+rawNote:rawNote||null;
  if(!requestId||!shopId||!fromAccountId||!toAccountId||fromAccountId===toAccountId||!recordedBy||
    !Number.isFinite(amount)||amount<=0||amount>999999999999.99||
    Math.abs(amount*100-Math.round(amount*100))>0.001||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||
    (note&&note.length>500)||(input.handover&&!rawNote))throw Error('Invalid financial transfer details.');
  const client=await db.connect();
  const sourceId='transfer-'+shopId+'-'+requestId;
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[sourceId]);
    const prior=await client.query("SELECT account_id,amount,movement_kind,effective_date::text AS effective_date,recorded_by,note FROM ars_financial_movements WHERE shop_id=$1 AND source_id=$2 AND movement_kind IN ('Transfer In','Transfer Out')",[shopId,sourceId]);
    if(prior.rowCount){
      const out=prior.rows.find(r=>r.movement_kind==='Transfer Out');
      const incoming=prior.rows.find(r=>r.movement_kind==='Transfer In');
      if(prior.rowCount!==2||!out||!incoming||out.account_id!==fromAccountId||incoming.account_id!==toAccountId||
        Number(out.amount)!==-amount||Number(incoming.amount)!==amount||
        prior.rows.some(r=>r.effective_date!==effectiveDate||r.recorded_by!==recordedBy||(r.note||null)!==note))throw Error('Transfer request identifier already used for different details.');
      await client.query('COMMIT');
      return {sourceId,replayed:true};
    }
    if(input.currentBusinessDate&&effectiveDate!==input.currentBusinessDate)throw Error('Only previously committed transfers can be retried for earlier dates.');
    const accounts=await client.query('SELECT id,kind FROM ars_financial_accounts WHERE shop_id=$1 AND id=ANY($2::text[]) AND active=TRUE ORDER BY id FOR UPDATE',[shopId,[fromAccountId,toAccountId]]);
    if(accounts.rowCount!==2)throw Error('Select two active financial accounts in this shop.');
    if(accounts.rows.some(r=>!['Office Cash','Bank','Representative Cash'].includes(r.kind)))throw Error('Settlement accounts are not supported for fund transfers.');
    if(input.handover&&(accounts.rows.find(r=>r.id===fromAccountId)?.kind!=='Representative Cash'||accounts.rows.find(r=>r.id===toAccountId)?.kind!=='Office Cash'))throw Error('Handover requires a representative cash account and an office cash account.');
    const balance=await client.query('SELECT COALESCE(SUM(amount),0) >= $3::numeric AS sufficient FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2',[shopId,fromAccountId,amount]);
    if(!balance.rows[0]?.sufficient)throw Error('Insufficient recorded funds in source account.');
    await client.query(`INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note)
      VALUES($1,$2,$3,-$5::numeric,'Transfer Out',$6,$7,$8,$9),($4,$2,$10,$5::numeric,'Transfer In',$6,$7,$8,$9)`,
      [sourceId+'-out',shopId,fromAccountId,sourceId+'-in',amount,sourceId,recordedBy,effectiveDate,note,toAccountId]);
    await client.query('COMMIT');
    return {sourceId,replayed:false};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

type ChequeRegistration={id:string;shopId:string;customerId:string;invoiceId?:string;chequeNumber:string;issuingBank:string;drawerName:string;amount:number;receivedDate:string;dueDate:string;recordedBy:string;note?:string};
function validChequeDay(value:string){
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
export async function registerCustomerCheque(db:Pool,input:ChequeRegistration){
  const {id,shopId,customerId,invoiceId,amount,receivedDate,dueDate,recordedBy}=input;
  const chequeNumber=input.chequeNumber.trim(),issuingBank=input.issuingBank.trim(),drawerName=input.drawerName.trim(),note=input.note?.trim()||null;
  if(!id||!shopId||!customerId||!recordedBy||!chequeNumber||chequeNumber.length>80||!issuingBank||issuingBank.length>120||!drawerName||drawerName.length>160||
    !Number.isFinite(amount)||amount<=0||amount>999999999999.99||Math.abs(amount*100-Math.round(amount*100))>0.001||
    !validChequeDay(receivedDate)||!validChequeDay(dueDate)||(note&&note.length>500))throw Error('Invalid cheque details.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);
    const prior=await client.query('SELECT *,received_date::text AS received_day,due_date::text AS due_day FROM ars_customer_cheques WHERE id=$1',[id]);
    if(prior.rowCount){
      const p=prior.rows[0];
      if(p.shop_id!==shopId||p.customer_id!==customerId||(p.invoice_id||null)!==(invoiceId||null)||p.cheque_number!==chequeNumber||p.issuing_bank!==issuingBank||p.drawer_name!==drawerName||Number(p.amount)!==amount||p.received_day!==receivedDate||p.due_day!==dueDate||p.recorded_by!==recordedBy||(p.note||null)!==note)throw Error('Cheque request identifier already used for different details.');
      await client.query('COMMIT');return {id,replayed:true};
    }
    if(invoiceId){
      const invoice=await client.query("SELECT total FROM sales_transactions WHERE id=$1 AND shop_id=$2 AND customer_id=$3 AND payment_method='Credit Account' AND status='Completed' FOR UPDATE",[invoiceId,shopId,customerId]);
      if(!invoice.rowCount)throw Error('Select a valid customer credit invoice.');
      const paid=await client.query('SELECT COALESCE(SUM(amount),0) AS paid FROM customer_credit_payments WHERE shop_id=$1 AND invoice_id=$2',[shopId,invoiceId]);
      if(Math.round(amount*100)>Math.round(Number(invoice.rows[0].total)*100)-Math.round(Number(paid.rows[0].paid)*100))throw Error('Cheque exceeds invoice outstanding balance.');
    }
    const customer=await client.query('SELECT credit_balance FROM customers WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,customerId]);
    if(!customer.rowCount||Math.round(amount*100)>Math.round(Number(customer.rows[0].credit_balance)*100))throw Error('Cheque exceeds customer outstanding balance or customer is unavailable.');
    const pending=await client.query("SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(amount) FILTER (WHERE invoice_id=$3),0) AS invoice_total FROM ars_customer_cheques WHERE shop_id=$1 AND customer_id=$2 AND status IN ('Received','Deposited')",[shopId,customerId,invoiceId||null]);
    if(Math.round((Number(pending.rows[0].total)+amount)*100)>Math.round(Number(customer.rows[0].credit_balance)*100))throw Error('Pending cheques plus this cheque exceed customer outstanding balance.');
    if(invoiceId){
      const remaining=await client.query("SELECT s.total-COALESCE((SELECT SUM(p.amount) FROM customer_credit_payments p WHERE p.shop_id=s.shop_id AND p.invoice_id=s.id),0) AS balance FROM sales_transactions s WHERE s.id=$1 AND s.shop_id=$2",[invoiceId,shopId]);
      if(Math.round((Number(pending.rows[0].invoice_total)+amount)*100)>Math.round(Number(remaining.rows[0].balance)*100))throw Error('Pending cheques plus this cheque exceed invoice outstanding balance.');
    }
    const duplicate=await client.query("SELECT 1 FROM ars_customer_cheques WHERE shop_id=$1 AND customer_id=$2 AND lower(issuing_bank)=lower($3) AND lower(cheque_number)=lower($4) AND status NOT IN ('Cancelled','Returned','Bounced')",[shopId,customerId,issuingBank,chequeNumber]);
    if(duplicate.rowCount)throw Error('Cheque already registered for this customer.');
    await client.query(`INSERT INTO ars_customer_cheques(id,shop_id,customer_id,invoice_id,cheque_number,issuing_bank,drawer_name,amount,received_date,due_date,recorded_by,note)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[id,shopId,customerId,invoiceId||null,chequeNumber,issuingBank,drawerName,amount,receivedDate,dueDate,recordedBy,note]);
    await client.query("INSERT INTO ars_customer_cheque_events(id,shop_id,cheque_id,next_status,effective_date,recorded_by,note) VALUES($1,$2,$3,'Received',$4,$5,$6)",[id+'-received',shopId,id,receivedDate,recordedBy,note]);
    await client.query('COMMIT');return {id,replayed:false};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function listCustomerCheques(db:Pool|PoolClient,shopId:string){
  const result=await db.query(`SELECT c.id,c.customer_id AS "customerId",u.name AS "customerName",c.invoice_id AS "invoiceId",c.cheque_number AS "chequeNumber",c.issuing_bank AS "issuingBank",c.drawer_name AS "drawerName",c.amount,c.received_date::text AS "receivedDate",c.due_date::text AS "dueDate",c.status,c.deposit_account_id AS "depositAccountId",c.note
    FROM ars_customer_cheques c LEFT JOIN customers u ON u.id=c.customer_id AND u.shop_id=c.shop_id WHERE c.shop_id=$1 ORDER BY c.due_date,c.id`,[shopId]);
  return result.rows.map(r=>({...r,amount:Number(r.amount)}));
}

type PreClearanceStatus='Deposited'|'Bounced'|'Cancelled'|'Returned';
export async function transitionCustomerCheque(db:Pool,input:{shopId:string;chequeId:string;eventId:string;nextStatus:PreClearanceStatus;effectiveDate:string;recordedBy:string;depositAccountId?:string;note?:string}){
  const {shopId,chequeId,eventId,nextStatus,effectiveDate,recordedBy,depositAccountId}=input;
  const note=input.note?.trim()||null;
  if(!shopId||!chequeId||!eventId||!recordedBy||!validChequeDay(effectiveDate)||!['Deposited','Bounced','Cancelled','Returned'].includes(nextStatus)||
    (nextStatus!=='Deposited'&&!note)||(note&&note.length>500)||(nextStatus==='Deposited'?!depositAccountId:!!depositAccountId))throw Error('Invalid cheque transition details.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const result=await client.query('SELECT *,received_date::text AS received_day,due_date::text AS due_day FROM ars_customer_cheques WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,chequeId]);
    const cheque=result.rows[0];
    if(!cheque)throw Error('Cheque not found in this shop.');
    const previous=await client.query('SELECT *,effective_date::text AS event_day FROM ars_customer_cheque_events WHERE id=$1',[eventId]);
    if(previous.rowCount){
      const e=previous.rows[0];
      if(e.shop_id!==shopId||e.cheque_id!==chequeId||e.next_status!==nextStatus||e.event_day!==effectiveDate||e.recorded_by!==recordedBy||(e.note||null)!==note||(nextStatus==='Deposited'&&cheque.deposit_account_id!==depositAccountId))throw Error('Cheque event identifier already used for different details.');
      await client.query('COMMIT');return {id:chequeId,status:cheque.status,replayed:true};
    }
    const allowed:Record<string,string[]>={Received:['Deposited','Cancelled','Returned'],Deposited:['Bounced','Returned']};
    if(!allowed[cheque.status]?.includes(nextStatus))throw Error('Invalid cheque status transition.');
    const latest=await client.query('SELECT MAX(effective_date)::text AS day FROM ars_customer_cheque_events WHERE shop_id=$1 AND cheque_id=$2',[shopId,chequeId]);
    if(effectiveDate<cheque.received_day||(latest.rows[0]?.day&&effectiveDate<latest.rows[0].day))throw Error('Cheque event date precedes its history.');
    if(nextStatus==='Deposited'){
      if(effectiveDate<cheque.due_day)throw Error('Post-dated cheque cannot be deposited before its due date.');
      const account=await client.query("SELECT id FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active=TRUE AND kind='Bank' FOR UPDATE",[shopId,depositAccountId]);
      if(!account.rowCount)throw Error('Select an active bank account in this shop.');
    }
    await client.query('UPDATE ars_customer_cheques SET status=$1,deposit_account_id=COALESCE($2,deposit_account_id) WHERE shop_id=$3 AND id=$4',[nextStatus,depositAccountId||null,shopId,chequeId]);
    await client.query('INSERT INTO ars_customer_cheque_events(id,shop_id,cheque_id,previous_status,next_status,effective_date,recorded_by,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[eventId,shopId,chequeId,cheque.status,nextStatus,effectiveDate,recordedBy,note]);
    await client.query('COMMIT');return {id:chequeId,status:nextStatus,replayed:false};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Record an immutable comparison, never an adjustment to the ledger. */
export async function recordFinancialReconciliation(db:Pool,input:{
  id:string;shopId:string;accountId:string;effectiveDate:string;observedAmount:number;reference:string;note?:string;recordedBy:string;currentBusinessDate:string;
}){
  const {id,shopId,accountId,effectiveDate,observedAmount,recordedBy}=input;
  const reference=input.reference.trim(),note=input.note?.trim()||null;
  if(!id||!shopId||!accountId||!recordedBy||!validChequeDay(effectiveDate)||
    !Number.isFinite(observedAmount)||Math.abs(observedAmount)>999999999999.99||
    Math.abs(observedAmount*100-Math.round(observedAmount*100))>0.001||
    !reference||reference.length>200||(note&&note.length>500))throw Error('Invalid reconciliation details.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);
    const prior=await client.query('SELECT *,effective_date::text AS day FROM ars_financial_reconciliations WHERE id=$1',[id]);
    if(prior.rowCount){
      const p=prior.rows[0];
      if(p.shop_id!==shopId||p.account_id!==accountId||p.day!==effectiveDate||Number(p.observed_amount)!==observedAmount||p.reference!==reference||(p.note||null)!==note||p.recorded_by!==recordedBy)throw Error('Reconciliation request identifier already used for different details.');
      await client.query('COMMIT');return {id,expectedAmount:Number(p.expected_amount),observedAmount,variance:Number(p.variance),replayed:true};
    }
    if(effectiveDate!==input.currentBusinessDate)throw Error('New reconciliations must use the current business date.');
    const account=await client.query("SELECT kind FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active=TRUE FOR UPDATE",[shopId,accountId]);
    if(!account.rowCount||!['Office Cash','Bank','Representative Cash'].includes(account.rows[0].kind))throw Error('Select an active cash or bank account in this shop.');
    if(account.rows[0].kind!=='Bank'&&observedAmount<0)throw Error('Counted cash cannot be negative.');
    const balance=await client.query('SELECT COALESCE(SUM(amount),0) AS amount,COALESCE(SUM(amount),0)=$3::numeric AS matched FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2 AND effective_date<=$4',[shopId,accountId,observedAmount,effectiveDate]);
    if(!balance.rows[0].matched&&!note)throw Error('Explain the discrepancy before saving.');
    const result=await client.query(`INSERT INTO ars_financial_reconciliations(id,shop_id,account_id,effective_date,expected_amount,observed_amount,reference,note,recorded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING variance`,[id,shopId,accountId,effectiveDate,balance.rows[0].amount,observedAmount,reference,note,recordedBy]);
    await client.query('COMMIT');
    return {id,expectedAmount:Number(balance.rows[0].amount),observedAmount,variance:Number(result.rows[0].variance),replayed:false};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function listFinancialReconciliations(db:Pool|PoolClient,shopId:string){
  const result=await db.query(`SELECT r.id,r.account_id AS "accountId",a.name AS "accountName",r.effective_date::text AS "effectiveDate",r.expected_amount AS "expectedAmount",r.observed_amount AS "observedAmount",r.variance,r.reference,r.note,r.recorded_by AS "recordedBy",r.recorded_at AS "recordedAt"
    FROM ars_financial_reconciliations r JOIN ars_financial_accounts a ON a.shop_id=r.shop_id AND a.id=r.account_id WHERE r.shop_id=$1 ORDER BY r.recorded_at DESC,r.id DESC LIMIT 500`,[shopId]);
  return result.rows.map(r=>({...r,expectedAmount:Number(r.expectedAmount),observedAmount:Number(r.observedAmount),variance:Number(r.variance)}));
}

/** Read a single account statement, with opening balance and chronological running balance.
 * Use one SQL statement so totals and rows share the same PostgreSQL snapshot. */
export async function listFinancialMovements(db:Pool|PoolClient,input:{shopId:string;accountId:string;fromDate:string;toDate:string;offset:number;limit:number}){
  const {shopId,accountId,fromDate,toDate,offset,limit}=input;
  if(!shopId||!accountId||!validChequeDay(fromDate)||!validChequeDay(toDate)||fromDate>toDate||
    !Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('Invalid financial statement filters.');
  const result=await db.query(`
    WITH account AS (
      SELECT id,name,kind,active FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2
    ), opening AS (
      SELECT COALESCE(SUM(m.amount),0) AS balance FROM ars_financial_movements m JOIN account a ON a.id=m.account_id WHERE m.shop_id=$1 AND m.effective_date<$3::date
    ), period AS (
      SELECT m.id,m.amount,m.movement_kind AS kind,m.source_id AS "sourceId",m.recorded_by AS "recordedBy",m.recorded_at AS "recordedAt",m.effective_date::text AS "effectiveDate",m.note,
        (SELECT balance FROM opening)+SUM(m.amount) OVER(ORDER BY m.effective_date,m.recorded_at,m.id ROWS UNBOUNDED PRECEDING) AS "runningBalance"
      FROM ars_financial_movements m JOIN account a ON a.id=m.account_id WHERE m.shop_id=$1 AND m.effective_date BETWEEN $3::date AND $4::date
    ), totals AS (
      SELECT COUNT(*) AS count,COALESCE(SUM(amount) FILTER(WHERE amount>0),0) AS inflows,COALESCE(-SUM(amount) FILTER(WHERE amount<0),0) AS outflows FROM period
    ), page AS (
      SELECT * FROM period ORDER BY "effectiveDate","recordedAt",id LIMIT $5 OFFSET $6
    )
    SELECT a.*,o.balance AS opening,t.count,t.inflows,t.outflows,o.balance+t.inflows-t.outflows AS closing,
      COALESCE((SELECT jsonb_agg(p ORDER BY p."effectiveDate",p."recordedAt",p.id) FROM page p),'[]'::jsonb) AS rows
    FROM account a CROSS JOIN opening o CROSS JOIN totals t
  `,[shopId,accountId,fromDate,toDate,limit,offset]);
  const r=result.rows[0];
  if(!r)throw Error('Financial account not found in this shop.');
  return {account:{id:r.id,name:r.name,kind:r.kind,active:r.active},fromDate,toDate,offset,limit,total:Number(r.count),opening:Number(r.opening),inflows:Number(r.inflows),outflows:Number(r.outflows),closing:Number(r.closing),rows:r.rows.map((m:any)=>({...m,amount:Number(m.amount),runningBalance:Number(m.runningBalance)}))};
}
