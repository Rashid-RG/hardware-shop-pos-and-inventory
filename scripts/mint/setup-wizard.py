#!/usr/bin/env python3
"""Graphical fresh-install entry point. Never performs updates or recovery."""
import fcntl
import os
from pathlib import Path
import shutil
import subprocess
import sys
from setup_resume import offer_resume, consume_resume

TITLE = "RS Nextward | ARS Distributor Setup"
ROOT = Path(__file__).resolve().parents[2]
STATE = Path.home() / ".local/share/ars-hardware"

def dialog(*args):
    return subprocess.run(["zenity", "--title="+TITLE, *args]).returncode

def assert_fresh():
    if os.geteuid() == 0:
        raise RuntimeError("Run Setup as your regular desktop user, not as root.")
    if os.path.lexists(STATE):
        raise RuntimeError("Existing installation or partial setup detected. Use RS Nextward recovery support. No data was changed.")
    for name in (".env.local", "uploads", "backups"):
        if os.path.lexists(ROOT/name):
            raise RuntimeError("Existing local runtime data detected. Fresh setup is blocked.")
def preflight():
    assert_fresh()
    missing = [x for x in ("node","npm","docker","python3","zenity","systemctl","xdg-open","xdg-user-dir") if not shutil.which(x)]
    if missing:
        raise RuntimeError("Install these required components first: "+", ".join(missing))
    subprocess.run(["node","-e","if (+process.versions.node.split('.')[0] !== 22 || +process.versions.node.split('.')[1] < 12) process.exit(1)"],check=True)
    for command in (["docker","info"],["docker","compose","version"],["systemctl","--user","show-environment"]):
        subprocess.run(command,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

def main():
    if not shutil.which("zenity"):
        print("Zenity is required for graphical setup.",file=sys.stderr)
        return 1
    lock_dir = Path(os.environ.get("XDG_RUNTIME_DIR") or (Path.home()/".cache"))
    lock_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
    with (lock_dir/"ars-fresh-setup.lock").open("a") as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            return 1
        try:
            consume_resume(ROOT)
            assert_fresh()
            from setup_ui import SetupUI
            ui=SetupUI(ROOT,TITLE)
            if not ui.page("Welcome to Setup","Thank you for choosing RS Nextward.\n\nWelcome to ARS Distributor 1.0 Pilot Setup. This wizard prepares your wholesale distribution workspace and local database. Internet access is required."):
                return 0
            if not ui.page("Installation agreement",(ROOT/"docs/pilot-installation-terms.txt").read_text(),"Accept and continue",agreement=True):
                return 0
            from setup_node_runtime import prepare_node
            prepare_node(ROOT, dialog)
            from setup_prerequisites import install_missing
            if not install_missing(dialog, lambda: offer_resume(ROOT, dialog)):
                return 0
            if not ui.page("Ready to install","Install from:\n"+str(ROOT)+"\n\nKeep this folder in a permanent location. Setup creates a desktop shortcut and enables the user service. Business data is stored separately.","Install"):
                return 0
            preflight()
            ui.install()
            if ui.page("Setup completed","Thank you for choosing RS Nextward.\n\nInstallation steps completed. Launch ARS Distributor to verify database readiness and complete first-administrator setup.","Launch ARS Distributor",cancel="Finish"):
                subprocess.run(["python3",str(ROOT/"scripts/mint/open.py")],check=True)
            return 0
        except (OSError,RuntimeError,ImportError,ValueError,subprocess.CalledProcessError) as error:
            dialog("--error","--no-markup","--text=Setup could not complete. Existing files and database volumes have been retained. Contact RS Nextward support; do not delete data.\n\n"+str(error))
            return 1

if __name__ == "__main__":
    raise SystemExit(main())
