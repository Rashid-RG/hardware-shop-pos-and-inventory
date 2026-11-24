#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
test -x "$HOME/.local/share/ars-hardware/node" || { echo "Install ARS for Mint first."; exit 1; }
command -v rclone >/dev/null || { echo "Install rclone and configure the ARS Drive remotes first."; exit 1; }
units="$HOME/.config/systemd/user"
mkdir -p "$units"
install -m 644 ars-drive-backup.service ars-drive-backup.timer ars-drive-backup-failed.service "$units/"
if [[ $# -gt 0 ]]; then
  [[ $# -eq 1 && $1 =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { echo "Expected HH:MM in 24-hour time."; exit 1; }
  directory="$units/ars-drive-backup.timer.d"
  mkdir -p "$directory"
  override=$(mktemp "$directory/.schedule.XXXXXX")
  trap 'rm -f "$override"' EXIT
  printf '[Timer]\nOnCalendar=\nOnCalendar=*-*-* %s:00\n' "$1" > "$override"
  mv -f "$override" "$directory/schedule.conf"
fi
systemctl --user daemon-reload
systemctl --user enable ars-drive-backup.timer
systemctl --user restart ars-drive-backup.timer
systemctl --user list-timers ars-drive-backup.timer
