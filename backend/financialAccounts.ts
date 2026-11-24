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
