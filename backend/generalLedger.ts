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
 -- Posting must remain disabled unless a shop has an explicitly approved cutover.
 CREATE OR REPLACE FUNCTION ars_gl_require_cutover() RETURNS trigger LANGUAGE plpgsql AS $fn$
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM ars_gl_cutover c
   WHERE c.shop_id=NEW.shop_id AND c.posting_enabled AND NEW.posting_date>=c.cutover_date
   FOR SHARE) THEN
   RAISE EXCEPTION 'General ledger posting is disabled or predates cutover' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END;
 $fn$;
 DROP TRIGGER IF EXISTS ars_gl_cutover_guard ON ars_gl_journals;
 CREATE TRIGGER ars_gl_cutover_guard BEFORE INSERT ON ars_gl_journals
 FOR EACH ROW EXECUTE FUNCTION ars_gl_require_cutover();

 -- Entries are append-only. A correction must use a separate reversing journal.
 CREATE OR REPLACE FUNCTION ars_gl_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $fn$
 BEGIN
  RAISE EXCEPTION 'Posted journal records are immutable' USING ERRCODE='23514';
 END;
 $fn$;
 DROP TRIGGER IF EXISTS ars_gl_journal_immutable ON ars_gl_journals;
 CREATE TRIGGER ars_gl_journal_immutable BEFORE UPDATE OR DELETE ON ars_gl_journals
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 DROP TRIGGER IF EXISTS ars_gl_line_immutable ON ars_gl_lines;
 CREATE TRIGGER ars_gl_line_immutable BEFORE UPDATE OR DELETE ON ars_gl_lines
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();

 -- All lines must be inserted in the same transaction as the journal header.
 -- PostgreSQL transaction identity is checked against the header's xmin.
 CREATE OR REPLACE FUNCTION ars_gl_guard_line() RETURNS trigger LANGUAGE plpgsql AS $fn$
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM ars_gl_journals j
   WHERE j.shop_id=NEW.shop_id AND j.id=NEW.journal_id
    AND j.xmin::text=(pg_current_xact_id()::text::numeric % 4294967296)::text) THEN
   RAISE EXCEPTION 'Lines can only be inserted while creating a journal' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM ars_gl_accounts a WHERE a.shop_id=NEW.shop_id
   AND a.code=NEW.account_code AND a.active FOR SHARE) THEN
   RAISE EXCEPTION 'Active shop ledger account required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END;
 $fn$;
 DROP TRIGGER IF EXISTS ars_gl_line_guard ON ars_gl_lines;
 CREATE TRIGGER ars_gl_line_guard BEFORE INSERT ON ars_gl_lines
 FOR EACH ROW EXECUTE FUNCTION ars_gl_guard_line();

 -- Deferred until COMMIT, so a header and its lines can be written atomically.
 CREATE OR REPLACE FUNCTION ars_gl_check_balance() RETURNS trigger LANGUAGE plpgsql AS $fn$
 DECLARE n bigint; d numeric; c numeric;
 BEGIN
  SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
  INTO n,d,c FROM ars_gl_lines WHERE shop_id=NEW.shop_id AND journal_id=NEW.id;
  IF n<2 OR n>500 OR d<=0 OR d<>c THEN
   RAISE EXCEPTION 'Journal must contain 2 to 500 balanced lines' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
 END;
 $fn$;
 DROP TRIGGER IF EXISTS ars_gl_journal_balanced ON ars_gl_journals;
 CREATE CONSTRAINT TRIGGER ars_gl_journal_balanced AFTER INSERT ON ars_gl_journals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ars_gl_check_balance();

 CREATE TABLE IF NOT EXISTS ars_gl_account_audit(
  revision BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id TEXT NOT NULL,account_code TEXT NOT NULL,actor TEXT NOT NULL,
  previous_value JSONB,new_value JSONB NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(shop_id,account_code) REFERENCES ars_gl_accounts(shop_id,code)
 );
 CREATE OR REPLACE FUNCTION ars_gl_guard_account() RETURNS trigger LANGUAGE plpgsql AS $fn$
 BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Ledger accounts cannot be deleted' USING ERRCODE='23514'; END IF;
  IF NEW.shop_id<>OLD.shop_id OR NEW.code<>OLD.code OR NEW.kind<>OLD.kind THEN
   RAISE EXCEPTION 'Ledger account identity and classification are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END;
 $fn$;
 DROP TRIGGER IF EXISTS ars_gl_account_guard ON ars_gl_accounts;
 CREATE TRIGGER ars_gl_account_guard BEFORE UPDATE OR DELETE ON ars_gl_accounts
 FOR EACH ROW EXECUTE FUNCTION ars_gl_guard_account();
 DROP TRIGGER IF EXISTS ars_gl_account_audit_immutable ON ars_gl_account_audit;
 CREATE TRIGGER ars_gl_account_audit_immutable BEFORE UPDATE OR DELETE ON ars_gl_account_audit
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE INDEX IF NOT EXISTS ars_gl_journal_date ON ars_gl_journals(shop_id,posting_date,id);
 CREATE INDEX IF NOT EXISTS ars_gl_line_account ON ars_gl_lines(shop_id,account_code);
 `);
}
