#!/usr/bin/env python3
"""Graphical fresh-install entry point. Never performs updates or recovery."""
import fcntl
import os
from pathlib import Path
import shutil
import subprocess
import sys

TITLE = "RS Nextward | ARS Distributor Setup"
ROOT = Path(__file__).resolve().parents[2]
STATE = Path.home() / ".local/share/ars-hardware"

def dialog(*args):
    return subprocess.run(["zenity", "--title="+TITLE, *args]).returncode

def preflight():
    if os.geteuid() == 0:
        raise RuntimeError("Run Setup as your regular desktop user, not as root.")
    if os.path.lexists(STATE):
        raise RuntimeError("Existing installation or partial setup detected. Use RS Nextward recovery support. No data was changed.")
    for name in (".env.local", "uploads", "backups"):
        if os.path.lexists(ROOT/name):
            raise RuntimeError("Existing local runtime data detected. Fresh setup is blocked.")
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
            preflight()
            if dialog("--question","--no-markup","--width=500","--text=Thank you for choosing RS Nextward.\n\nWelcome to ARS Distributor 1.0 Pilot Setup. This wizard prepares your wholesale distribution workspace and local database. Internet access is required.","--ok-label=Next","--cancel-label=Cancel"):
                return 0
            if dialog("--text-info","--width=650","--height=450","--filename="+str(ROOT/"docs/pilot-installation-terms.txt"),"--checkbox=I accept these pilot installation conditions","--ok-label=Accept and continue","--cancel-label=Do not accept"):
                return 0
            if dialog("--question","--no-markup","--width=520","--text=Ready to install from:\n"+str(ROOT)+"\n\nKeep this folder in a permanent location. Setup creates a desktop shortcut and enables the user service. Business data is stored separately.","--ok-label=Install","--cancel-label=Cancel"):
                return 0
            preflight()
            progress = subprocess.Popen(["zenity","--title="+TITLE,"--progress","--pulsate","--no-cancel","--auto-close","--text=Installing dependencies, building the application and preparing PostgreSQL. Do not close Setup."],stdin=subprocess.PIPE)
            try:
                subprocess.run(["bash",str(ROOT/"scripts/mint/install.sh")],cwd=ROOT,check=True)
            finally:
                if progress.poll() is None:
                    progress.terminate()
                progress.wait()
            if not dialog("--question","--no-markup","--width=480","--text=Thank you for choosing RS Nextward.\n\nInstallation steps completed. Launch ARS Distributor to verify database readiness and complete first-administrator setup.","--ok-label=Launch ARS Distributor","--cancel-label=Finish"):
                subprocess.run(["python3",str(ROOT/"scripts/mint/open.py")],check=True)
            return 0
        except (OSError,RuntimeError,subprocess.CalledProcessError):
            dialog("--error","--no-markup","--text=Setup could not complete or a prerequisite is missing. Existing files and database volumes have been retained. Contact RS Nextward support; do not rerun setup or delete data.")
            return 1

if __name__ == "__main__":
    raise SystemExit(main())
