"""Cancel dedicated uninstall preparation without changing business data.

Release the ordinary startup block only after durable cancellation evidence.
No automatic startup: use the normal launcher after successful cancellation.
"""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from desktop_registration import review as review_registration, desktop_path
from installation_identity import review, digest
from maintenance_backup import stopped, check_database_clients, UNIT
from repair_interruption import read_regular
from repair_test_build import assert_local_docker
from resume_maintenance import open_lock
from startup_guard import startup_allowed, migration_mapping_valid
from switch_journal import sync_dir
from uninstall_shutdown import validate_service, retain

STATE=Path.home()/".local/share/ars-hardware"
CONFIRMATION="CANCEL UNINSTALL AND KEEP POS"
INCIDENTS=("runtime-switch-intent.json","runtime-activation-interrupted.json","handoff-pending.json","runtime-migration-interrupted.json","repair-interrupted.json","switch-journal.json")

def validate(hold_raw,proof_raw,project,confirmation):
    if confirmation!=CONFIRMATION:
        raise ValueError("Explicit cancellation approval required.")
    hold,proof=json.loads(hold_raw),json.loads(proof_raw)
    uid=hold.get("uninstallId")
    if hold.get("schema")!=1 or hold.get("purpose")!="pre-uninstall backup" or hold.get("previousProject")!=str(project) or not isinstance(uid,str) or not re.fullmatch(r"[a-f0-9]{32}",uid):
        raise ValueError("Matching uninstall hold required.")
    if proof.get("schema")!=1 or proof.get("kind")!="mint-uninstall-shutdown-observation" or proof.get("uninstallId")!=uid or proof.get("previousProject")!=str(project) or proof.get("holdDigest")!=hashlib.sha256(hold_raw).hexdigest():
        raise ValueError("Matching shutdown evidence required.")
    for flag in ("serviceStopped","ordinaryStartupBlocked","databaseClientsAbsentAtCheck"):
        if proof.get(flag) is not True:
            raise ValueError("Shutdown verification incomplete.")
    for flag in ("applicationRemovalAllowed","databaseDeletionAllowed"):
        if hold.get(flag) is not False or proof.get(flag) is not False:
            raise ValueError("Unexpected removal authorization.")
    for flag in ("continuousExclusionVerified","finalUninstallBackupVerified"):
        if proof.get(flag) is not False:
            raise ValueError("Unexpected final authorization.")
    return uid

def archive_bytes(path,raw):
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),"wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())

def cancel(confirmation):
    if os.geteuid()==0 or confirmation!=CONFIRMATION or STATE.resolve(strict=True)!=STATE or STATE.stat().st_uid!=os.getuid():
        raise ValueError("Explicit desktop-user cancellation required.")
    assert_local_docker()
    with open_lock(STATE/"maintenance.lock") as maintenance,open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        project=(STATE/"project").resolve(strict=True)
        hold=STATE/"maintenance-hold.json"
        proof=STATE/"uninstall-shutdown.json"
        raw_hold,raw_proof=read_regular(hold),read_regular(proof)
        uid=validate(raw_hold,raw_proof,project,confirmation)
        def check():
            if any(os.path.lexists(STATE/name) for name in INCIDENTS) or not migration_mapping_valid(STATE):
                raise ValueError("Unresolved maintenance incident.")
            if (STATE/"project").resolve(strict=True)!=project or read_regular(hold)!=raw_hold or read_regular(proof)!=raw_proof:
                raise ValueError("Maintenance evidence changed.")
            review(STATE,project)
            review_registration(Path.home(),desktop_path(),project)
            unit=Path.home()/".config/systemd/user/ars-hardware.service"
            output=subprocess.run(["systemctl","--user","show",UNIT,"--property=LoadState,FragmentPath,DropInPaths,NeedDaemonReload"],check=True,capture_output=True,text=True,timeout=15).stdout
            validate_service(dict(line.split("=",1) for line in output.splitlines() if "=" in line),unit)
            for name in ("startup_guard.py","interrupted_switch.py"):
                if digest(STATE/"update-tools"/name)!=digest(project/"scripts/mint"/name):
                    raise ValueError("Installed startup guard changed.")
            stopped()
            check_database_clients(project)
        check()
        history=STATE/("uninstall-cancelled-"+uid)
        history.mkdir(mode=0o700)
        archive_bytes(history/hold.name,raw_hold)
        archive_bytes(history/proof.name,raw_proof)
        if read_regular(history/hold.name)!=raw_hold or read_regular(history/proof.name)!=raw_proof:
            raise ValueError("Archived evidence differs.")
        record={"schema":1,"kind":"mint-uninstall-cancellation","uninstallId":uid,
                "previousProject":str(project),"cancelledAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "holdDigest":hashlib.sha256(raw_hold).hexdigest(),"shutdownDigest":hashlib.sha256(raw_proof).hexdigest(),
                "backupArchivesRetained":True,"databaseRestored":False,"releaseSwitched":False,
                "applicationRemovalAllowed":False,"applicationStarted":False}
        retain(history/"cancellation.json",record)
        sync_dir(STATE)
        check()
        # Archive first, clear proof first, clear startup block last.
        # A crash between the two unlinks leaves startup blocked.
        proof.unlink()
        sync_dir(STATE)
        if read_regular(hold)!=raw_hold or any(os.path.lexists(STATE/name) for name in INCIDENTS):
            raise ValueError("Maintenance evidence changed; hold retained.")
        hold.unlink()
        sync_dir(STATE)
        if not startup_allowed(STATE):
            archive_bytes(hold,raw_hold)
            sync_dir(STATE)
            raise ValueError("Startup remains blocked; manual review required.")
        return record
# Internal until end-to-end cancellation and backup orchestration are rehearsed.
