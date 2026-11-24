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
        notice(("Operation completed. Live installation remains disabled.\n" + ("Maintenance remains active; resume the POS before billing.\n" if (STATE/"maintenance-hold.json").exists() else ""))+"Local log: "+log.name)
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

def view_history(folder,kind):
    records=[]
    if folder.is_dir() and not folder.is_symlink():
        for path in folder.glob("*.json"):
            try:
                if path.is_symlink() or not path.is_file() or path.stat().st_size>65536: continue
                data=json.loads(path.read_text())
                if not isinstance(data,dict): continue
                if kind=="cloud":
                    records.append((str(data.get("attemptedAt","Unknown")),str(data.get("phase","Unknown")),str(data.get("archive","Not created")),data))
                else:
                    records.append((str(data.get("testedAt","Unknown")),"Restored in isolation" if data.get("restoreTestPassed") is True else "Unverified",str(data.get("backup","Unknown")),data))
            except (OSError,ValueError,TypeError): continue
    records.sort(key=lambda row:row[0],reverse=True)
    records=records[:100]
    if not records:
        notice("No readable history records available.")
        return
    rows=[]
    for index,(date,status,archive,data) in enumerate(records):
        rows.extend([str(index),date,status,archive])
    selected=dialog("--list","--width=1000","--height=500","--column=ID","--column=Date (UTC)","--column=Status","--column=Archive","--hide-column=1","--print-column=1",*rows)
    index=selected.stdout.strip()
    if selected.returncode!=0 or not index.isdigit() or int(index)>=len(records): return
    date,status,archive,data=records[int(index)]
    details=[date,status,archive]
    if kind=="recovery":
        counts=data.get("counts",{})
        if isinstance(counts,dict):
            details.extend(str(key)+": "+str(value) for key,value in counts.items())
        finance=data.get("financialChecks")
        if isinstance(finance,dict):
            details.append("Financial recovery checks (restored values only):")
            for section in ("ledgerCounts","restoredTotals"):
                values=finance.get(section,{})
                if isinstance(values,dict):
                    details.extend(str(key)+": "+str(value) for key,value in values.items())
            missing=finance.get("missingTables",[])
            if isinstance(missing,list) and missing:
                details.append("Missing ledger tables: "+", ".join(map(str,missing)))
            comparison = data.get("sourceComparison", {})
            if comparison.get("status") == "matched":
                details.append(f"Original backup snapshot matched all {comparison['publicTableCount']} public tables.")
            else:
                details.append("Original backup snapshot comparison unavailable for this report.")
        details.append("Live database replacement is not approved.")
    else:
        details.append("Last verified cloud backup at this attempt: "+str(data.get("verifiedAt") or "None"))
    notice("\n".join(details))

def main():
    if os.geteuid()==0:
        raise ValueError("Run as the desktop user.")
    project=(STATE/"project").resolve(strict=True)
    with (STATE/"update-center.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        while True:
            choice=dialog("--list","--no-markup","--text="+status(project),"--column=Action","--width=640","--height=420",
                          "Prepare signed release","Prepare online recovery backup","Test isolated database restoration","Test software compatibility","View activation readiness","Stop POS and prepare protected backup","Cancel maintenance and resume POS","Rehearse disaster recovery","Google Drive backup setup","Download encrypted Drive backup","View cloud backup status","View backup history","View recovery reports","Open local recovery archive folder","Close")
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
            elif action=="Stop POS and prepare protected backup":
                if (STATE/"maintenance-hold.json").exists():
                    notice("Maintenance is already active. Review the existing backup or resume the current POS.",True)
                    continue
                version=select_version()
                if version and dialog("--question","--no-markup","--text=This will stop billing and all managed POS operations. Finish current invoices and notify staff before continuing. The POS remains stopped until you explicitly resume it. Continue?").returncode==0:
                    execute(project,"maintenance_backup.py",version,"--confirmation","STOP POS FOR BACKUP")
            elif action=="Cancel maintenance and resume POS":
                if not (STATE/"maintenance-hold.json").is_file():
                    notice("No maintenance hold to resume.")
                    continue
                if dialog("--question","--no-markup","--text=Resume the unchanged installed POS? This does not install a release or restore the database.").returncode==0:
                    execute(project,"resume_maintenance.py","--confirmation","RESUME CURRENT POS")
            elif action=="Rehearse disaster recovery":
                selected=choose_file("Select local or downloaded ARS backup .dump")
                if selected and dialog("--question","--no-markup","--text=Verify and restore this backup in a disposable isolated PostgreSQL instance? This does not replace the live database.").returncode==0:
                    execute(project,"disaster-recovery-test.py",selected)
            elif action=="Google Drive backup setup":
                option=dialog("--list","--no-markup","--text=Google Drive authorization and encryption must be configured before enabling backups. Keep the encryption recovery credentials in a secure separate location.","--column=Action","--width=640","--height=360","Configuration instructions","Validate encrypted connection","Set daily backup time","Disable daily backup","Back up now","Return")
                if option.returncode!=0: continue
                selected=option.stdout.strip()
                if selected=="Configuration instructions":
                    notice("Ask RS Nextward to configure rclone on this computer: ars-drive must be a Google Drive remote, and ars-encrypted must be a crypt remote backed by ars-drive:ARS-Backups. Authorize your own Google account. Keep the encryption password and salt securely offline. Never send them in support logs.")
                elif selected=="Validate encrypted connection":
                    execute(project,"cloud-backup-control.py","validate")
                elif selected in ("Set daily backup time","Disable daily backup","Back up now"):
                    command={"Set daily backup time":"enable","Disable daily backup":"disable","Back up now":"backup"}[selected]
                    schedule = []
                    if command == "enable":
                        answer = dialog("--entry", "--text=Daily backup time on this computer (24-hour HH:MM)", "--entry-text=20:00")
                        if answer.returncode != 0: continue
                        daily_time = answer.stdout.strip()
                        if not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", daily_time):
                            notice("Enter a time between 00:00 and 23:59.", True)
                            continue
                        schedule = ["--daily-time", daily_time]
                        selected = "Enable daily backup at " + daily_time
                    if dialog("--question","--no-markup","--text=Confirm: "+selected+"? Enabling or running backups sends encrypted business backup files to your configured Google Drive account.").returncode==0:
                        execute(project,"cloud-backup-control.py",command,*schedule)
            elif action=="View backup history":
                view_history(project/"backups/drive-history","cloud")
            elif action=="View recovery reports":
                view_history(STATE/"recovery-reports","recovery")
            elif action=="View cloud backup status":
                try:
                    data=json.loads((project/"backups/drive-status.json").read_text())
                    notice("Latest backup attempt: "+str(data.get("attemptedAt","Unknown"))+"\nLast verified cloud backup: "+str(data.get("verifiedAt") or "Not verified")+"\nStatus: "+str(data.get("phase","Unknown")))
                except (OSError,ValueError,TypeError):
                    notice("No readable cloud backup status is available.")
            elif action=="Download encrypted Drive backup":
                result=subprocess.run(["python3",str(project/"scripts/mint/download-drive-backup.py"),"--list"],cwd=project,capture_output=True,text=True)
                if result.returncode!=0:
                    notice("Cannot list encrypted backups. Check the internet connection and configured Drive remotes.",True)
                    continue
                names=result.stdout.splitlines()
                if not names:
                    notice("No encrypted backup sets found.")
                    continue
                selected=dialog("--list","--column=Encrypted backup","--width=820","--height=420",*names)
                name=selected.stdout.strip()
                if selected.returncode==0 and name in names and dialog("--question","--no-markup","--text=Download and verify a separate recovery copy? The live database will not be replaced.").returncode==0:
                    execute(project,"download-drive-backup.py","--download",name)
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
