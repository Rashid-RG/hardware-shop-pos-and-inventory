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
echo 'Backup archive restored successfully into hardware_pos_restore_ci; business records match.'
