#!/usr/bin/env python3
"""Graphical update preparation, without live activation or automatic rollback."""
import fcntl
import hashlib
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
        notice(("Operation completed. Live installation remains disabled.\n" + ("Maintenance remains active. Resolve all blocking evidence before resuming billing.\n" if (STATE/"maintenance-hold.json").exists() else ""))+"Local log: "+log.name)
    else:
        notice("Preparation failed. Existing data was not deliberately removed.\nContact RS Nextward with local log: "+log.name,True)

def check_signed_feed(project):
    feed_file=STATE/"release-feed-url.txt"
    trust=STATE/"release-signing-public.pem"
    if any(path.is_symlink() or not path.is_file() for path in (feed_file,trust)):
        notice("The trusted update feed and release key must be configured by RS Nextward.",True)
        return
    try:
        with feed_file.open() as source:
            feed=source.read(2049).strip()
        version=json.loads((project/"package.json").read_text())["version"]
        if not feed or len(feed)>2048:
            raise ValueError("Invalid update feed.")
    except (OSError,ValueError,KeyError,TypeError):
        notice("The trusted update feed configuration is invalid.",True)
        return
    command=[str(STATE/"node"),str(project/"scripts/download-signed-update.mjs"),
             feed,"linux-mint",version,str(trust)]

    def run_feed(message,*args):
        progress=subprocess.Popen(["zenity","--progress","--pulsate","--no-cancel",
                                   "--title="+TITLE,"--text="+message],stdin=subprocess.PIPE)
        try:
            result=subprocess.run([*command,*args],cwd=project,capture_output=True,text=True,
                                  check=True,timeout=340)
            return json.loads(result.stdout)
        finally:
            if progress.poll() is None:
                progress.terminate()
            progress.wait()

    try:
        release=run_feed("Checking the signed update feed.")
        if release.get("available") is not True:
            notice("No newer signed update is available for this release.")
            return
        found=release["version"]
        if dialog("--question","--no-markup","--text=Download and prepare signed update "+found+"?",
                  "--ok-label=Download and prepare","--cancel-label=Cancel").returncode!=0:
            return
        with tempfile.TemporaryDirectory(prefix="ars-update-download-") as temporary:
            bundle=Path(temporary)/"bundle"
            downloaded=run_feed("Downloading and verifying the signed update.",str(bundle))
            if downloaded.get("available") is not True or downloaded.get("version")!=found:
                notice("The feed changed. Check for updates again before preparing a release.",True)
                return
            execute(project,"stage-update.py",*(str(bundle/name) for name in
                    ("manifest.json","manifest.sig","release.tar.gz")))
    except (OSError,ValueError,KeyError,subprocess.SubprocessError):
        notice("The update feed could not be verified or downloaded. Check the feed configuration and connection.",True)


def switch_intent_review(project):
    """Review or cancel intent without changing the installed release."""
    while True:
        target=STATE/"runtime-switch-intent.json"
        exists=target.exists() or target.is_symlink()
        actions=["Verify switch intent","Cancel switch intent"] if exists else ["Retain switch intent"]
        answer=dialog("--list","--no-markup","--text=Live installation remains locked. Cancellation does not resume billing.","--column=Action","--width=620","--height=300",*actions,"Return")
        action=answer.stdout.strip()
        if answer.returncode!=0 or action=="Return": return
        if action not in actions: continue
        folder=select_recovery()
        if not folder: continue
        extra=["--verify"]
        if action=="Retain switch intent":
            if dialog("--question","--no-markup","--text=Retain switch intent? Normal startup remains blocked until resolved. This does not install an update.").returncode!=0: continue
            extra=["--confirmation","RETAIN MINT SWITCH INTENT"]
        elif action=="Cancel switch intent":
            if dialog("--question","--no-markup","--text=Cancel the retained intent and preserve its original evidence? Maintenance remains active. Billing will not resume.").returncode!=0: continue
            extra=["--cancel","--confirmation","CANCEL MINT SWITCH INTENT"]
        progress=subprocess.Popen(["zenity","--progress","--pulsate","--no-cancel","--title="+TITLE,"--text=Verifying retained update evidence."],stdin=subprocess.PIPE)
        try:
            result=subprocess.run(["python3",str(project/"scripts/mint/prepare-switch-intent.py"),str(folder),*extra],cwd=project,capture_output=True,text=True,timeout=900)
            data=json.loads(result.stdout.strip().splitlines()[-1]) if result.returncode==0 else {}
            cancelled=action=="Cancel switch intent"
            matched=isinstance(data,dict) and data.get("schema")==1 and all(data.get(k) is False for k in ("activationAllowed","startupAllowed","rollbackAllowed","runtimeActivated")) and isinstance(data.get("intentDigest"),str) and re.fullmatch(r"[a-f0-9]{64}",data["intentDigest"]) and ((data.get("intentCancelled") is True and data.get("maintenanceRetained") is True) if cancelled else data.get("intentMatched") is True)
        except (OSError,ValueError,IndexError,subprocess.SubprocessError):
            matched=False
        finally:
            if progress.poll() is None: progress.terminate()
            progress.wait()
        if matched:
            notice("Intent cancelled; original evidence retained. Maintenance remains active." if cancelled else "Switch intent verified. Live installation remains locked.")
        else:
            notice("Switch intent operation blocked or unverified. Contact RS Nextward before resuming billing.",True)

def authenticated_incident_review(project,folder,mode):
    if mode not in ("record","verify"):
        return
    accounts=[]
    for role in ("Operator Super Admin","Reviewer Super Admin"):
        email=dialog("--entry","--no-markup","--text="+role+" email")
        if email.returncode!=0: return
        password=dialog("--entry","--hide-text","--no-markup","--text="+role+" password")
        if password.returncode!=0: return
        accounts.append({"email":email.stdout.rstrip("\n"),"password":password.stdout.rstrip("\n")})
    payload={"recoveryId":folder.name,"mode":mode,"confirmation":"REVIEW ACTIVATION INCIDENT","operator":accounts[0],"reviewer":accounts[1]}
    progress=subprocess.Popen(["zenity","--progress","--pulsate","--no-cancel","--title="+TITLE,"--text=Verifying administrators and retained evidence. Do not shut down."],stdin=subprocess.PIPE)
    matched=False
    try:
        result=subprocess.run([str(STATE/"node"),str(project/"scripts/activation-incident-review-cli.mjs")],cwd=project,input=json.dumps(payload),capture_output=True,text=True,timeout=1900)
        data=json.loads(result.stdout) if result.returncode==0 else {}
        expected="activation-observation-retained" if mode=="record" else "activation-observation-matched"
        matched=isinstance(data,dict) and data.get("state")==expected and data.get("freshCredentialsRequired") is True and all(data.get(k) is False for k in ("activationAllowed","startupAllowed","rollbackAllowed","runtimeActivated","recoveryAllowed","continuousExclusionVerified"))
    except (OSError,ValueError,subprocess.SubprocessError):
        pass
    finally:
        accounts.clear()
        payload.clear()
        if progress.poll() is None: progress.terminate()
        progress.wait()
    notice("Authenticated review recorded or matched. Incident retained; startup remains locked." if matched else "Authenticated review blocked. Contact RS Nextward support. No incident cleared.",not matched)

def activation_review(project):
    """Dedicated graphical proposal review; no activation or resume operation."""
    while True:
        if os.path.lexists(STATE/"runtime-activation-interrupted.json"):
            choice=dialog("--list","--no-markup","--text=Interrupted activation retained. Startup remains locked.","--column=Action","Review evidence","Record authenticated review","Verify authenticated review","Return")
            action=choice.stdout.strip()
            if choice.returncode!=0 or action not in ("Review evidence","Record authenticated review","Verify authenticated review"): return
            folder=select_recovery()
            if not folder: return
            if action=="Review evidence":
                execute(project,"prepare-runtime-activation.py",str(folder),"--review-incident")
            else:
                authenticated_incident_review(project,folder,"record" if action=="Record authenticated review" else "verify")
            return
        target=STATE/"runtime-activation-proposal.json"
        exists=target.exists() or target.is_symlink()
        held=(STATE/"maintenance-hold.json").exists() or (STATE/"maintenance-hold.json").is_symlink()
        summary=("Maintenance: "+("Active" if held else "Not active")+
                 "\nRetained proposal: "+("Present (not yet verified)" if exists else "Not prepared")+
                 "\nLive installation: Locked")
        choice=dialog("--list","--no-markup","--text="+summary,"--column=Action","--width=620","--height=300",
                      "Prepare activation proposal","Verify retained proposal","Switch intent review","Return")
        if choice.returncode!=0 or choice.stdout.strip()=="Return": return
        action=choice.stdout.strip()
        if action=="Switch intent review":
            switch_intent_review(project)
            continue
        if action not in ("Prepare activation proposal","Verify retained proposal"): continue
        if not held:
            notice("A protected maintenance backup is required. No change was made.",True)
            continue
        if action=="Prepare activation proposal" and exists:
            notice("An existing proposal must be retained. Verify it or contact RS Nextward support.",True)
            continue
        if action=="Verify retained proposal" and not exists:
            notice("No retained activation proposal exists.",True)
            continue
        folder=select_recovery()
        if not folder: continue
        if action=="Prepare activation proposal":
            answer=dialog("--question","--no-markup","--text=Retain a fingerprinted activation proposal for this protected backup? This does not install an update, resume billing or restore any live data.")
            if answer.returncode!=0: continue
            extra=["--confirmation","PREPARE MINT ACTIVATION"]
        else:
            extra=["--verify"]
        progress=subprocess.Popen(["zenity","--progress","--pulsate","--no-cancel","--title="+TITLE,"--text=Checking maintenance, database identity, backup and compatibility evidence."],stdin=subprocess.PIPE)
        try:
            result=subprocess.run(["python3",str(project/"scripts/mint/prepare-runtime-activation.py"),str(folder),*extra],cwd=project,capture_output=True,text=True,timeout=900)
            data=None
            if result.returncode==0:
                try:
                    data=json.loads(result.stdout.strip().splitlines()[-1])
                except (ValueError,IndexError): pass
            matched=isinstance(data,dict) and data.get("proposalMatched") is True and data.get("backupHoldBindingVerified") is True and all(data.get(k) is False for k in ("activationAllowed","runtimeActivated","startupAllowed","rollbackAllowed","continuousExclusionVerified")) and isinstance(data.get("proposalDigest"),str) and re.fullmatch(r"[a-f0-9]{64}",data["proposalDigest"])
        except (OSError,subprocess.SubprocessError):
            matched=False
        finally:
            if progress.poll() is None: progress.terminate()
            progress.wait()
        if matched:
            notice("Activation proposal verified.\nMaintenance backup and database identity matched.\nContinuous writer exclusion is not certified.\nLive installation and rollback remain locked.")
        else:
            notice("Proposal preparation or verification blocked. Check protected backup and compatibility evidence or contact RS Nextward. No live activation was requested.",True)

def runtime_migration_center(project):
    """Graphical entry points; underlying tools enforce maintenance and evidence checks."""
    while True:
        interrupted=os.path.lexists(STATE/"runtime-migration-interrupted.json")
        staged=os.path.lexists(STATE/"runtime-migration-staged")
        held=os.path.lexists(STATE/"maintenance-hold.json")
        actions=["Inspect runtime storage"]
        if interrupted:
            actions.append("Recover interrupted mapping")
        elif held and staged:
            actions.append("Map verified runtime")
        elif held and not os.path.lexists(STATE/"runtime"):
            actions.append("Stage legacy runtime")
        choice=dialog("--list","--no-markup","--text=Permanent runtime migration\\nMaintenance: "+("Active" if held else "Not active")+"\\nOriginal files are retained. Mapping never starts billing.","--column=Action","--width=640","--height=360",*actions,"Return")
        action=choice.stdout.strip()
        if choice.returncode!=0 or action=="Return": return
        if action not in actions: continue
        if action=="Inspect runtime storage":
            try:
                result=subprocess.run(["python3",str(project/"scripts/mint/runtime-layout.py"),str(project),"--inventory"],cwd=project,capture_output=True,text=True,timeout=30)
                data=json.loads(result.stdout) if result.returncode==0 else {}
                entries=data.get("entries",[])
                if data.get("kind")!="mint-runtime-migration-inventory" or len(entries)!=3:
                    raise ValueError("Invalid inventory")
                notice("\\n".join(str(e["name"])+": "+str(e["status"]) for e in entries)+"\\nNo data moved.")
            except (OSError,ValueError,TypeError,KeyError,subprocess.SubprocessError):
                notice("Runtime assessment unavailable. Contact RS Nextward.",True)
            continue
        args=[]
        if action=="Stage legacy runtime":
            folder=select_recovery()
            if not folder: continue
            args=["--stage",str(folder),"--confirmation","STAGE RUNTIME MIGRATION"]
            message="Prepare a private verified copy using the selected protected and restoration-tested backup?"
        elif action=="Map verified runtime":
            args=["--map-staged","--confirmation","MAP VERIFIED RUNTIME"]
            message="Map verified files to permanent storage? Original files are retained. POS remains stopped."
        else:
            args=["--recover-mapping","--confirmation","RECOVER RUNTIME MAPPING"]
            message="Continue the interrupted offline mapping? POS remains stopped. Conflicting evidence requires support."
        if dialog("--question","--no-markup","--text="+message).returncode==0:
            execute(project,"runtime-layout.py",str(project),*args)

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

def offline_release_center(project):
    """Offline selection and rollback only; never start a candidate."""
    journal=STATE/"switch-journal.json"
    hold=STATE/"maintenance-hold.json"
    target=STATE/"runtime-switch-intent.json"
    if not hold.is_file() or hold.is_symlink():
        notice("A protected maintenance hold is required.",True)
        return
    actions=[]
    tool_project=project
    observed=None
    if os.path.lexists(journal):
        try:
            records={}
            for name,path in (("journal",journal),("hold",hold),("intent",target)):
                if path.is_symlink() or not path.is_file():
                    raise ValueError("Invalid recovery record")
                with path.open("rb") as stream:
                    raw=stream.read(65537)
                if not raw or len(raw)>65536:
                    raise ValueError("Invalid recovery record length")
                records[name]=raw
            data=json.loads(records["journal"])
            protected=json.loads(records["hold"])
            intent=json.loads(records["intent"])
            binding=intent["binding"]
            version=binding["candidateVersion"]
            candidate=STATE/"staged-releases"/version
            if (data.get("schema")!=1 or data.get("kind")!="mint-offline-release-selection" or
                data.get("startupAllowed") is not False or intent.get("observationOnly") is not True or
                not VERSION.fullmatch(version) or data["candidate"]!=str(candidate) or
                data["switchId"]!=intent["switchId"] or protected.get("purpose")!="pre-update backup" or
                data["previous"]!=protected["previousProject"] or data["previous"]!=binding["previousProject"] or
                data["intentDigest"]!=hashlib.sha256(records["intent"]).hexdigest() or
                data["maintenanceDigest"]!=hashlib.sha256(records["hold"]).hexdigest() or
                data["maintenanceDigest"]!=binding["maintenanceDigest"]):
                raise ValueError("Recovery evidence does not match")
            tool_project=Path(protected["previousProject"])
            selector=tool_project/"scripts/mint/select-offline-release.py"
            active=(STATE/"project").resolve(strict=True)
            if (not tool_project.is_absolute() or tool_project==candidate or
                tool_project.resolve(strict=True)!=tool_project or candidate.resolve(strict=True)!=candidate or
                active not in (tool_project,candidate) or active!=project or
                selector.resolve(strict=True)!=selector or not selector.is_file()):
                raise ValueError("Unexpected release layout")
            # Bind the selected recovery entry point to this operator review.
            # This is a change detector, not a signed release attestation.
            with selector.open("rb") as stream:
                selector_bytes=stream.read(1048577)
            if len(selector_bytes)>1048576:
                raise ValueError("Recovery tool exceeds size limit")
            observed=((journal,records["journal"]),(hold,records["hold"]),(target,records["intent"]),(selector,selector_bytes))
            phase=data.get("phase")
            if phase in ("backup-verified","switched","offline-rollback-pending"):
                actions=["Return to previous release"]
            elif phase=="offline-rolled-back":
                actions=["Finalize offline rollback"]
            else:
                raise ValueError("Unsupported phase")
        except (OSError,ValueError,TypeError,KeyError,AttributeError,RuntimeError):
            notice("Unresolved switch evidence. Contact RS Nextward.",True)
            return
    elif target.is_file() and not target.is_symlink():
        actions=["Select verified release offline"]
    if not actions:
        notice("Prepare a verified switch intent first.")
        return
    choice=dialog("--list","--no-markup","--text=Offline release operations only. Billing remains stopped.","--column=Action","--width=640","--height=300",*actions,"Return")
    action=choice.stdout.strip()
    if choice.returncode!=0 or action not in actions:
        return
    if action=="Select verified release offline":
        folder=select_recovery()
        if not folder:
            return
        args=[str(folder),"--confirmation","SELECT OFFLINE RELEASE"]
        message="Select the verified candidate? Billing stays stopped. The previous release is retained."
    elif action=="Return to previous release":
        args=["--rollback-offline","--confirmation","ROLL BACK OFFLINE RELEASE"]
        message="Return to the previous software version? No database restoration or startup will occur."
    else:
        args=["--finalize-rollback","--confirmation","FINALIZE OFFLINE ROLLBACK"]
        message="Archive verified rollback evidence? Maintenance remains active until you separately resume the previous POS."
    if dialog("--question","--no-markup","--text="+message).returncode==0:
        if observed is not None:
            try:
                for path,original in observed:
                    if path.is_symlink() or not path.is_file():
                        raise ValueError("Invalid recovery record")
                    with path.open("rb") as stream:
                        if stream.read(len(original)+1)!=original:
                            raise ValueError("Recovery evidence changed")
                if (STATE/"project").resolve(strict=True)!=project or selector.resolve(strict=True)!=selector:
                    raise ValueError("Release layout changed")
            except (OSError,ValueError,RuntimeError):
                notice("Switch evidence changed. Reopen the Update Center for review.",True)
                return
        execute(tool_project,"select-offline-release.py",*args)
        # Exit this center so subsequent operations re-resolve the active project.

def main():
    if os.geteuid()==0:
        raise ValueError("Run as the desktop user.")
    with (STATE/"update-center.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        while True:
            project=(STATE/"project").resolve(strict=True)
            if os.path.lexists(STATE/"switch-journal.json"):
                offline_release_center(project)
                return
            choice=dialog("--list","--no-markup","--text="+status(project),"--column=Action","--width=640","--height=420",
                          "Check for signed updates","Prepare signed release","Prepare online recovery backup","Test isolated database restoration","Test software compatibility","View activation readiness","Activation Review Center","Offline Release Center","Runtime Migration Center","Stop POS and prepare protected backup","Cancel maintenance and resume POS","Rehearse disaster recovery","Google Drive backup setup","Download encrypted Drive backup","View cloud backup status","View backup history","View recovery reports","Open Recovery Center","Register healthy database identity","Open local recovery archive folder","Close")
            if choice.returncode!=0 or choice.stdout.strip()=="Close": return
            action=choice.stdout.strip()
            if action=="Check for signed updates":
                check_signed_feed(project)
            elif action=="Prepare signed release":
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
            elif action=="Activation Review Center":
                activation_review(project)
            elif action=="Offline Release Center":
                offline_release_center(project)
            elif action=="Runtime Migration Center":
                runtime_migration_center(project)
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
            elif action in ("Open Recovery Center","Register healthy database identity"):
                script={"Open Recovery Center":"recovery-center.py","Register healthy database identity":"database-binding.py"}[action]
                subprocess.run(["python3",str(project/"scripts/mint"/script)],cwd=project,check=False)
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
