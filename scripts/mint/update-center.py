#!/usr/bin/env python3
"""Graphical update preparation, without live activation or automatic rollback."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import sys

STATE=Path.home()/".local/share/ars-hardware"
TITLE="RS Nextward | ARS Distributor Update Center"
VERSION=re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?")

def dialog(*args):
    return subprocess.run(["zenity","--title="+TITLE,*args],capture_output=True,text=True)

def notice(message,error=False):
    dialog("--error" if error else "--info","--no-markup","--text="+message)

def choose_file(message):
    result=dialog("--file-selection","--filename="+str(Path.home())+"/","--title="+message)
    return result.stdout.strip() if result.returncode==0 else None

def select_version():
    root=STATE/"staged-releases"
    versions=sorted(p.name for p in root.iterdir() if p.is_dir() and not p.is_symlink() and VERSION.fullmatch(p.name)) if root.is_dir() else []
    if not versions:
        notice("No staged release. Prepare a signed update first.")
        return None
    result=dialog("--list","--column=Staged version","--width=420","--height=300",*versions)
    return result.stdout.strip() if result.returncode==0 and result.stdout.strip() in versions else None

def select_recovery():
    root=STATE/"update-recovery"
    folders=sorted(p.name for p in root.iterdir() if p.is_dir() and not p.is_symlink() and (p/"recovery.json").is_file()) if root.is_dir() else []
    if not folders:
        notice("No recovery archives available.")
        return None
    result=dialog("--list","--column=Recovery archive","--width=820","--height=350",*folders)
    name=result.stdout.strip()
    return root/name if result.returncode==0 and name in folders else None

def execute(project,script,*args):
    logs=STATE/"update-logs"
    logs.mkdir(mode=0o700,exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix="update-",suffix=".log",dir=logs,delete=False) as log:
        progress=subprocess.Popen(["zenity","--progress","--pulsate","--no-cancel","--title="+TITLE,"--text=Preparing and verifying. Do not shut down this computer."],stdin=subprocess.PIPE)
        try:
            result=subprocess.run(["python3",str(project/"scripts/mint"/script),*args],cwd=project,stdout=log,stderr=subprocess.STDOUT)
        finally:
            if progress.poll() is None: progress.terminate()
            progress.wait()
    if result.returncode==0:
        notice("Preparation completed. Live installation remains disabled.\nLocal log: "+log.name)
    else:
        notice("Preparation failed. Existing data was not deliberately removed.\nContact RS Nextward with local log: "+log.name,True)

def status(project):
    version="Unknown"
    try:
        version=str(json.loads((project/"package.json").read_text()).get("version","Unknown"))
    except (OSError,ValueError,TypeError): pass
    held=(STATE/"maintenance-hold.json").exists() or (STATE/"maintenance-hold.json").is_symlink()
    signed=(STATE/"release-signing-public.pem").is_file()
    return "ARS Distributor — installed version "+version+"\nMaintenance: "+("Active" if held else "Not active")+"\nTrusted release key: "+("Present" if signed else "Not configured")+"\nLive installation and rollback: Disabled pending verification."

def main():
    if os.geteuid()==0:
        raise ValueError("Run as the desktop user.")
    project=(STATE/"project").resolve(strict=True)
    with (STATE/"update-center.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        while True:
            choice=dialog("--list","--no-markup","--text="+status(project),"--column=Action","--width=640","--height=420",
                          "Prepare signed release","Prepare online recovery backup","Test isolated database restoration","Test software compatibility","View activation readiness","Open local recovery archive folder","Close")
            if choice.returncode!=0 or choice.stdout.strip()=="Close": return
            action=choice.stdout.strip()
            if action=="Prepare signed release":
                if not (STATE/"release-signing-public.pem").is_file():
                    notice("Trusted release signing key is not configured. Contact RS Nextward.",True)
                    continue
                files=[]
                for prompt in ("Select signed release manifest","Select manifest signature","Select release archive"):
                    selected=choose_file(prompt)
                    if not selected: break
                    files.append(selected)
                if len(files)==3 and dialog("--question","--no-markup","--text=Verify and prepare this release? Internet may be required. The running POS will not be replaced.").returncode==0:
                    execute(project,"stage-update.py",*files)
            elif action=="Prepare online recovery backup":
                version=select_version()
                if version and dialog("--question","--no-markup","--text=Create a verified recovery backup without stopping the POS? This is not approval to install an update.").returncode==0:
                    execute(project,"prepare-update-backup.py",version)
            elif action in ("Test isolated database restoration","Test software compatibility","View activation readiness"):
                folder=select_recovery()
                if folder:
                    if action=="View activation readiness":
                        result=subprocess.run(["python3",str(project/"scripts/mint/update-switch-plan.py"),str(folder)],cwd=project,capture_output=True,text=True)
                        if result.returncode==0:
                            plan=json.loads(result.stdout[result.stdout.index("{"):])
                            notice("Installation remains disabled.\n\n"+"\n".join(plan.get("blockers",[])))
                        else:
                            notice("Readiness verification unsuccessful. Complete recovery and compatibility checks first.",True)
                    elif dialog("--question","--no-markup","--text=Run an isolated recovery test? This may use considerable memory and disk space. The live database will not be restored or replaced.").returncode==0:
                        extra=["--compatibility"] if action=="Test software compatibility" else []
                        execute(project,"test-update-restore.py",str(folder),*extra)
            elif action=="Open local recovery archive folder":
                folder=STATE/"update-recovery"
                if folder.is_dir() and not folder.is_symlink():
                    subprocess.run(["xdg-open",str(folder)],check=False)
                else: notice("No recovery archive folder yet.")

if __name__=="__main__":
    os.umask(0o077)
    try: main()
    except (OSError,ValueError,RuntimeError) as error:
        notice("Update Center unavailable: "+str(error),True)
        sys.exit(1)
