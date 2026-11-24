import { postFinancialJournal } from './financialJournalPosting';
import { initLandedCostTables } from './landedCost';
import { initImportExpenseReconciliation } from './importExpenseReconciliation';
import type { Pool, PoolClient } from 'pg';

export type FinancialAccountKind='Office Cash'|'Bank'|'Representative Cash'|'Settlement';
export async function initFinancialAccounts(db:Pool|PoolClient){
  await initLandedCostTables(db);
  await initImportExpenseReconciliation(db);
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


    -- Replace the original automatically named CHECK without altering existing movements.
    ALTER TABLE ars_financial_movements DROP CONSTRAINT IF EXISTS ars_financial_movements_movement_kind_check;
    ALTER TABLE ars_financial_movements ADD CONSTRAINT ars_financial_movements_movement_kind_check
      CHECK(movement_kind IN ('Opening Balance','Customer Collection','Transfer In','Transfer Out','Supplier Payment','Expense','Adjustment','Invoice Payment','Invoice Refund','Import Creditor Payment'));
    CREATE UNIQUE INDEX IF NOT EXISTS ars_financial_invoice_movement_once ON ars_financial_movements(shop_id,movement_kind,source_id)
      WHERE movement_kind IN ('Invoice Payment','Invoice Refund');
    CREATE TABLE IF NOT EXISTS ars_representative_accounts (
      shop_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      account_id TEXT NOT NULL UNIQUE,
      assigned_by TEXT NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(shop_id,employee_id),
      FOREIGN KEY(shop_id,account_id) REFERENCES ars_financial_accounts(shop_id,id)
    );
    CREATE TABLE IF NOT EXISTS ars_representative_logins (
      shop_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      user_id TEXT NOT NULL UNIQUE,
      linked_by TEXT NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(shop_id,employee_id),
      FOREIGN KEY(shop_id,employee_id) REFERENCES ars_representative_accounts(shop_id,employee_id)
    );
    CREATE TABLE IF NOT EXISTS ars_invoice_cost_corrections (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      item_id BIGINT NOT NULL,
      original_cost NUMERIC(12,2) NOT NULL,
      previous_cost NUMERIC(12,2) NOT NULL,
      corrected_cost NUMERIC(12,2) NOT NULL CHECK(corrected_cost>0),
      evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
      recorded_by TEXT NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revision BIGINT GENERATED ALWAYS AS IDENTITY,
      UNIQUE(shop_id,transaction_id,item_id,revision)
    );
    CREATE INDEX IF NOT EXISTS ars_invoice_cost_correction_lookup ON ars_invoice_cost_corrections(shop_id,transaction_id,item_id,revision DESC);
    CREATE TABLE IF NOT EXISTS ars_cash_handovers (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      from_account_id TEXT NOT NULL,
      to_account_id TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      request_note TEXT,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Confirmed','Rejected')),
      decided_by TEXT,
      decided_at TIMESTAMPTZ,
      decision_note TEXT,
      effective_date DATE,
      FOREIGN KEY(shop_id,from_account_id) REFERENCES ars_financial_accounts(shop_id,id),
      FOREIGN KEY(shop_id,to_account_id) REFERENCES ars_financial_accounts(shop_id,id),
      CHECK(from_account_id<>to_account_id),
      CHECK((status='Pending')=(decided_at IS NULL)),
      CHECK((status='Confirmed')=(effective_date IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS ars_cash_handover_queue ON ars_cash_handovers(shop_id,status,requested_at);
    CREATE TABLE IF NOT EXISTS ars_invoice_requests (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ars_invoice_requests_shop ON ars_invoice_requests(shop_id,id);
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
    const balance=await client.query(`SELECT (SELECT COALESCE(SUM(amount),0) FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2)-(SELECT COALESCE(SUM(amount),0) FROM ars_cash_handovers WHERE shop_id=$1 AND from_account_id=$2 AND status='Pending') >= $3::numeric AS sufficient`,[shopId,fromAccountId,amount]);
    if(!balance.rows[0]?.sufficient)throw Error('Insufficient recorded funds in source account.');
    await client.query(`INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note)
      VALUES($1,$2,$3,-$5::numeric,'Transfer Out',$6,$7,$8,$9),($4,$2,$10,$5::numeric,'Transfer In',$6,$7,$8,$9)`,
      [sourceId+'-out',shopId,fromAccountId,sourceId+'-in',amount,sourceId,recordedBy,effectiveDate,note,toAccountId]);
    await postFinancialJournal(client,shopId,sourceId,'Transfer');
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

export async function recordPaidExpense(db:Pool,input:{id:string;shopId:string;desc:string;category:string;amount:number;date:string;recordedBy:string;role:string;sourceAccountId?:string;paymentMethod?:string}){
  const {id,shopId,desc,category,amount,date,recordedBy,role,sourceAccountId,paymentMethod}=input;
  if(!id||!shopId||!recordedBy||!desc.trim()||desc.length>1000||!category.trim()||category.length>100||!Number.isFinite(amount)||amount<=0||amount>1_000_000_000||Math.abs(amount*100-Math.round(amount*100))>0.00001||!validChequeDay(date)||(sourceAccountId&&!['Cash','Bank Transfer'].includes(paymentMethod||'')))throw Error('Invalid expense details.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    if(sourceAccountId){
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);
      const prior=await client.query("SELECT e.*,e.date::text AS day,m.account_id,m.recorded_by,a.kind FROM manual_expenses e LEFT JOIN ars_financial_movements m ON m.shop_id=e.shop_id AND m.source_id=e.id AND m.movement_kind='Expense' LEFT JOIN ars_financial_accounts a ON a.shop_id=m.shop_id AND a.id=m.account_id WHERE e.id=$1",[id]);
      if(prior.rowCount){
        const p=prior.rows[0];
        if(p.shop_id!==shopId||p.description!==desc||p.category!==category||Number(p.amount)!==amount||p.account_id!==sourceAccountId||p.recorded_by!==recordedBy||!((paymentMethod==='Cash'&&p.kind==='Office Cash')||(paymentMethod==='Bank Transfer'&&p.kind==='Bank')))throw Error('Expense request identifier already used for different details.');
        await client.query('COMMIT');return {id,date:p.day as string,replayed:true};
      }
      const account=await client.query('SELECT kind FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND active=TRUE FOR UPDATE',[shopId,sourceAccountId]);
      const kind=account.rows[0]?.kind;
      if(!((paymentMethod==='Cash'&&kind==='Office Cash')||(paymentMethod==='Bank Transfer'&&kind==='Bank')))throw Error('Select an active expense account matching the payment method.');
      const balance=await client.query('SELECT COALESCE(SUM(amount),0)>=$3::numeric AS sufficient FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2',[shopId,sourceAccountId,amount]);
      if(!balance.rows[0]?.sufficient)throw Error('Insufficient recorded funds for expense.');
      await client.query(`INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note) VALUES($1,$2,$3,-$4::numeric,'Expense',$5,$6,$7,$8)`,['expense-out-'+id,shopId,sourceAccountId,amount,id,recordedBy,date,desc]);
    }
    await client.query('INSERT INTO manual_expenses(id,description,amount,date,category,shop_id) VALUES($1,$2,$3,$4,$5,$6)',[id,desc,amount,date,category,shopId]);
    await client.query(`INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details) VALUES($1,$2,NOW(),$3,$4,'Logged Expense',$5)`,['expense-audit-'+id,shopId,recordedBy,role,'Added manual expense '+desc+' (LKR '+amount.toFixed(2)+').']);
    await postFinancialJournal(client,shopId,id,'Expense');
    await client.query('COMMIT');return {id,date,replayed:false};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Immutable initial assignment. Reassignment requires separate balance reconciliation and authorization. */
export async function assignRepresentativeAccount(db:Pool,input:{shopId:string;employeeId:string;accountId:string;recordedBy:string}){
  const {shopId,employeeId,accountId,recordedBy}=input;
  if(!shopId||!employeeId||!accountId||!recordedBy)throw Error('Invalid representative assignment.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const employee=await client.query("SELECT id,name FROM employees WHERE shop_id=$1 AND id=$2 AND role='Cashier' FOR UPDATE",[shopId,employeeId]);
    if(!employee.rowCount)throw Error('Select a registered sales representative in this shop.');
    const account=await client.query("SELECT id,name FROM ars_financial_accounts WHERE shop_id=$1 AND id=$2 AND kind='Representative Cash' AND active=TRUE FOR UPDATE",[shopId,accountId]);
    if(!account.rowCount)throw Error('Select an active representative cash account in this shop.');
    const existing=await client.query('SELECT employee_id,account_id FROM ars_representative_accounts WHERE shop_id=$1 AND (employee_id=$2 OR account_id=$3)',[shopId,employeeId,accountId]);
    if(existing.rowCount){
      if(existing.rowCount===1&&existing.rows[0].employee_id===employeeId&&existing.rows[0].account_id===accountId){await client.query('COMMIT');return {replayed:true};}
      throw Error('Representative or cash account already assigned. Reconcile before reassignment.');
    }
    const history=await client.query('SELECT 1 FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2 LIMIT 1',[shopId,accountId]);
    if(history.rowCount)throw Error('Assign a new cash account with no recorded movements; historical balances require reconciliation.');
    await client.query('INSERT INTO ars_representative_accounts(shop_id,employee_id,account_id,assigned_by) VALUES($1,$2,$3,$4)',[shopId,employeeId,accountId,recordedBy]);
    await client.query(`INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details) VALUES($1,$2,NOW(),$3,'Store Manager','Representative Account Assigned',$4)`,['rep-account-'+accountId,shopId,recordedBy,employee.rows[0].name+' — '+account.rows[0].name]);
    await client.query('COMMIT');return {replayed:false};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function listRepresentativeAccounts(db:Pool|PoolClient,shopId:string){
  const result=await db.query(`SELECT r.employee_id,r.account_id,r.assigned_by,r.assigned_at,e.name AS employee_name,e.role AS employee_role,a.name AS account_name,a.active,COALESCE(SUM(m.amount),0) AS balance
    FROM ars_representative_accounts r JOIN ars_financial_accounts a ON a.shop_id=r.shop_id AND a.id=r.account_id
    LEFT JOIN employees e ON e.shop_id=r.shop_id AND e.id=r.employee_id
    LEFT JOIN ars_financial_movements m ON m.shop_id=r.shop_id AND m.account_id=r.account_id
    WHERE r.shop_id=$1 GROUP BY r.employee_id,r.account_id,r.assigned_by,r.assigned_at,e.name,e.role,a.name,a.active ORDER BY e.name,r.employee_id`,[shopId]);
  return result.rows.map(r=>({employeeId:r.employee_id,accountId:r.account_id,employeeName:r.employee_name,employeeRole:r.employee_role,accountName:r.account_name,active:r.active,balance:Number(r.balance),assignedBy:r.assigned_by,assignedAt:r.assigned_at}));
}

/** Explicit administrator-approved link. Never infer financial identity from names or email similarity. */
export async function linkRepresentativeLogin(db:Pool,input:{shopId:string;employeeId:string;userId:string;recordedBy:string}){
  const {shopId,employeeId,userId,recordedBy}=input;
  if(!shopId||!employeeId||!userId||!recordedBy)throw Error('Invalid representative login link.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const user=await client.query("SELECT id,name FROM users WHERE id=$1 AND role='Cashier' FOR UPDATE",[userId]);
    if(!user.rowCount)throw Error('Select an existing sales representative login.');
    const employee=await client.query("SELECT id,name FROM employees WHERE shop_id=$1 AND id=$2 AND role='Cashier' FOR UPDATE",[shopId,employeeId]);
    if(!employee.rowCount)throw Error('Select an active representative staff record.');
    const assigned=await client.query("SELECT r.account_id FROM ars_representative_accounts r JOIN ars_financial_accounts a ON a.id=r.account_id AND a.shop_id=r.shop_id WHERE r.shop_id=$1 AND r.employee_id=$2 AND a.active AND a.kind='Representative Cash' FOR UPDATE OF a",[shopId,employeeId]);
    if(!assigned.rowCount)throw Error('Assign an active representative cash account first.');
    const existing=await client.query('SELECT shop_id,employee_id,user_id FROM ars_representative_logins WHERE user_id=$1 OR (shop_id=$2 AND employee_id=$3)',[userId,shopId,employeeId]);
    if(existing.rowCount){
      const row=existing.rows[0];
      if(existing.rowCount===1&&row.shop_id===shopId&&row.employee_id===employeeId&&row.user_id===userId){await client.query('COMMIT');return {replayed:true};}
      throw Error('Login or employee already linked. Administrative reconciliation required.');
    }
    await client.query('INSERT INTO ars_representative_logins(shop_id,employee_id,user_id,linked_by) VALUES($1,$2,$3,$4)',[shopId,employeeId,userId,recordedBy]);
    await client.query(`INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details) VALUES($1,$2,NOW(),$3,'Super Admin','Representative Login Linked',$4)`,['rep-login-'+userId,shopId,recordedBy,employee.rows[0].name+' — '+userId]);
    await client.query('COMMIT');return {replayed:false};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function resolveRepresentativeFinancialIdentity(db:Pool|PoolClient,shopId:string,userId:string){
  const result=await db.query(`SELECT l.employee_id,r.account_id,a.name AS account_name,e.name AS employee_name
    FROM ars_representative_logins l JOIN users u ON u.id=l.user_id AND u.role='Cashier'
    JOIN employees e ON e.id=l.employee_id AND e.shop_id=l.shop_id AND e.role='Cashier'
    JOIN ars_representative_accounts r ON r.shop_id=l.shop_id AND r.employee_id=l.employee_id
    JOIN ars_financial_accounts a ON a.id=r.account_id AND a.shop_id=r.shop_id AND a.active AND a.kind='Representative Cash'
    WHERE l.shop_id=$1 AND l.user_id=$2`,[shopId,userId]);
  const row=result.rows[0];
  return row?{employeeId:row.employee_id,accountId:row.account_id,accountName:row.account_name,employeeName:row.employee_name}:null;
}

export async function requestCashHandover(db:Pool,input:{id:string;shopId:string;userId:string;toAccountId:string;amount:number;note?:string}){
 const {id,shopId,userId,toAccountId,amount}=input,note=input.note?.trim()||null;
 if(!id||!shopId||!userId||!toAccountId||!Number.isFinite(amount)||amount<=0||amount>999999999999.99||Math.abs(amount*100-Math.round(amount*100))>0.001||(note&&note.length>500))throw Error('Invalid cash handover request.');
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['handover-'+id]);
  const identity=await resolveRepresentativeFinancialIdentity(client,shopId,userId);
  if(!identity)throw Error('Representative cash account authorization required.');
  const prior=await client.query('SELECT * FROM ars_cash_handovers WHERE id=$1',[id]);
  if(prior.rowCount){
    const p=prior.rows[0];
    if(p.shop_id!==shopId||p.user_id!==userId||p.employee_id!==identity.employeeId||p.from_account_id!==identity.accountId||p.to_account_id!==toAccountId||Number(p.amount)!==amount||(p.request_note||null)!==note)throw Error('Handover request identifier already used for different details.');
    await client.query('COMMIT');return {id,status:p.status,replayed:true};
  }
  const accounts=await client.query('SELECT id,kind FROM ars_financial_accounts WHERE shop_id=$1 AND id=ANY($2::text[]) AND active ORDER BY id FOR UPDATE',[shopId,[identity.accountId,toAccountId]]);
  if(accounts.rows.find(r=>r.id===identity.accountId)?.kind!=='Representative Cash'||accounts.rows.find(r=>r.id===toAccountId)?.kind!=='Office Cash')throw Error('Select an active office cash account in this shop.');
  const available=await client.query(`SELECT (SELECT COALESCE(SUM(amount),0) FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2)-(SELECT COALESCE(SUM(amount),0) FROM ars_cash_handovers WHERE shop_id=$1 AND from_account_id=$2 AND status='Pending') >= $3::numeric AS sufficient`,[shopId,identity.accountId,amount]);
  if(!available.rows[0]?.sufficient)throw Error('Handover exceeds cash balance after pending requests.');
  await client.query('INSERT INTO ars_cash_handovers(id,shop_id,employee_id,user_id,from_account_id,to_account_id,amount,request_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,shopId,identity.employeeId,userId,identity.accountId,toAccountId,amount,note]);
  await client.query('COMMIT');return {id,status:'Pending',replayed:false};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function decideCashHandover(db:Pool,input:{id:string;shopId:string;decision:'Confirmed'|'Rejected';recordedBy:string;managerUserId:string;effectiveDate:string;note?:string}){
 const {id,shopId,decision,recordedBy,managerUserId,effectiveDate}=input,note=input.note?.trim()||null;
 if(!id||!shopId||!recordedBy||!managerUserId||!['Confirmed','Rejected'].includes(decision)||!validChequeDay(effectiveDate)||(decision==='Rejected'&&!note)||(note&&note.length>500))throw Error('Invalid handover decision.');
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const manager=await client.query("SELECT id FROM users WHERE id=$1 AND role IN ('Super Admin','Store Manager')",[managerUserId]);
  if(!manager.rowCount)throw Error('Manager authorization required.');
  const result=await client.query('SELECT * FROM ars_cash_handovers WHERE shop_id=$1 AND id=$2 FOR UPDATE',[shopId,id]);
  const h=result.rows[0];if(!h)throw Error('Handover not found in this shop.');
  if(h.user_id===managerUserId)throw Error('A representative cannot approve their own handover.');
  if(h.status!=='Pending'){
    if(h.status===decision&&h.decided_by===recordedBy&&(h.decision_note||null)===note){await client.query('COMMIT');return {id,status:h.status,replayed:true};}
    throw Error('Handover already decided.');
  }
  if(decision==='Confirmed'){
    const accounts=await client.query('SELECT id,kind FROM ars_financial_accounts WHERE shop_id=$1 AND id=ANY($2::text[]) AND active ORDER BY id FOR UPDATE',[shopId,[h.from_account_id,h.to_account_id]]);
    if(accounts.rows.find(r=>r.id===h.from_account_id)?.kind!=='Representative Cash'||accounts.rows.find(r=>r.id===h.to_account_id)?.kind!=='Office Cash')throw Error('Handover accounts are unavailable.');
    const balance=await client.query('SELECT COALESCE(SUM(amount),0)>=$3::numeric AS sufficient FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2',[shopId,h.from_account_id,h.amount]);
    if(!balance.rows[0]?.sufficient)throw Error('Insufficient recorded funds to confirm handover.');
    const source='handover-'+id;
    await client.query(`INSERT INTO ars_financial_movements(id,shop_id,account_id,amount,movement_kind,source_id,recorded_by,effective_date,note)
     VALUES($1,$2,$3,-$5::numeric,'Transfer Out',$6,$7,$8,$9),($4,$2,$10,$5::numeric,'Transfer In',$6,$7,$8,$9)`,[source+'-out',shopId,h.from_account_id,source+'-in',h.amount,source,recordedBy,effectiveDate,'Confirmed representative handover',h.to_account_id]);
  }
  await client.query('UPDATE ars_cash_handovers SET status=$3,decided_by=$4,decided_at=NOW(),decision_note=$5,effective_date=$6 WHERE shop_id=$1 AND id=$2',[shopId,id,decision,recordedBy,note,decision==='Confirmed'?effectiveDate:null]);
  await client.query(`INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details) VALUES($1,$2,NOW(),$3,'Store Manager',$4,$5)`,['handover-decision-'+id,shopId,recordedBy,'Cash Handover '+decision,id+' / '+h.amount]);
  if(decision==='Confirmed')await postFinancialJournal(client,shopId,'handover-'+id,'Transfer');
  await client.query('COMMIT');return {id,status:decision,replayed:false};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Recorded cash and bank movement summary; not an accrual income statement.
 * Opening balances and transfers involving noncash settlement accounts are disclosed separately.
 */
export async function financialCashFlow(db:Pool|PoolClient,shopId:string,fromDate:string,toDate:string){
 if(!shopId||!validChequeDay(fromDate)||!validChequeDay(toDate)||fromDate>toDate)throw Error('Invalid cash flow period.');
 const result=await db.query(`WITH cash AS (
 SELECT m.* FROM ars_financial_movements m JOIN ars_financial_accounts a ON a.shop_id=m.shop_id AND a.id=m.account_id
 WHERE m.shop_id=$1 AND a.kind IN ('Office Cash','Bank','Representative Cash') AND m.effective_date<=$3::date
 ), period AS (SELECT * FROM cash WHERE effective_date >= $2::date),
 groups AS (SELECT movement_kind AS kind, SUM(CASE WHEN amount>0 THEN amount ELSE 0 END) AS inflow,
 SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END) AS outflow,COUNT(*) AS count FROM period GROUP BY movement_kind)
 SELECT (SELECT COALESCE(SUM(amount),0) FROM cash WHERE effective_date<$2::date) AS opening,
 (SELECT COALESCE(SUM(amount),0) FROM cash) AS closing,
 (SELECT COALESCE(json_agg(groups ORDER BY kind),'[]'::json) FROM groups) AS groups`,[shopId,fromDate,toDate]);
 const row=result.rows[0];
 const groups=row.groups.map((g:any)=>({kind:g.kind,inflow:Number(g.inflow),outflow:Number(g.outflow),count:Number(g.count)}));
 const net=(kinds:string[])=>groups.filter((g:any)=>kinds.includes(g.kind)).reduce((s:number,g:any)=>s+g.inflow-g.outflow,0);
 return {fromDate,toDate,opening:Number(row.opening),closing:Number(row.closing),groups,operating:net(['Invoice Payment','Invoice Refund','Customer Collection','Supplier Payment','Expense']),openingRegistrations:net(['Opening Balance']),netTransfers:net(['Transfer In','Transfer Out']),adjustments:net(['Adjustment'])};
}

/** Historical invoice economics, with refunds recognized on the recorded refund day.
 * Missing or ambiguous zero-cost snapshots prevent publication of a profit figure.
 */
export async function financialProfitReport(db:Pool|PoolClient,shopId:string,fromDate:string,toDate:string){
 if(!shopId||!validChequeDay(fromDate)||!validChequeDay(toDate)||fromDate>toDate)throw Error('Invalid profit report period.');
 const result=await db.query(`WITH events AS (
 SELECT t.id,1 AS sign,(t.total-t.tax) AS revenue FROM sales_transactions t
 WHERE t.shop_id=$1 AND t.status IN ('Completed','Refunded') AND (t.date AT TIME ZONE 'Asia/Colombo')::date BETWEEN $2::date AND $3::date
 UNION ALL
 SELECT t.id,-1 AS sign,(t.total-t.tax) AS revenue FROM sales_transactions t
 WHERE t.shop_id=$1 AND t.status='Refunded' AND (t.refunded_at AT TIME ZONE 'Asia/Colombo')::date BETWEEN $2::date AND $3::date
 ), costs AS (
 SELECT e.id,e.sign,e.revenue,COALESCE(SUM(COALESCE(c.corrected_cost,i.cost_price)*i.quantity),0) AS cost,
 COUNT(*) FILTER(WHERE i.id IS NULL OR COALESCE(c.corrected_cost,i.cost_price) IS NULL OR COALESCE(c.corrected_cost,i.cost_price)<=0 OR i.quantity<=0) AS missing
 FROM events e LEFT JOIN sales_transaction_items i ON i.transaction_id=e.id
 LEFT JOIN LATERAL (SELECT corrected_cost FROM ars_invoice_cost_corrections WHERE shop_id=$1 AND transaction_id=e.id AND item_id=i.id AND original_cost=i.cost_price ORDER BY revision DESC LIMIT 1) c ON TRUE
 GROUP BY e.id,e.sign,e.revenue
 ), expense AS (
 SELECT COALESCE(SUM(e.amount-COALESCE(l.amount,0)),0) AS amount,COALESCE(SUM(l.amount),0) AS capitalized
 FROM manual_expenses e LEFT JOIN ars_import_expense_links l ON l.shop_id=e.shop_id AND l.expense_id=e.id AND l.amount=e.amount
 AND l.expense_snapshot->>'day'=e.date::date::text
 AND l.expense_snapshot->>'description'=e.description AND l.expense_snapshot->>'category'=e.category
 AND EXISTS(SELECT 1 FROM ars_financial_movements m WHERE m.shop_id=e.shop_id AND m.id=l.expense_snapshot->'movement'->>'id' AND m.source_id=e.id AND m.movement_kind='Expense' AND m.amount=-e.amount AND m.effective_date=e.date::date)
 WHERE e.shop_id=$1 AND e.date::date BETWEEN $2::date AND $3::date
 )
 SELECT COALESCE(SUM(revenue) FILTER(WHERE sign=1),0) AS sales,
 COALESCE(SUM(revenue) FILTER(WHERE sign=-1),0) AS refunds,
 COALESCE(SUM(sign*cost),0) AS cost,
 COALESCE(SUM(missing),0) AS missing,
 COUNT(*) FILTER(WHERE missing>0) AS affected,
 (SELECT amount FROM expense) AS expenses,
 (SELECT capitalized FROM expense) AS capitalized_import_expenses,
 (SELECT COUNT(*) FROM sales_transactions WHERE shop_id=$1 AND status='Refunded' AND refunded_at IS NULL AND (date AT TIME ZONE 'Asia/Colombo')::date <= $3::date) AS undated_refunds
 FROM costs`,[shopId,fromDate,toDate]);
 const r=result.rows[0],sales=Number(r.sales),refunds=Number(r.refunds),knownCost=Number(r.cost),expenses=Number(r.expenses),missing=Number(r.missing),affected=Number(r.affected),undatedRefunds=Number(r.undated_refunds);
 const round=(n:number)=>Math.round(n*100)/100;
 const netSales=round(sales-refunds),complete=missing===0&&undatedRefunds===0;
 return {fromDate,toDate,sales,refunds,netSales,knownCost,expenses,capitalizedImportExpenses:Number(r.capitalized_import_expenses),missing,affected,undatedRefunds,complete,grossProfit:complete?round(netSales-knownCost):null,operatingEstimate:complete?round(netSales-knownCost-expenses):null};
}

/** Append-only historical costing correction; never modifies invoice or inventory records. */
export async function correctHistoricalInvoiceCost(db:Pool,input:{id:string;shopId:string;transactionId:string;itemId:string;expectedCost:number;correctedCost:number;evidence:string;reason:string;recordedBy:string}){
 const {id,shopId,transactionId,itemId,expectedCost,correctedCost,recordedBy}=input;
 const reason=input.reason.trim(),evidence=input.evidence.trim();
 const validMoney=(n:number)=>Number.isFinite(n)&&n>=0&&n<=9999999999.99&&Math.abs(n*100-Math.round(n*100))<0.001;
 if(!id||!shopId||!transactionId||!/^\d{1,18}$/.test(itemId)||!recordedBy||!validMoney(expectedCost)||!validMoney(correctedCost)||correctedCost<=0||!reason||reason.length>500||!evidence||evidence.length>500)throw Error('Invalid historical cost correction.');
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['invoice-cost-'+id]);
  const prior=await client.query('SELECT * FROM ars_invoice_cost_corrections WHERE id=$1',[id]);
  if(prior.rowCount){const p=prior.rows[0];if(p.shop_id!==shopId||p.transaction_id!==transactionId||String(p.item_id)!==itemId||Number(p.previous_cost)!==expectedCost||Number(p.corrected_cost)!==correctedCost||p.evidence!==evidence||p.reason!==reason||p.recorded_by!==recordedBy)throw Error('Correction request identifier already used for different details.');await client.query('COMMIT');return {id,replayed:true};}
  const line=await client.query("SELECT i.cost_price,i.quantity FROM sales_transaction_items i JOIN sales_transactions t ON t.id=i.transaction_id WHERE t.shop_id=$1 AND t.id=$2 AND i.id=$3::bigint AND t.status IN ('Completed','Refunded') FOR UPDATE OF i",[shopId,transactionId,itemId]);
  if(!line.rowCount||Number(line.rows[0].quantity)<=0)throw Error('Invoice item not found in this shop.');
  const original=Number(line.rows[0].cost_price);
  const latest=await client.query('SELECT corrected_cost FROM ars_invoice_cost_corrections WHERE shop_id=$1 AND transaction_id=$2 AND item_id=$3::bigint AND original_cost=$4 ORDER BY revision DESC LIMIT 1',[shopId,transactionId,itemId,original]);
  const current=latest.rowCount?Number(latest.rows[0].corrected_cost):original;
  if(current!==expectedCost)throw Error('Historical cost changed. Refresh before correcting.');
  if(current===correctedCost)throw Error('Corrected cost must differ from the current cost.');
  await client.query('INSERT INTO ars_invoice_cost_corrections(id,shop_id,transaction_id,item_id,original_cost,previous_cost,corrected_cost,evidence,reason,recorded_by) VALUES($1,$2,$3,$4::bigint,$5,$6,$7,$8,$9,$10)',[id,shopId,transactionId,itemId,original,current,correctedCost,evidence,reason,recordedBy]);
  await client.query("INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details) VALUES($1,$2,NOW(),$3,'Super Admin','Historical Invoice Cost Corrected',$4)",['cost-correction-'+id,shopId,recordedBy,transactionId+' / item '+itemId+' / '+current+' -> '+correctedCost+' / '+reason]);
  await client.query('COMMIT');return {id,replayed:false};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
