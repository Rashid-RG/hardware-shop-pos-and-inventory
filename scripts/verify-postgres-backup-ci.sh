#!/usr/bin/env bash
# Verify a PostgreSQL archive can actually restore into a separate, isolated database.
# CI-only. Refuses all database names other than hardware_pos_ci.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the isolated CI database}"
if [[ "$DATABASE_URL" != *"/hardware_pos_ci" ]]; then
  echo "Refusing to run outside hardware_pos_ci" >&2
  exit 1
fi
if [[ "$DATABASE_URL" != *"@127.0.0.1:5432/"* ]]; then
  echo "Refusing to run without the localhost CI connection" >&2
  exit 1
fi

command -v docker >/dev/null || { echo "Docker required for PostgreSQL 16 client" >&2; exit 1; }
tempdir="$(mktemp -d)"
trap 'rm -rf "$tempdir"' EXIT
chmod 700 "$tempdir"

# Use the PostgreSQL 16 tools matching the CI database server version.
pg() {
  docker run --rm --network host \
    -e PGPASSWORD=ci-test-only-password \
    -v "$tempdir:/backup" \
    postgres:16-alpine "$@"
}
pg psql -h 127.0.0.1 -U postgres -d hardware_pos_ci -v ON_ERROR_STOP=1 -Atc 'SELECT 1' >/dev/null
pg pg_dump -h 127.0.0.1 -U postgres -d hardware_pos_ci -Fc -f /backup/hardware_pos_ci.dump
pg pg_restore --list /backup/hardware_pos_ci.dump >/dev/null

# Never clobber an existing database, even in isolated CI.
existing="$(pg psql -h 127.0.0.1 -U postgres -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'hardware_pos_restore_ci'")"
if [[ -n "$existing" ]]; then
  echo 'Refusing to overwrite existing restore database' >&2
  exit 1
fi
pg createdb -h 127.0.0.1 -U postgres hardware_pos_restore_ci
pg pg_restore -h 127.0.0.1 -U postgres -d hardware_pos_restore_ci --exit-on-error --no-owner --no-privileges /backup/hardware_pos_ci.dump

# Check the exact restored data for accounting and inventory tables, not just archive readability.
# JSON aggregation ordered by stable IDs ensures that matching row counts alone cannot pass.
tables=(
  products customers suppliers sales_transactions sales_transaction_items
  purchase_orders purchase_order_items customer_credit_payments supplier_payments
  stock_logs activity_logs
)
for table in "${tables[@]}"; do
  sql="SELECT COALESCE(md5(string_agg(row_to_json(t)::text, '|' ORDER BY id)), md5('')) FROM (SELECT * FROM \"$table\" ORDER BY id) AS t"
  original="$(pg psql -h 127.0.0.1 -U postgres -d hardware_pos_ci -v ON_ERROR_STOP=1 -Atc "$sql")"
  restored="$(pg psql -h 127.0.0.1 -U postgres -d hardware_pos_restore_ci -v ON_ERROR_STOP=1 -Atc "$sql")"
  if [[ "$original" != "$restored" ]]; then
    echo "Restore check failed for $table" >&2
    exit 1
  fi
  echo "Restore verified: $table"
done
# Additional ARS ledgers use some composite primary keys instead of an id column.
# Compare full sorted JSON rows for every ARS table present in the source DB.
ars_tables=(
  ars_import_shipments ars_landed_cost_approvals ars_import_expense_links ars_business_partners ars_partner_capital_entries
  ars_receipt_batches ars_receipt_batch_items ars_receipt_cost_entries
  ars_packaging_drafts
  ars_financial_accounts ars_financial_movements
  ars_customer_cheques ars_customer_cheque_events ars_financial_reconciliations
  ars_invoice_requests ars_representative_accounts ars_representative_logins ars_cash_handovers ars_invoice_cost_corrections
  ars_legacy_sale_return_units
  ars_partner_profit_allocations ars_partner_profit_shares
)
for table in "${ars_tables[@]}"; do
  exists="$(pg psql -h 127.0.0.1 -U postgres -d hardware_pos_ci -v ON_ERROR_STOP=1 -Atc "SELECT to_regclass('public.$table') IS NOT NULL")"
  [[ "$exists" == "t" ]] || continue
  sql="SELECT md5(COALESCE(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text),'')) FROM \"$table\" t"
  original="$(pg psql -h 127.0.0.1 -U postgres -d hardware_pos_ci -v ON_ERROR_STOP=1 -Atc "$sql")"
  restored="$(pg psql -h 127.0.0.1 -U postgres -d hardware_pos_restore_ci -v ON_ERROR_STOP=1 -Atc "$sql")"
  if [[ "$original" != "$restored" ]]; then
    echo "ARS restore mismatch: $table" >&2
    exit 1
  fi
  echo "ARS restore verified: $table"
done
# Shared-stock fixtures must be present; otherwise full-row comparison could pass vacuously.
for database in hardware_pos_ci hardware_pos_restore_ci; do
  pg psql -h 127.0.0.1 -U postgres -d "$database" -v ON_ERROR_STOP=1 -Atc "
    SELECT CASE WHEN
      EXISTS(SELECT 1 FROM products WHERE shared_stock_units IS NOT NULL)
      AND EXISTS(SELECT 1 FROM ars_packaging_drafts)
      AND EXISTS(SELECT 1 FROM sales_transaction_items WHERE selling_unit_id IS NOT NULL AND base_units_per_sale_unit > 1)
      AND EXISTS(SELECT 1 FROM purchase_order_items WHERE selling_unit_id IS NOT NULL AND base_units_per_purchase_unit > 1)
      THEN 'shared-stock-fixtures-present' ELSE 'missing' END" | grep -qx 'shared-stock-fixtures-present'
  echo "Shared-stock restoration fixtures verified: $database"
done
# Require populated approval and receipt costing fixtures on both sides.
for database in hardware_pos_ci hardware_pos_restore_ci; do
  pg psql -h 127.0.0.1 -U postgres -d "$database" -v ON_ERROR_STOP=1 -Atc "
    SELECT CASE WHEN EXISTS(
      SELECT 1 FROM ars_landed_cost_approvals a
      JOIN ars_receipt_cost_entries c ON c.approval_id=a.id AND c.shop_id=a.shop_id
      GROUP BY a.id,a.landed_total
      HAVING COUNT(*)>=2 AND SUM(c.received_cost)=a.landed_total
    ) THEN 'landed-cost-fixtures-present' ELSE 'missing' END" | grep -qx 'landed-cost-fixtures-present'
  echo "Landed-cost restoration fixtures verified: $database"
done
for database in hardware_pos_ci hardware_pos_restore_ci; do
  pg psql -h 127.0.0.1 -U postgres -d "$database" -v ON_ERROR_STOP=1 -Atc "
    SELECT CASE WHEN EXISTS(
      SELECT 1 FROM ars_import_expense_links l JOIN manual_expenses e ON e.id=l.expense_id AND e.shop_id=l.shop_id
      JOIN ars_financial_movements m ON m.shop_id=l.shop_id AND m.source_id=e.id AND m.movement_kind='Expense' AND m.amount=-l.amount
      JOIN ars_landed_cost_approvals a ON a.id=l.approval_id AND a.shop_id=l.shop_id
      WHERE e.amount=l.amount GROUP BY a.id HAVING COUNT(*)>=2
    ) THEN 'import-expense-fixtures-present' ELSE 'missing' END" | grep -qx 'import-expense-fixtures-present'
  echo "Import expense reconciliation restoration fixtures verified: $database"
done
echo 'Backup archive restored successfully into hardware_pos_restore_ci; business records match.'
