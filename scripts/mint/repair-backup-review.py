"""Bind existing protected backup observations to an isolated repair preparation.
This is review evidence only, not permission to repair or start the application.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
from resume_maintenance import open_lock

STATE=Path.home()/".local/share/ars-hardware"

def load_observer():
    spec=importlib.util.spec_from_file_location("activation",Path(__file__).with_name("prepare-runtime-activation.py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def validate_repair(folder, project, observer):
    if folder.parent!=STATE or not re.fullmatch(r"repair-preparation-[A-Za-z0-9_-]+",folder.name):
        raise ValueError("Managed repair folder required.")
    observer.plain(folder,True)
    raw=observer.read(folder/"repair-preparation.json")
    record=json.loads(raw)
    candidate=folder/"candidate"
    observer.plain(candidate,True)
    if record.get("schema")!=1 or record.get("candidate")!=str(candidate) or record.get("sourceVerified") is not True or any(record.get(k) is not False for k in ("backupVerified","activationAllowed","startupAllowed","repairApplied")):
        raise ValueError("Invalid repair preparation.")
    manifest=observer.read(project/"PILOT-FILES.json",maximum=16*1024*1024)
    if observer.read(candidate/"PILOT-FILES.json",maximum=16*1024*1024)!=manifest or observer.sha(manifest)!=record.get("manifestSha256"):
        raise ValueError("Repair manifest changed.")
    if observer.read(candidate/"PILOT-RELEASE.json")!=observer.read(project/"PILOT-RELEASE.json"):
        raise ValueError("Repair release changed.")
    for name,entry in json.loads(manifest).items():
        path=candidate/name
        if not path.is_relative_to(candidate) or Path(name).is_absolute() or ".." in Path(name).parts:
            raise ValueError("Invalid manifest path.")
        observer.plain(path)
        with path.open("rb") as stream:
            if hashlib.file_digest(stream,"sha256").hexdigest()!=entry.get("sha256"):
                raise ValueError("Candidate file changed.")
    return observer.sha(raw),observer.sha(manifest)

def observe(repair,recovery):
    if os.geteuid()==0:
        raise ValueError("Desktop user required.")
    observer=load_observer()
    observer.plain(STATE,True)
    with open_lock(STATE/"maintenance.lock") as maintenance,open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if os.path.lexists(STATE/"runtime-activation-interrupted.json"):
            raise ValueError("Unresolved activation incident.")
        project=(STATE/"project").resolve(strict=True)
        binding=validate_repair(repair,project,observer)
        evidence=observer.snapshot(recovery)
        if evidence.get("previousProject")!=str(project) or evidence.get("backupHoldBindingVerified") is not True or any(evidence.get(k) is not False for k in ("activationAllowed","startupAllowed","runtimeActivated","rollbackAllowed","continuousExclusionVerified")):
            raise ValueError("Unexpected backup evidence.")
        if validate_repair(repair,project,observer)!=binding or observer.snapshot(recovery)!=evidence:
            raise ValueError("Repair or backup evidence changed.")
        result={"schema":1,"kind":"repair-backup-observation","repairReceiptDigest":binding[0],"manifestDigest":binding[1],"backupObservation":evidence,"backupEvidenceMatched":True,"repairCandidateRestoreTested":False,"activationAllowed":False,"startupAllowed":False,"repairApplied":False}
        with (repair/"backup-observation.json").open("x") as stream:
            json.dump(result,stream,sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        return result

def main():
    title="RS Nextward | Repair backup review"
    def dialog(*args):
        return subprocess.run(["zenity","--title="+title,*args],capture_output=True,text=True)
    try:
        repair=dialog("--file-selection","--directory","--filename="+str(STATE)+"/","--title=Select managed repair preparation")
        if repair.returncode:
            return
        recovery=dialog("--file-selection","--directory","--filename="+str(STATE/"update-recovery")+"/","--title=Select verified maintenance recovery folder")
        if recovery.returncode:
            return
        observe(Path(repair.stdout.strip()),Path(recovery.stdout.strip()))
        dialog("--info","--no-markup","--text=Existing protected backup evidence matched. The repair candidate itself has not been restore-tested. Repair activation remains locked.")
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        dialog("--error","--no-markup","--text=Backup review blocked. A matching protected maintenance backup and tested update recovery folder are required. No repair applied.")

if __name__=="__main__":
    main()
