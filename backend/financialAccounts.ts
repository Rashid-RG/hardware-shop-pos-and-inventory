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
