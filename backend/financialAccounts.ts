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
