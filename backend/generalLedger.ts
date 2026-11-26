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
 CREATE TABLE IF NOT EXISTS ars_gl_opening_proposals(
  shop_id TEXT NOT NULL,id TEXT NOT NULL,cutover_date DATE NOT NULL,
  evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  lines JSONB NOT NULL CHECK(jsonb_typeof(lines)='array'),
  total_cents NUMERIC(20,0) NOT NULL CHECK(total_cents>0),
  submitted_by TEXT NOT NULL,submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_opening_proposal_immutable ON ars_gl_opening_proposals;
 CREATE TRIGGER ars_gl_opening_proposal_immutable BEFORE UPDATE OR DELETE ON ars_gl_opening_proposals
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE TABLE IF NOT EXISTS ars_gl_opening_reviews(
  shop_id TEXT NOT NULL,proposal_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('Approved','Rejected')),
  evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  reviewed_by TEXT NOT NULL,reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,proposal_id),
  FOREIGN KEY(shop_id,proposal_id) REFERENCES ars_gl_opening_proposals(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_opening_review_immutable ON ars_gl_opening_reviews;
 CREATE TRIGGER ars_gl_opening_review_immutable BEFORE UPDATE OR DELETE ON ars_gl_opening_reviews
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE TABLE IF NOT EXISTS ars_gl_account_mappings(
  shop_id TEXT NOT NULL,mapping_kind TEXT NOT NULL,source_id TEXT NOT NULL,
  account_code TEXT NOT NULL,evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  recorded_by TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,mapping_kind,source_id),
  FOREIGN KEY(shop_id,account_code) REFERENCES ars_gl_accounts(shop_id,code)
 );
 DROP TRIGGER IF EXISTS ars_gl_mapping_immutable ON ars_gl_account_mappings;
 CREATE TRIGGER ars_gl_mapping_immutable BEFORE UPDATE OR DELETE ON ars_gl_account_mappings
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 -- Documentary review only: does not create a cash movement or journal.
 CREATE TABLE IF NOT EXISTS ars_gl_partner_capital_reviews(
  shop_id TEXT NOT NULL,entry_id TEXT NOT NULL,request_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('Included in opening balances','Discrepancy identified')),
  entry_snapshot JSONB NOT NULL CHECK(jsonb_typeof(entry_snapshot)='object'),
  evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  opening_journal_id TEXT,
  reviewed_by TEXT NOT NULL,reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,request_id),
  FOREIGN KEY(shop_id,opening_journal_id) REFERENCES ars_gl_journals(shop_id,id),
  CHECK((decision='Included in opening balances')=(opening_journal_id IS NOT NULL))
 );
 CREATE INDEX IF NOT EXISTS ars_gl_partner_capital_review_entry ON ars_gl_partner_capital_reviews(shop_id,entry_id,reviewed_at);
 DROP TRIGGER IF EXISTS ars_gl_partner_capital_review_immutable ON ars_gl_partner_capital_reviews;
 CREATE TRIGGER ars_gl_partner_capital_review_immutable BEFORE UPDATE OR DELETE ON ars_gl_partner_capital_reviews
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 -- Payroll accruals are immutable monthly employee obligations, not cash payments.
 CREATE TABLE IF NOT EXISTS ars_gl_payroll_accruals(
  shop_id TEXT NOT NULL,id TEXT NOT NULL,employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,period_key TEXT NOT NULL CHECK(period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  base_salary NUMERIC(16,2) NOT NULL CHECK(base_salary>=0),
  gross_amount NUMERIC(16,2) NOT NULL CHECK(gross_amount>0),
  posting_date DATE NOT NULL,evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  journal_id TEXT NOT NULL,recorded_by TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,id),UNIQUE(shop_id,employee_id,period_key),
  FOREIGN KEY(shop_id,journal_id) REFERENCES ars_gl_journals(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_payroll_accrual_immutable ON ars_gl_payroll_accruals;
 CREATE TRIGGER ars_gl_payroll_accrual_immutable BEFORE UPDATE OR DELETE ON ars_gl_payroll_accruals
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE INDEX IF NOT EXISTS ars_gl_payroll_period ON ars_gl_payroll_accruals(shop_id,period_key,employee_id);
 -- Payroll proposals and decisions are evidence records; neither creates a journal.
 CREATE TABLE IF NOT EXISTS ars_gl_payroll_proposals(
  shop_id TEXT NOT NULL,id TEXT NOT NULL,employee_id TEXT NOT NULL,employee_name TEXT NOT NULL,
  period_key TEXT NOT NULL CHECK(period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  base_salary NUMERIC(16,2) NOT NULL CHECK(base_salary>0),posting_date DATE NOT NULL,
  evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  submitted_by TEXT NOT NULL,submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,id),CHECK(to_char(posting_date,'YYYY-MM')=period_key)
 );
 CREATE TABLE IF NOT EXISTS ars_gl_payroll_reviews(
  shop_id TEXT NOT NULL,proposal_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('Approved','Rejected')),
  evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  reviewed_by TEXT NOT NULL,reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,proposal_id),
  FOREIGN KEY(shop_id,proposal_id) REFERENCES ars_gl_payroll_proposals(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_payroll_proposal_immutable ON ars_gl_payroll_proposals;
 CREATE TRIGGER ars_gl_payroll_proposal_immutable BEFORE UPDATE OR DELETE ON ars_gl_payroll_proposals
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 DROP TRIGGER IF EXISTS ars_gl_payroll_review_immutable ON ars_gl_payroll_reviews;
 CREATE TRIGGER ars_gl_payroll_review_immutable BEFORE UPDATE OR DELETE ON ars_gl_payroll_reviews
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE INDEX IF NOT EXISTS ars_gl_payroll_proposal_period ON ars_gl_payroll_proposals(shop_id,employee_id,period_key);
 CREATE TABLE IF NOT EXISTS ars_gl_period_closures(
  shop_id TEXT NOT NULL,through_date DATE NOT NULL,
  evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  closed_by TEXT NOT NULL,closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,through_date)
 );
 DROP TRIGGER IF EXISTS ars_gl_period_immutable ON ars_gl_period_closures;
 CREATE TRIGGER ars_gl_period_immutable BEFORE UPDATE OR DELETE ON ars_gl_period_closures
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE OR REPLACE FUNCTION ars_gl_require_open_period() RETURNS trigger LANGUAGE plpgsql AS $fn$
 BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ars-gl-period:'||NEW.shop_id,0));
  IF EXISTS(SELECT 1 FROM ars_gl_period_closures WHERE shop_id=NEW.shop_id AND through_date>=NEW.posting_date) THEN
   RAISE EXCEPTION 'Accounting period is closed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END;
 $fn$;
 DROP TRIGGER IF EXISTS ars_gl_period_guard ON ars_gl_journals;
 CREATE TRIGGER ars_gl_period_guard BEFORE INSERT ON ars_gl_journals
 FOR EACH ROW EXECUTE FUNCTION ars_gl_require_open_period();
 CREATE TABLE IF NOT EXISTS ars_gl_documentary_reviews(
  shop_id TEXT NOT NULL,proposal_id TEXT NOT NULL,id TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL CHECK(snapshot_hash ~ '^[0-9a-f]{64}$'),
  snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  evidence JSONB NOT NULL CHECK(jsonb_typeof(evidence)='array'),
  recorded_by TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,proposal_id,id),
  FOREIGN KEY(shop_id,proposal_id) REFERENCES ars_gl_opening_proposals(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_documentary_review_immutable ON ars_gl_documentary_reviews;
 CREATE TRIGGER ars_gl_documentary_review_immutable BEFORE UPDATE OR DELETE ON ars_gl_documentary_reviews
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE TABLE IF NOT EXISTS ars_gl_import_obligations(
  shop_id TEXT NOT NULL,id TEXT NOT NULL,approval_id TEXT NOT NULL,
  charge_kind TEXT NOT NULL CHECK(charge_kind IN ('Freight','Customs','Clearance')),
  creditor_name TEXT NOT NULL CHECK(length(trim(creditor_name)) BETWEEN 1 AND 200),
  document_reference TEXT NOT NULL CHECK(length(trim(document_reference)) BETWEEN 1 AND 200),
  amount NUMERIC(16,2) NOT NULL CHECK(amount>0),
  due_date DATE NOT NULL,evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  submitted_by TEXT NOT NULL,submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,id),UNIQUE(shop_id,approval_id,charge_kind,creditor_name,document_reference)
 );
 DROP TRIGGER IF EXISTS ars_gl_import_obligation_immutable ON ars_gl_import_obligations;
 CREATE TRIGGER ars_gl_import_obligation_immutable BEFORE UPDATE OR DELETE ON ars_gl_import_obligations
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE TABLE IF NOT EXISTS ars_gl_import_obligation_reviews(
  shop_id TEXT NOT NULL,obligation_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('Approved','Rejected')),
  evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
  reviewed_by TEXT NOT NULL,reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shop_id,obligation_id),
  FOREIGN KEY(shop_id,obligation_id) REFERENCES ars_gl_import_obligations(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_import_review_immutable ON ars_gl_import_obligation_reviews;
 CREATE TRIGGER ars_gl_import_review_immutable BEFORE UPDATE OR DELETE ON ars_gl_import_obligation_reviews
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE TABLE IF NOT EXISTS ars_gl_import_receipt_allocations(
 shop_id TEXT NOT NULL,obligation_id TEXT NOT NULL,batch_id TEXT NOT NULL,
 journal_id TEXT NOT NULL,amount NUMERIC(16,2) NOT NULL CHECK(amount>0),
 PRIMARY KEY(shop_id,obligation_id,batch_id),
 FOREIGN KEY(shop_id,obligation_id) REFERENCES ars_gl_import_obligations(shop_id,id),
 FOREIGN KEY(shop_id,journal_id) REFERENCES ars_gl_journals(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_import_receipt_allocation_immutable ON ars_gl_import_receipt_allocations;
 CREATE TRIGGER ars_gl_import_receipt_allocation_immutable BEFORE UPDATE OR DELETE ON ars_gl_import_receipt_allocations
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE TABLE IF NOT EXISTS ars_gl_import_settlements(
 shop_id TEXT NOT NULL,id TEXT NOT NULL,obligation_id TEXT NOT NULL,account_id TEXT NOT NULL,
 amount NUMERIC(16,2) NOT NULL CHECK(amount>0),payment_date DATE NOT NULL,
 evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
 recorded_by TEXT NOT NULL,journal_id TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(shop_id,id),UNIQUE(shop_id,journal_id),
 FOREIGN KEY(shop_id,obligation_id) REFERENCES ars_gl_import_obligations(shop_id,id),
 FOREIGN KEY(shop_id,journal_id) REFERENCES ars_gl_journals(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_import_settlement_immutable ON ars_gl_import_settlements;
 CREATE TRIGGER ars_gl_import_settlement_immutable BEFORE UPDATE OR DELETE ON ars_gl_import_settlements
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE INDEX IF NOT EXISTS ars_gl_import_settlement_obligation ON ars_gl_import_settlements(shop_id,obligation_id);
 CREATE INDEX IF NOT EXISTS ars_gl_import_obligation_approval ON ars_gl_import_obligations(shop_id,approval_id,charge_kind);
 CREATE TABLE IF NOT EXISTS ars_gl_sales_returns(
 shop_id TEXT NOT NULL,id TEXT NOT NULL,invoice_id TEXT NOT NULL,customer_id TEXT NOT NULL,
 return_date DATE NOT NULL,reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
 recorded_by TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 original_journal_id TEXT NOT NULL,journal_id TEXT NOT NULL,
 net_revenue NUMERIC(16,2) NOT NULL CHECK(net_revenue>=0),
 tax NUMERIC(16,2) NOT NULL CHECK(tax>=0),
 inventory_cost NUMERIC(16,2) NOT NULL CHECK(inventory_cost>=0),
 receivable_reduction NUMERIC(16,2) NOT NULL CHECK(receivable_reduction>=0),
 customer_credit NUMERIC(16,2) NOT NULL CHECK(customer_credit>=0),
 PRIMARY KEY(shop_id,id),UNIQUE(shop_id,journal_id),
 FOREIGN KEY(shop_id,original_journal_id) REFERENCES ars_gl_journals(shop_id,id),
 FOREIGN KEY(shop_id,journal_id) REFERENCES ars_gl_journals(shop_id,id),
 CHECK(net_revenue+tax=receivable_reduction+customer_credit),
 CHECK(net_revenue+tax+inventory_cost>0)
 );
 CREATE TABLE IF NOT EXISTS ars_gl_sales_return_lines(
 shop_id TEXT NOT NULL,return_id TEXT NOT NULL,invoice_line_index INTEGER NOT NULL CHECK(invoice_line_index>=0),
 product_id TEXT NOT NULL,variant_id TEXT,selling_unit_id TEXT,selling_unit_label TEXT,
 sold_quantity BIGINT NOT NULL CHECK(sold_quantity>0),
 units_per_sale_unit BIGINT NOT NULL CHECK(units_per_sale_unit>0),
 returned_base_quantity BIGINT NOT NULL CHECK(returned_base_quantity>0),
 net_revenue NUMERIC(16,2) NOT NULL CHECK(net_revenue>=0),
 tax NUMERIC(16,2) NOT NULL CHECK(tax>=0),
 inventory_cost NUMERIC(16,2) NOT NULL CHECK(inventory_cost>=0),
 PRIMARY KEY(shop_id,return_id,invoice_line_index),
 FOREIGN KEY(shop_id,return_id) REFERENCES ars_gl_sales_returns(shop_id,id),
 CHECK(returned_base_quantity::numeric<=sold_quantity::numeric*units_per_sale_unit)
 );
 DROP TRIGGER IF EXISTS ars_gl_sales_return_immutable ON ars_gl_sales_returns;
 CREATE TRIGGER ars_gl_sales_return_immutable BEFORE UPDATE OR DELETE ON ars_gl_sales_returns
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 DROP TRIGGER IF EXISTS ars_gl_sales_return_line_immutable ON ars_gl_sales_return_lines;
 CREATE TRIGGER ars_gl_sales_return_line_immutable BEFORE UPDATE OR DELETE ON ars_gl_sales_return_lines
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE INDEX IF NOT EXISTS ars_gl_sales_return_invoice ON ars_gl_sales_returns(shop_id,invoice_id);
 CREATE INDEX IF NOT EXISTS ars_gl_sales_return_customer ON ars_gl_sales_returns(shop_id,customer_id);
 CREATE TABLE IF NOT EXISTS ars_gl_sales_return_refunds(
 shop_id TEXT NOT NULL,id TEXT NOT NULL,return_id TEXT NOT NULL,
 account_id TEXT NOT NULL,amount NUMERIC(16,2) NOT NULL CHECK(amount>0),
 refund_date DATE NOT NULL,evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
 recorded_by TEXT NOT NULL,journal_id TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(shop_id,id),UNIQUE(shop_id,journal_id),
 FOREIGN KEY(shop_id,return_id) REFERENCES ars_gl_sales_returns(shop_id,id),
 FOREIGN KEY(shop_id,journal_id) REFERENCES ars_gl_journals(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_sales_return_refund_immutable ON ars_gl_sales_return_refunds;
 CREATE TRIGGER ars_gl_sales_return_refund_immutable BEFORE UPDATE OR DELETE ON ars_gl_sales_return_refunds
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE INDEX IF NOT EXISTS ars_gl_sales_return_refund_lookup ON ars_gl_sales_return_refunds(shop_id,return_id);
 CREATE TABLE IF NOT EXISTS ars_gl_purchase_returns(
 shop_id TEXT NOT NULL,id TEXT NOT NULL,purchase_order_id TEXT NOT NULL,
 return_date DATE NOT NULL,reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
 recorded_by TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(shop_id,id)
 );
 CREATE TABLE IF NOT EXISTS ars_gl_purchase_return_lines(
 shop_id TEXT NOT NULL,return_id TEXT NOT NULL,purchase_order_item_id BIGINT NOT NULL,
 base_quantity BIGINT NOT NULL CHECK(base_quantity>0),
 inventory_cost NUMERIC(16,2) NOT NULL CHECK(inventory_cost>0),
 supplier_credit NUMERIC(16,2) NOT NULL CHECK(supplier_credit>0),
 PRIMARY KEY(shop_id,return_id,purchase_order_item_id),
 FOREIGN KEY(shop_id,return_id) REFERENCES ars_gl_purchase_returns(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_purchase_return_immutable ON ars_gl_purchase_returns;
 CREATE TRIGGER ars_gl_purchase_return_immutable BEFORE UPDATE OR DELETE ON ars_gl_purchase_returns
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 DROP TRIGGER IF EXISTS ars_gl_purchase_return_line_immutable ON ars_gl_purchase_return_lines;
 CREATE TRIGGER ars_gl_purchase_return_line_immutable BEFORE UPDATE OR DELETE ON ars_gl_purchase_return_lines
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE TABLE IF NOT EXISTS ars_gl_import_return_costs(
 shop_id TEXT NOT NULL,return_id TEXT NOT NULL,purchase_order_item_id BIGINT NOT NULL,
 approval_id TEXT NOT NULL,historical_goods_cost NUMERIC(16,2) NOT NULL CHECK(historical_goods_cost>=0),
 historical_import_charges NUMERIC(16,2) NOT NULL CHECK(historical_import_charges>=0),
 carrying_cost NUMERIC(16,2) NOT NULL CHECK(carrying_cost>0),
 supplier_credit NUMERIC(16,2) NOT NULL CHECK(supplier_credit>0),
 carrying_variance NUMERIC(16,2) NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(shop_id,return_id,purchase_order_item_id),
 FOREIGN KEY(shop_id,return_id,purchase_order_item_id) REFERENCES ars_gl_purchase_return_lines(shop_id,return_id,purchase_order_item_id),
 CHECK(carrying_variance=carrying_cost-supplier_credit)
 );
 DROP TRIGGER IF EXISTS ars_gl_import_return_cost_immutable ON ars_gl_import_return_costs;
 CREATE TRIGGER ars_gl_import_return_cost_immutable BEFORE UPDATE OR DELETE ON ars_gl_import_return_costs
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE TABLE IF NOT EXISTS ars_gl_import_charge_recoveries(
 shop_id TEXT NOT NULL,id TEXT NOT NULL,return_id TEXT NOT NULL,
 charge_kind TEXT NOT NULL CHECK(charge_kind IN ('Freight','Customs','Clearance')),
 payer TEXT NOT NULL CHECK(length(trim(payer)) BETWEEN 1 AND 200),
 document_reference TEXT NOT NULL CHECK(length(trim(document_reference)) BETWEEN 1 AND 200),
 amount NUMERIC(16,2) NOT NULL CHECK(amount>0),
 account_id TEXT NOT NULL,recovery_date DATE NOT NULL,
 evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
 recorded_by TEXT NOT NULL,journal_id TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(shop_id,id),UNIQUE(shop_id,journal_id),
 UNIQUE(shop_id,charge_kind,payer,document_reference),
 FOREIGN KEY(shop_id,return_id) REFERENCES ars_gl_purchase_returns(shop_id,id),
 FOREIGN KEY(shop_id,journal_id) REFERENCES ars_gl_journals(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_import_charge_recovery_immutable ON ars_gl_import_charge_recoveries;
 CREATE TRIGGER ars_gl_import_charge_recovery_immutable BEFORE UPDATE OR DELETE ON ars_gl_import_charge_recoveries
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE INDEX IF NOT EXISTS ars_gl_import_charge_recovery_return ON ars_gl_import_charge_recoveries(shop_id,return_id);
 CREATE TABLE IF NOT EXISTS ars_gl_supplier_refunds(
 shop_id TEXT NOT NULL,id TEXT NOT NULL,return_id TEXT NOT NULL,account_id TEXT NOT NULL,
 amount NUMERIC(16,2) NOT NULL CHECK(amount>0),refund_date DATE NOT NULL,
 evidence TEXT NOT NULL CHECK(length(trim(evidence)) BETWEEN 1 AND 500),
 recorded_by TEXT NOT NULL,journal_id TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(shop_id,id),UNIQUE(shop_id,journal_id),
 FOREIGN KEY(shop_id,return_id) REFERENCES ars_gl_purchase_returns(shop_id,id),
 FOREIGN KEY(shop_id,journal_id) REFERENCES ars_gl_journals(shop_id,id)
 );
 DROP TRIGGER IF EXISTS ars_gl_supplier_refund_immutable ON ars_gl_supplier_refunds;
 CREATE TRIGGER ars_gl_supplier_refund_immutable BEFORE UPDATE OR DELETE ON ars_gl_supplier_refunds
 FOR EACH ROW EXECUTE FUNCTION ars_gl_reject_mutation();
 CREATE INDEX IF NOT EXISTS ars_gl_supplier_refund_return ON ars_gl_supplier_refunds(shop_id,return_id);
 CREATE INDEX IF NOT EXISTS ars_gl_purchase_return_order ON ars_gl_purchase_returns(shop_id,purchase_order_id);
 CREATE INDEX IF NOT EXISTS ars_gl_opening_proposals_shop ON ars_gl_opening_proposals(shop_id,submitted_at DESC);
 CREATE INDEX IF NOT EXISTS ars_gl_journal_date ON ars_gl_journals(shop_id,posting_date,id);
 CREATE INDEX IF NOT EXISTS ars_gl_line_account ON ars_gl_lines(shop_id,account_code);
 `);
}