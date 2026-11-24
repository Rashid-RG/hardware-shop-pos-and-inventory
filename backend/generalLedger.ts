import type {Pool,PoolClient} from 'pg';

export const ledgerAccountKinds=['Asset','Liability','Equity','Revenue','Expense'] as const;
export type LedgerAccountKind=typeof ledgerAccountKinds[number];
export type JournalLine={accountCode:string;debit:string;credit:string};

export function moneyCents(value:string):bigint{
 if(typeof value!=='string'||!/^\d{1,14}(?:\.\d{1,2})?$/.test(value))throw Error('Use a non-negative decimal amount with at most two decimal places.');
 const [whole,fraction='']=value.split('.');
 return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}

export function validateJournal(lines:JournalLine[]){
 if(!Array.isArray(lines)||lines.length<2||lines.length>500)throw Error('A journal needs between 2 and 500 lines.');
 let debit=0n,credit=0n;
 for(const line of lines){
  if(!line||typeof line.accountCode!=='string'||!/^\d{4,10}$/.test(line.accountCode))throw Error('Invalid ledger account code.');
  const d=moneyCents(line.debit),c=moneyCents(line.credit);
  if((d===0n)===(c===0n))throw Error('Each line must have exactly one positive debit or credit.');
  debit+=d;credit+=c;
 }
 if(debit!==credit)throw Error('Journal debits and credits must balance.');
 return {totalCents:debit.toString()};
}

/** Additive schema only. No opening balances, posting or historical backfill on startup. */
export async function initGeneralLedger(db:Pool|PoolClient){
 await db.query(`
 CREATE TABLE IF NOT EXISTS ars_gl_accounts(
  shop_id TEXT NOT NULL,code TEXT NOT NULL CHECK(code ~ '^[0-9]{4,10}$'),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
  kind TEXT NOT NULL CHECK(kind IN ('Asset','Liability','Equity','Revenue','Expense')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(shop_id,code)
 );
 CREATE TABLE IF NOT EXISTS ars_gl_cutover(
  shop_id TEXT PRIMARY KEY,cutover_date DATE NOT NULL,
  evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  approved_by TEXT NOT NULL,approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posting_enabled BOOLEAN NOT NULL DEFAULT FALSE
 );
 CREATE TABLE IF NOT EXISTS ars_gl_journals(
  shop_id TEXT NOT NULL,id TEXT NOT NULL,posting_date DATE NOT NULL,
  source_kind TEXT NOT NULL,source_id TEXT NOT NULL,
  description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),
  recorded_by TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,id),UNIQUE(shop_id,source_kind,source_id)
 );
 CREATE TABLE IF NOT EXISTS ars_gl_lines(
  shop_id TEXT NOT NULL,journal_id TEXT NOT NULL,line_no INTEGER NOT NULL CHECK(line_no>0),
  account_code TEXT NOT NULL,debit NUMERIC(16,2) NOT NULL CHECK(debit>=0),
  credit NUMERIC(16,2) NOT NULL CHECK(credit>=0),
  CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)),
  PRIMARY KEY(shop_id,journal_id,line_no),
  FOREIGN KEY(shop_id,journal_id) REFERENCES ars_gl_journals(shop_id,id),
  FOREIGN KEY(shop_id,account_code) REFERENCES ars_gl_accounts(shop_id,code)
 );
 CREATE INDEX IF NOT EXISTS ars_gl_journal_date ON ars_gl_journals(shop_id,posting_date,id);
 CREATE INDEX IF NOT EXISTS ars_gl_line_account ON ars_gl_lines(shop_id,account_code);
 `);
}
