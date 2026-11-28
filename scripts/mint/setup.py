#!/usr/bin/env python3
"""Graphical first-install wrapper. Never removes existing database volumes."""
import fcntl
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from open import ready
from prerequisites import install_missing

TITLE = "ARS Distributor Setup"
ROOT = Path(__file__).resolve().parents[2]

def dialog(mode, message):
    return subprocess.run(["zenity", mode, "--title=" + TITLE, "--no-markup",
                           "--text=" + message], check=False).returncode == 0

def check_tools():
    missing = [name for name in ("node", "npm", "docker", "python3", "systemctl",
                                 "xdg-open", "xdg-user-dir", "gio")
               if shutil.which(name) is None]
    if missing:
        return "Missing prerequisites: " + ", ".join(missing) + ". Ask your administrator to install these before setup."
    checks = [
        (["node", "-e", "process.exit(+process.versions.node.split('.')[0]<22?1:0)"], "Node.js 22 or newer is required."),
        (["docker", "info"], "Docker is unavailable to this desktop user. Check service and permissions."),
        (["docker", "compose", "version"], "Docker Compose is required."),
        (["systemctl", "--user", "show-environment"], "Run setup inside your Linux Mint desktop session."),
    ]
    for args, message in checks:
        try:
            subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           check=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            return message
    return None

def setup():
    if os.geteuid() == 0:
        dialog("--error", "Run setup as your normal desktop user, not root.")
        return 1
    state = Path.home() / ".local" / "state" / "ars-hardware"
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / "setup.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            dialog("--error", "Another setup is already running.")
            return 1
        project = Path.home()/".local/share/ars-hardware/project"
        marker = state/"setup-incomplete"
        if project.exists() or project.is_symlink():
            if not (marker.is_file() and marker.read_text() == str(ROOT) and project.resolve() == ROOT):
                dialog("--error", "An installation already exists. Use maintenance or update tools instead.")
                return 1
            if not dialog("--question", "Resume interrupted installation from this same source folder?"):
                return 0
        problem = check_tools()
        if problem:
            install_missing(dialog)
            problem = check_tools()
        if problem:
            dialog("--error", problem + " Setup will not change Docker group membership automatically. If packages were just installed, administrator configuration or a new login may be required.")
            return 1
        if not dialog("--question", "Install ARS Distributor POS on this computer? Internet is required for first setup. Existing database volumes will not be deleted."):
            return 0
        marker.write_text(str(ROOT))
        log_path = None
        progress = None
        try:
            with tempfile.NamedTemporaryFile(prefix="setup-", suffix=".log", dir=state, delete=False) as log:
                log_path = log.name
                progress = subprocess.Popen(["zenity", "--progress", "--pulsate", "--no-cancel",
                    "--title=" + TITLE, "--text=Installing application and preparing local PostgreSQL…"],
                    stdin=subprocess.PIPE)
                subprocess.run(["bash", str(ROOT/"scripts/mint/install.sh")], cwd=ROOT,
                               stdout=log, stderr=subprocess.STDOUT, check=True)
                deadline = time.monotonic() + 180
                while time.monotonic() < deadline:
                    service = subprocess.run(["systemctl", "--user", "is-active", "--quiet", "ars-hardware.service"], check=False)
                    if service.returncode == 0 and ready():
                        break
                    time.sleep(2)
                else:
                    raise RuntimeError("Database readiness could not be confirmed.")
        except (OSError, RuntimeError, subprocess.CalledProcessError):
            if progress and progress.poll() is None:
                progress.terminate()
                progress.wait()
            dialog("--error", "Setup did not finish successfully. Existing data was not deliberately removed. Contact support with this local log: " + str(log_path))
            return 1
        finally:
            if progress and progress.poll() is None:
                progress.terminate()
                progress.wait()
        marker.unlink(missing_ok=True)
        if dialog("--question", "ARS Distributor POS is ready. Open the application now?"):
            subprocess.run(["python3", str(ROOT/"scripts/mint/open.py")], check=False)
        return 0

if __name__ == "__main__":
    if not shutil.which("zenity"):
        sys.exit("Zenity is required to display setup.")
    sys.exit(setup())
