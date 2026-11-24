#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
root=$(pwd -P)
if (( EUID == 0 )); then echo "Run setup as the desktop user."; exit 1; fi
for tool in node npm docker python3 zenity systemctl xdg-open xdg-user-dir; do
  command -v "$tool" >/dev/null || { echo "Install $tool first."; exit 1; }
done
node -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)' || { echo "Node 22 or newer is required."; exit 1; }
docker info >/dev/null
docker compose version >/dev/null
systemctl --user show-environment >/dev/null
# Fresh installs use stable runtime data; legacy installations fail closed.
python3 scripts/mint/runtime-layout.py "$root"
npm ci --include=dev
npm run build
# Provision the image while the installer has internet access.
docker compose -p ars-mint --env-file .env.local -f scripts/mint/compose.yaml up -d --wait
app="$HOME/.local/share/ars-hardware"
mkdir -p "$app" "$HOME/.config/systemd/user" "$HOME/.local/share/applications"
ln -sfnT "$root" "$app/project"
ln -sfnT "$(command -v node)" "$app/node"
install -m 644 scripts/mint/ars-hardware.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable ars-hardware.service
systemctl --user start --no-block ars-hardware.service
desktop=$(xdg-user-dir DESKTOP)
mkdir -p "$desktop"
python3 - "$app/project/scripts/mint/open.py" "$desktop" <<'PY'
from pathlib import Path
import sys
script, desktop = sys.argv[1:]
# Desktop Entry value escaping precedes Exec argument parsing.
arg = ''.join('\\' + c if c in '"`$\\' else c for c in script).replace('\\', '\\\\').replace('%', '%%')
entry = f'[Desktop Entry]\nType=Application\nName=ARS Distributor POS\nExec=python3 "{arg}"\nIcon=applications-office\nTerminal=false\nCategories=Office;\n'
for folder in [Path.home()/'.local/share/applications', Path(desktop)]:
    target = folder/'ars-hardware.desktop'
    target.write_text(entry)
    target.chmod(0o755)
PY
gio set "$desktop/ars-hardware.desktop" metadata::trusted true 2>/dev/null || true
echo "Setup complete. Open ARS Distributor POS on the desktop."
