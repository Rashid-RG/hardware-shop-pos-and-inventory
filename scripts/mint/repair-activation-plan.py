"""Retain a non-authorizing repair activation plan. Never switch application files."""
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
from repair_interruption import FLAGS,read_regular,sync_dir
from resume_maintenance import open_lock

STATE=Path.home()/".local/share/ars-hardware"

def load_rollback():
    spec=importlib.util.spec_from_file_location("repair_rollback",Path(__file__).with_name("repair-rollback-preparation.py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def validate(raw,observed):
    record=json.loads(raw)
    if not isinstance(record,dict) or record!=observed or record.get("kind")!="mint-repair-rollback-preparation" or record.get("repairSpecificRollbackTested") is not True or record.get("continuousExclusionVerified") is not False or any(record.get(k) is not False for k in FLAGS):
        raise ValueError("Rollback preparation missing, stale or authorizing.")
    return hashlib.sha256(raw).hexdigest()

def make_plan(raw,observed,repair):
    digest=validate(raw,observed)
    return {"schema":1,"kind":"mint-repair-activation-plan","observationOnly":True,
            "repairFolder":repair.name,"rollbackReceiptDigest":digest,
            "previousProject":observed["previousProject"],
            "previousBuildFingerprint":observed["previousBuildFingerprint"],
            "repairBuildFingerprint":observed["repairBuildFingerprint"],
            "archiveSha256":observed["archiveSha256"],
            "repairEvidenceDigests":observed["repairEvidenceDigests"],
            "continuousExclusionVerified":False,"nativeHostRepairCertified":False,
            "fileSwitchAllowed":False,**FLAGS}

def prepare(repair,verify=False):
    if os.geteuid()==0 or STATE.resolve(strict=True)!=STATE or STATE.stat().st_uid!=os.getuid():
        raise ValueError("Desktop user required.")
    rollback=load_rollback()
    with open_lock(STATE/"maintenance.lock") as maintenance,open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        observed=rollback.observe(repair)
        receipt=repair/"rollback-preparation.json"
        raw=read_regular(receipt)
        plan=make_plan(raw,observed,repair)
        target=repair/"activation-plan.json"
        if verify:
            if json.loads(read_regular(target))!=plan:
                raise ValueError("Activation plan mismatch.")
        else:
            if os.path.lexists(target):
                raise ValueError("Existing activation plan must be retained.")
        if rollback.observe(repair)!=observed or read_regular(receipt)!=raw:
            raise ValueError("Repair prerequisites changed.")
        if not verify:
            with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),"w") as stream:
                json.dump(plan,stream,sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            sync_dir(repair)
        if json.loads(read_regular(target))!=plan:
            raise ValueError("Activation plan could not be verified.")
        return plan

def main():
    title="RS Nextward | Repair activation plan"
    def dialog(*args):
        return subprocess.run(["zenity","--title="+title,*args],capture_output=True,text=True)
    selected=dialog("--file-selection","--directory","--filename="+str(STATE)+"/")
    if selected.returncode:
        return
    repair=Path(selected.stdout.strip())
    try:
        prepare(repair,verify=os.path.lexists(repair/"activation-plan.json"))
        dialog("--info","--no-markup","--text=Repair activation plan verified. This is evidence only. File switching, startup and rollback remain locked.")
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        dialog("--error","--no-markup","--text=Repair plan blocked. Missing, stale or altered evidence. No repair applied.")

if __name__=="__main__":
    main()
