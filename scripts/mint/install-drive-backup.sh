#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
test -x "$HOME/.local/share/ars-hardware/node" || { echo "Install ARS for Mint first."; exit 1; }
command -v rclone >/dev/null || { echo "Install rclone and configure the ARS Drive remotes first."; exit 1; }
units="$HOME/.config/systemd/user"
mkdir -p "$units"
install -m 644 ars-drive-backup.service ars-drive-backup.timer "$units/"
systemctl --user daemon-reload
systemctl --user enable --now ars-drive-backup.timer
systemctl --user list-timers ars-drive-backup.timer
