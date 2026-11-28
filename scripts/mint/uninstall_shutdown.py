"""Internal protected uninstall shutdown. No deletion, restore or automatic resume.

Do not expose in the wizard until the dedicated resume/recovery path is tested.
"""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
from desktop_registration import review as review_registration, desktop_path
from installation_identity import review, digest
from maintenance_backup import stopped, check_database_clients, UNIT
from repair_test_build import assert_local_docker
from resume_maintenance import open_lock
from startup_guard import startup_allowed
from switch_journal import sync_dir

STATE=Path.home()/".local/share/ars-hardware"
CONFIRMATION="STOP POS FOR UNINSTALL BACKUP"

def make_hold(project,version,confirmation):
    if confirmation!=CONFIRMATION:
        raise ValueError("Explicit shutdown confirmation required.")
    if not isinstance(version,str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?",version):
        raise ValueError("Invalid installed version.")
    return {"schema":1,"purpose":"pre-uninstall backup","previousProject":str(project),
            "version":version,"uninstallId":uuid.uuid4().hex,
            "createdAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "applicationRemovalAllowed":False,"databaseDeletionAllowed":False}

def retain(path,record):
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),"w") as stream:
        json.dump(record,stream,sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    sync_dir(path.parent)

def validate_service(values,unit):
    if values.get("LoadState")!="loaded" or values.get("FragmentPath")!=str(unit) or values.get("DropInPaths")!="" or values.get("NeedDaemonReload")!="no":
        raise ValueError("Managed service definition is not confirmed.")

def shutdown(confirmation):
    if os.geteuid()==0 or confirmation!=CONFIRMATION:
        raise ValueError("Explicit desktop-user shutdown approval required.")
    if STATE.resolve(strict=True)!=STATE or STATE.stat().st_uid!=os.getuid():
        raise ValueError("Managed desktop state required.")
    assert_local_docker()
    with open_lock(STATE/"maintenance.lock") as maintenance,open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        project=(STATE/"project").resolve(strict=True)
        if not startup_allowed(STATE) or os.path.lexists(STATE/"switch-journal.json") or os.path.lexists(STATE/"uninstall-shutdown.json"):
            raise ValueError("Existing maintenance evidence requires review.")
        review(STATE,project)
        review_registration(Path.home(),desktop_path(),project)
        unit=Path.home()/".config/systemd/user/ars-hardware.service"
        output=subprocess.run(["systemctl","--user","show",UNIT,"--property=LoadState,FragmentPath,DropInPaths,NeedDaemonReload"],check=True,capture_output=True,text=True,timeout=15).stdout
        validate_service(dict(line.split("=",1) for line in output.splitlines() if "=" in line),unit)
        for name in ("startup_guard.py","interrupted_switch.py"):
            if digest(STATE/"update-tools"/name)!=digest(project/"scripts/mint"/name):
                raise ValueError("Installed startup guard differs.")
        metadata=project/"package.json"
        if metadata.stat().st_size>1048576:
            raise ValueError("Invalid installed package metadata.")
        version=json.loads(metadata.read_text()).get("version")
        record=make_hold(project,version,confirmation)
        hold=STATE/"maintenance-hold.json"
        retain(hold,record)
        saved=digest(hold)
        # Any failure after this point retains the hold; no implicit restart.
        if startup_allowed(STATE):
            raise RuntimeError("Maintenance startup guard failed.")
        subprocess.run(["systemctl","--user","stop",UNIT],check=True,timeout=180)
        stopped()
        check_database_clients(project)
        if digest(hold)!=saved or (STATE/"project").resolve(strict=True)!=project or startup_allowed(STATE):
            raise ValueError("Maintenance evidence changed.")
        review(STATE,project)
        review_registration(Path.home(),desktop_path(),project)
        proof={"schema":1,"kind":"mint-uninstall-shutdown-observation","uninstallId":record["uninstallId"],
               "previousProject":str(project),"holdDigest":saved,"serviceStopped":True,
               "ordinaryStartupBlocked":True,"databaseClientsAbsentAtCheck":True,
               "applicationRemovalAllowed":False,"databaseDeletionAllowed":False,
               "continuousExclusionVerified":False,"finalUninstallBackupVerified":False}
        retain(STATE/"uninstall-shutdown.json",proof)
        return proof

# No CLI entry point while safe cancellation and final backup orchestration are pending.
