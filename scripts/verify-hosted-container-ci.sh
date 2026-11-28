#!/usr/bin/env bash
# CI only. Exercises the BUILT ARS runtime image against a freshly created
# dedicated PostgreSQL database and a disposable Docker uploads volume.
# No real shop database, customer record, or hosted server is touched.
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${CI:-}" != "true" ]]; then
  echo 'Refusing hosted smoke test outside GitHub Actions CI.' >&2
  exit 1
fi
db_name='hardware_pos_hosted_smoke_ci'
db_url="postgresql://postgres:ci-test-only-password@127.0.0.1:5432/$db_name"
admin_url='postgresql://postgres:ci-test-only-password@127.0.0.1:5432/postgres'
name="ars-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
volume="ars-smoke-uploads-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
port=39741
owned_container=false
created_db=false
created_volume=false
created_restore_volume=false
restore_volume="ars-smoke-restore-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
backup_dir="$(mktemp -d)"
chmod 700 "$backup_dir"

cleanup() {
  if [[ "$owned_container" == "true" ]]; then docker rm -f "$name" >/dev/null 2>&1 || true; fi
  if [[ "$created_volume" == "true" ]]; then docker volume rm "$volume" >/dev/null 2>&1 || true; fi
  if [[ "$created_restore_volume" == "true" ]]; then docker volume rm "$restore_volume" >/dev/null 2>&1 || true; fi
  rm -rf -- "$backup_dir"
  if [[ "$created_db" == "true" ]]; then
    ARS_SMOKE_ADMIN_URL="$admin_url" ARS_SMOKE_DB_NAME="$db_name" node --input-type=module <<'EOF' || true
import pg from 'pg';
const dbName=process.env.ARS_SMOKE_DB_NAME;
if (dbName !== 'hardware_pos_hosted_smoke_ci') process.exit(1);
const client=new pg.Client({connectionString:process.env.ARS_SMOKE_ADMIN_URL});
await client.connect();
try {
  await client.query('DROP DATABASE IF EXISTS "' + dbName + '" WITH (FORCE)');
} finally { await client.end(); }
EOF
  fi
}
trap cleanup EXIT

ARS_SMOKE_ADMIN_URL="$admin_url" ARS_SMOKE_DB_NAME="$db_name" node --input-type=module <<'EOF'
import pg from 'pg';
const dbName=process.env.ARS_SMOKE_DB_NAME;
if (dbName !== 'hardware_pos_hosted_smoke_ci') throw new Error('Refusing non-CI database name');
const client=new pg.Client({connectionString:process.env.ARS_SMOKE_ADMIN_URL});
await client.connect();
try {
  const existing=await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[dbName]);
  if (existing.rowCount) throw new Error('Refusing to overwrite existing isolated smoke database');
  await client.query('CREATE DATABASE "' + dbName + '"');
} finally { await client.end(); }
EOF

created_db=true
# Never reuse an existing named uploads volume or erase anything pre-existing.
if docker volume inspect "$volume" >/dev/null 2>&1 || docker volume inspect "$restore_volume" >/dev/null 2>&1; then
  echo 'Refusing to reuse an existing Docker upload or restore volume.' >&2
  exit 1
fi
docker volume create "$volume" >/dev/null
created_volume=true
start_container() {
  if docker container inspect "$name" >/dev/null 2>&1; then
    echo "Refusing to reuse existing smoke container." >&2; return 1
  fi
  docker run -d --name "$name" --network host \
    --mount "type=volume,source=$volume,target=/app/uploads" \
    -e NODE_ENV=production -e PORT="$port" \
    -e ARS_DISABLE_HTTP_FIRST_ADMIN_SETUP=true \
    -e ARS_UPLOADS_MOUNT_REQUIRED=true \
    -e ARS_RELEASE_ID="ci-${GITHUB_SHA:-smoke}" \
    -e JWT_SECRET='ci-ars-smoke-authentication-key-2026-abcdef1234' \
    -e DATABASE_URL="$db_url" \
    ars-hardware-pos:ci >/dev/null
  owned_container=true
}

stop_container() {
  docker stop -t 15 "$name" >/dev/null
  docker rm "$name" >/dev/null
  owned_container=false
}

wait_ready() {
  local status=''
  for _ in $(seq 1 120); do
    status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$port/api/ready" 2>/dev/null || true)"
    [[ "$status" == '200' ]] && return 0
    if [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)" != "true" ]]; then
      docker logs "$name" 2>&1 | tail -35 || true
      echo 'ARS hosted container exited before readiness.' >&2
      return 1
    fi
    sleep 1
  done
  docker logs "$name" 2>&1 | tail -35 || true
  echo "ARS hosted readiness never became healthy (HTTP $status)." >&2
  return 1
}

start_container
wait_ready
status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 "http://127.0.0.1:$port/api/auth/setup-status")"
[[ "$status" == '403' ]] || { echo "Hosted HTTP admin setup status accessible (HTTP $status)." >&2; exit 1; }
status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$port/api/auth/setup-admin")"
[[ "$status" == '403' ]] || { echo "Hosted HTTP admin creation accessible (HTTP $status)." >&2; exit 1; }
echo 'Hosted readiness and HTTP first-admin lockdown verified.'

# Simulate a logo upload on the persistent disk without touching business APIs.
docker exec "$name" sh -c "printf 'ars-ci-upload-preservation' > /app/uploads/shops/ci-smoke-file.txt"
curl -fsS --max-time 5 "http://127.0.0.1:$port/uploads/shops/ci-smoke-file.txt" | grep -qx 'ars-ci-upload-preservation'
stop_container
start_container
wait_ready
curl -fsS --max-time 5 "http://127.0.0.1:$port/uploads/shops/ci-smoke-file.txt" | grep -qx 'ars-ci-upload-preservation'
echo 'Mounted uploads survive full container replacement.'

# Verify an independently usable uploads backup, not only the live volume.
# Stop the app before taking this sample archive so the file set is stable.
docker exec "$name" sh -c "printf 'ars-ci-product-image' > /app/uploads/products/ci-product-file.txt"
stop_container
# Archive content comes exclusively from the isolated CI-owned volume.
docker run --rm --mount "type=volume,source=$volume,target=/source,readonly" \
  node:22-bookworm-slim tar -C /source -cf - shops products > "$backup_dir/uploads.tar"
test -s "$backup_dir/uploads.tar"
tar -tf "$backup_dir/uploads.tar" | grep -qx 'shops/ci-smoke-file.txt'
tar -tf "$backup_dir/uploads.tar" | grep -qx 'products/ci-product-file.txt'
# Restore to a new and previously nonexistent volume. Never restore in place.
docker volume create "$restore_volume" >/dev/null
created_restore_volume=true
docker run --rm -i --mount "type=volume,source=$restore_volume,target=/restore" \
  node:22-bookworm-slim tar -C /restore -xf - < "$backup_dir/uploads.tar"
# Compare the two separately mounted volumes without writing either source.
original_hashes="$(docker run --rm --mount "type=volume,source=$volume,target=/volume,readonly" \
  node:22-bookworm-slim sh -c 'cd /volume && sha256sum shops/ci-smoke-file.txt products/ci-product-file.txt')"
restored_hashes="$(docker run --rm --mount "type=volume,source=$restore_volume,target=/volume,readonly" \
  node:22-bookworm-slim sh -c 'cd /volume && sha256sum shops/ci-smoke-file.txt products/ci-product-file.txt')"
[[ "$original_hashes" == "$restored_hashes" ]] || {
  echo 'Restored upload files differ from the archived originals.' >&2
  exit 1
}
# Restart ARS on its original volume, proving the backup drill did not replace
# or mutate the runtime upload store.
start_container
wait_ready
curl -fsS --max-time 5 "http://127.0.0.1:$port/uploads/products/ci-product-file.txt" | grep -qx 'ars-ci-product-image'
echo 'Separate-volume upload archive restore and SHA-256 verification passed.'

ARS_SMOKE_DB_URL="$db_url" node --input-type=module <<'EOF'
import pg from 'pg';
const url=new URL(process.env.ARS_SMOKE_DB_URL || '');
if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/hardware_pos_hosted_smoke_ci') {
  throw new Error('Refusing database verification outside smoke CI');
}
const client=new pg.Client({connectionString:url.href});
await client.connect();
try {
  const result=await client.query('SELECT COUNT(*)::integer AS count FROM users');
  if (result.rows[0].count !== 0) throw new Error('Unexpected bootstrap user in fresh hosted database');
} finally { await client.end(); }
EOF
echo 'Hosted image startup, administrator lockdown, empty database and uploads persistence smoke test passed.'
