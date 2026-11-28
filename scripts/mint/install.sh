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
PYTHONDONTWRITEBYTECODE=1 python3 scripts/mint/desktop_registration.py preflight "$root"
# Fresh-install entry point only. Registered installations must use update/recovery tools.
python3 scripts/mint/runtime-layout.py "$root"
echo "ARS_SETUP_STAGE 1"
npm ci --include=dev
echo "ARS_SETUP_STAGE 2"
npm run build
echo "ARS_SETUP_STAGE 3"
# Provision the image while the installer has internet access.
docker compose -p ars-mint --env-file .env.local -f scripts/mint/compose.yaml up -d --wait
echo "ARS_SETUP_STAGE 4"
app="$HOME/.local/share/ars-hardware"
mkdir -p "$app" "$HOME/.config/systemd/user" "$HOME/.local/share/applications"
ln -sfnT "$root" "$app/project"
ln -sfnT "$(command -v node)" "$app/node"
# Keep the guard outside release folders so it survives a pointer switch.
mkdir -p "$app/update-tools"
install -m 600 scripts/mint/startup_guard.py scripts/mint/interrupted_switch.py \
  scripts/mint/signed_release_source.py scripts/mint/run-trusted-incident-restore.py \
  scripts/mint/trusted-switch-recovery.py "$app/update-tools/"
if [[ -f "$root/PILOT-FILES.json" ]]; then
  /usr/bin/python3 -E -s -B "$app/update-tools/trusted-switch-recovery.py" install-initial --initial-project "$root"
fi
install -m 644 scripts/mint/ars-hardware.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable ars-hardware.service
systemctl --user start --no-block ars-hardware.service
mkdir -p "$HOME/.local/share/icons/hicolor/scalable/apps"
install -m 644 public/ars-official.svg "$HOME/.local/share/icons/hicolor/scalable/apps/ars-distributor.svg"
desktop=$(xdg-user-dir DESKTOP)
mkdir -p "$desktop"
python3 - "$app/project/scripts/mint/open.py" "$desktop" <<'PY'
from pathlib import Path
import sys
script, desktop = sys.argv[1:]
# Desktop Entry value escaping precedes Exec argument parsing.
arg = ''.join('\\' + c if c in '"`$\\' else c for c in script).replace('\\', '\\\\').replace('%', '%%')
entry = f'[Desktop Entry]\nType=Application\nName=ARS Distributor POS\nExec=python3 "{arg}"\nIcon=ars-distributor\nTerminal=false\nCategories=Office;\n'
for folder in [Path.home()/'.local/share/applications', Path(desktop)]:
    target = folder/'ars-hardware.desktop'
    with target.open("x") as stream:
        stream.write(entry)
    target.chmod(0o755)
PY
python3 - "$app/update-tools/trusted-switch-recovery.py" "$desktop" <<'PY'
from pathlib import Path
import sys
script, desktop = sys.argv[1:]
arg = ''.join('\\' + c if c in '"`$\\' else c for c in script).replace('\\', '\\\\').replace('%', '%%')
entry = f'[Desktop Entry]\nType=Application\nName=RS Nextward Update Center\nExec=/usr/bin/python3 -E -s -B "{arg}" update-center\nIcon=system-software-update\nTerminal=false\nCategories=System;\n'
for folder in [Path.home()/'.local/share/applications', Path(desktop)]:
    target = folder/'ars-update-center.desktop'
    with target.open("x") as stream:
        stream.write(entry)
    target.chmod(0o755)
PY
gio set "$desktop/ars-update-center.desktop" metadata::trusted true 2>/dev/null || true
gio set "$desktop/ars-hardware.desktop" metadata::trusted true 2>/dev/null || true
python3 scripts/mint/install-recovery-shortcut.py
python3 - "$app/project/scripts/mint/maintenance-center.py" <<'PY'
from pathlib import Path
import sys
script=sys.argv[1]
arg=''.join('\\'+c if c in '"'+chr(96)+'$\\' else c for c in script).replace('\\','\\\\').replace('%','%%')
target=Path.home()/".local/share/applications/ars-maintenance-center.desktop"
with target.open("x") as stream:
    stream.write(f'[Desktop Entry]\nType=Application\nName=RS Nextward Maintenance Center\nExec=/usr/bin/python3 "{arg}"\nIcon=ars-distributor\nTerminal=false\nCategories=System;\n')
target.chmod(0o755)
PY
# Record only fresh package installs; development source trees have no pilot manifest.
if [[ -f "$root/PILOT-FILES.json" ]]; then
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/mint/desktop_registration.py record "$root"
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/mint/installation_identity.py "$root"
fi
echo "ARS_SETUP_STAGE 5"
echo "Setup complete. Open ARS Distributor POS on the desktop."
