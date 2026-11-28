#!/usr/bin/env python3
"""Graphical setup and entry point to existing installation maintenance."""
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
def installed_maintenance(state):
    if os.geteuid()==0 or state.resolve(strict=True)!=state or state.stat().st_uid!=os.getuid():
        raise RuntimeError("Existing installation could not be verified.")
    pointer=state/"project"
    if not pointer.is_symlink() or pointer.lstat().st_uid!=os.getuid():
        raise RuntimeError("Existing installation is incomplete. Contact RS Nextward support.")
    project=pointer.resolve(strict=True)
    if not project.is_dir() or project.stat().st_uid!=os.getuid() or project==state or state in project.parents or project in state.parents:
        raise RuntimeError("Existing application path could not be verified.")
    script=project/"scripts/mint/maintenance-center.py"
    if script.resolve(strict=True)!=script or not script.is_file() or script.stat().st_uid!=os.getuid():
        raise RuntimeError("Installed Maintenance Center could not be verified.")
    return script,project


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
            if os.path.lexists(STATE):
                script,project=installed_maintenance(STATE)
                if dialog("--question","--no-markup",
                          "--text=An ARS installation already exists. Open its Maintenance Center to prepare a protected repair?",
                          "--ok-label=Open Maintenance Center","--cancel-label=Close")==0:
                    subprocess.run(["/usr/bin/python3",str(script)],cwd=project,check=True)
                return 0
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
            chosen=subprocess.run(["zenity","--title="+TITLE,"--file-selection","--directory","--filename="+str(Path.home())+"/"],capture_output=True,text=True)
            if chosen.returncode:
                return 0
            parent=Path(chosen.stdout.strip())
            destination=parent/"ARS Distributor"
            if not ui.page("Ready to install","Install permanently in:\n"+str(destination)+"\n\nSetup copies verified application files, creates desktop shortcuts and enables the user service. Business data is stored separately.","Install"):
                return 0
            preflight()
            from setup_destination import copy_release
            installed=copy_release(ROOT,destination)
            # Never register a runtime executable from the disposable download folder.
            old_runtime=str(ROOT/".ars-node-runtime"/"bin")
            os.environ["PATH"]=os.pathsep.join(p for p in os.environ["PATH"].split(os.pathsep) if p!=old_runtime)
            prepare_node(installed,dialog)
            ui.root=installed
            ui.install()
            if ui.page("Setup completed","Thank you for choosing RS Nextward.\n\nInstallation steps completed. Launch ARS Distributor to verify database readiness and complete first-administrator setup.","Launch ARS Distributor",cancel="Finish"):
                subprocess.run(["python3",str(installed/"scripts/mint/open.py")],check=True)
            return 0
        except (OSError,RuntimeError,ImportError,ValueError,subprocess.CalledProcessError) as error:
            dialog("--error","--no-markup","--text=Setup could not complete. Existing files and database volumes have been retained. Contact RS Nextward support; do not delete data.\n\n"+str(error))
            return 1

if __name__ == "__main__":
    raise SystemExit(main())
