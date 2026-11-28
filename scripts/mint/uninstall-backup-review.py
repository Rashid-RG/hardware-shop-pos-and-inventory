"""Review existing protected recovery evidence for uninstall planning, never authorize removal."""
import fcntl
import importlib.util
import os
from pathlib import Path
import re
from resume_maintenance import open_lock
from repair_test_build import assert_local_docker

STATE=Path.home()/".local/share/ars-hardware"
FLAGS=("applicationRemovalAllowed","databaseDeletionAllowed","serviceRemovalAllowed","uninstalled","finalUninstallBackupVerified","continuousExclusionVerified")

def load_observer():
    spec=importlib.util.spec_from_file_location("activation",Path(__file__).with_name("prepare-runtime-activation.py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def result(evidence,project,recovery):
    if evidence.get("schema")!=1 or evidence.get("previousProject")!=str(project) or evidence.get("recoveryFolder")!=str(recovery) or evidence.get("backupHoldBindingVerified") is not True:
        raise ValueError("Protected recovery identity mismatch.")
    for flag in ("activationAllowed","startupAllowed","runtimeActivated","rollbackAllowed","continuousExclusionVerified"):
        if evidence.get(flag) is not False:
            raise ValueError("Unexpected authorization.")
    hashes=evidence.get("evidence")
    if not isinstance(hashes,dict) or set(hashes)!={"hold","binding","configuration","recovery","restore","protectedBackup"} or any(not isinstance(v,str) or not re.fullmatch(r"[a-f0-9]{64}",v) for v in hashes.values()):
        raise ValueError("Incomplete recovery evidence.")
    return {"schema":1,"kind":"mint-uninstall-backup-review","installation":str(project),
            "recoveryFolder":str(recovery),"protectedUpdateBackupMatched":True,
            "evidenceDigests":hashes,**{k:False for k in FLAGS}}

def inspect(recovery):
    if os.geteuid()==0 or STATE.resolve(strict=True)!=STATE or STATE.stat().st_uid!=os.getuid():
        raise ValueError("Managed desktop user required.")
    assert_local_docker()
    observer=load_observer()
    with open_lock(STATE/"maintenance.lock") as maintenance,open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for name in ("repair-interrupted.json","runtime-switch-intent.json","runtime-activation-interrupted.json","runtime-migration-interrupted.json","switch-journal.json","handoff-pending.json"):
            if os.path.lexists(STATE/name):
                raise ValueError("Unresolved maintenance incident.")
        project=(STATE/"project").resolve(strict=True)
        if recovery.parent!=STATE/"update-recovery" or recovery.resolve(strict=True)!=recovery:
            raise ValueError("Managed recovery directory required.")
        evidence=observer.snapshot(recovery)
        plan=result(evidence,project,recovery)
        if observer.snapshot(recovery)!=evidence or (STATE/"project").resolve(strict=True)!=project:
            raise ValueError("Recovery evidence changed.")
        return plan
