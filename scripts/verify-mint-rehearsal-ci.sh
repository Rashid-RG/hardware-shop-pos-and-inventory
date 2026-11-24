#!/usr/bin/env bash
# Exercise installed entry points with ephemeral GitHub-hosted runner data only.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
state="$HOME/.local/share/ars-hardware"
[[ ! -e "$state" && ! -L "$state" && ! -e .env.local && ! -L .env.local ]]
scratch=$(mktemp -d)
project="$scratch/project"
mkdir -p "$project" "$state"
cp -a scripts "$project/"
ln -s "$project" "$state/project"
ln -s "$(command -v node)" "$state/node"
cd "$project"
compose=(docker compose -p ars-mint --env-file .env.local -f scripts/mint/compose.yaml)
trap '"${compose[@]}" down -v' EXIT
cat > .env.local <<'CONFIG'
ARS_MINT_DB_PASSWORD=ars-ci-only
DATABASE_URL=postgresql://ars:ars-ci-only@127.0.0.1:5434/hardware_pos_ars
CONFIG
"${compose[@]}" up -d --wait postgres
# Copy the populated test fixture into the isolated Mint Compose environment.
docker exec "$1" pg_dump -U postgres -Fc hardware_pos_ci |
  "${compose[@]}" exec -T postgres pg_restore -U ars -d hardware_pos_ars --exit-on-error --no-owner --no-acl
mkdir uploads
echo 'CI upload fixture' > uploads/fixture.txt
python3 scripts/mint/backup.py
archives=(backups/*.dump)
[[ ${#archives[@]} -eq 1 ]]
python3 scripts/mint/disaster-recovery-test.py "${archives[0]}"
python3 - "$state" <<'PY'
import json
from pathlib import Path
import sys
report, = (Path(sys.argv[1]) / "recovery-reports").glob("rehearsal-*.json")
data = json.loads(report.read_text())
assert data["restoreTestPassed"] is True
assert data["sourceComparison"]["status"] == "matched"
assert data["sourceComparison"]["publicTableCount"] >= 10
assert data["counts"]["products"] > 0
PY
