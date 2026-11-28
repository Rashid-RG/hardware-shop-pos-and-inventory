"""Persistent repair interruption evidence. No activation or marker clearing."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from resume_maintenance import open_lock

STATE=Path.home()/".local/share/ars-hardware"
MARKER="repair-interrupted.json"
FLAGS={"activationAllowed":False,"startupAllowed":False,"repairApplied":False,"rollbackAllowed":False}

def sync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def read_regular(path):
    if path.resolve(strict=True)!=path:
        raise ValueError("Linked evidence.")
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK),"rb") as stream:
        first=os.fstat(stream.fileno())
        if not stat.S_ISREG(first.st_mode) or first.st_uid!=os.getuid() or not 0<first.st_size<=65536:
            raise ValueError("Invalid evidence.")
        raw=stream.read(65537)
        last=os.fstat(stream.fileno())
        if len(raw)!=first.st_size or (first.st_size,first.st_mtime_ns,first.st_ctime_ns)!=(last.st_size,last.st_mtime_ns,last.st_ctime_ns):
            raise ValueError("Evidence changed.")
    return raw

def make_record(repair_name,rollback_digest):
    if not re.fullmatch(r"repair-preparation-[A-Za-z0-9_-]+",repair_name) or not re.fullmatch(r"[a-f0-9]{64}",rollback_digest):
        raise ValueError("Invalid repair identity.")
    return {"schema":1,"kind":"mint-repair-interruption","phase":"pre-activation",
            "repairFolder":repair_name,"rollbackReceiptDigest":rollback_digest,
            "desktopUid":os.getuid(),"createdAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),**FLAGS}

def retain_marker(state,record):
    # Internal primitive for a future activation coordinator holding both locks.
    # No CLI or GUI calls this function; it never authorizes a change.
    if state.resolve(strict=True)!=state or state.stat().st_uid!=os.getuid():
        raise ValueError("Invalid state directory.")
    validate_record(record)
    with os.fdopen(os.open(state/MARKER,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),"w") as stream:
        json.dump(record,stream,sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    sync_dir(state)

def validate_record(record):
    if not isinstance(record,dict) or record.get("schema")!=1 or record.get("kind")!="mint-repair-interruption" or record.get("phase")!="pre-activation" or record.get("desktopUid")!=os.getuid() or any(record.get(k) is not False for k in FLAGS):
        raise ValueError("Invalid interruption evidence.")
    if not isinstance(record.get("repairFolder"),str) or not isinstance(record.get("rollbackReceiptDigest"),str):
        raise ValueError("Missing repair identity.")
    make_record(record["repairFolder"],record["rollbackReceiptDigest"])

def inspect(state):
    raw=read_regular(state/MARKER)
    record=json.loads(raw)
    validate_record(record)
    repair=state/record["repairFolder"]
    receipt=read_regular(repair/"rollback-preparation.json")
    if hashlib.sha256(receipt).hexdigest()!=record["rollbackReceiptDigest"]:
        raise ValueError("Rollback preparation changed.")
    rollback=json.loads(receipt)
    if rollback.get("schema")!=1 or rollback.get("kind")!="mint-repair-rollback-preparation" or rollback.get("repairSpecificRollbackTested") is not True or any(rollback.get(k) is not False for k in FLAGS):
        raise ValueError("Invalid rollback preparation.")
    if read_regular(state/MARKER)!=raw or read_regular(repair/"rollback-preparation.json")!=receipt:
        raise ValueError("Interruption evidence changed.")
    return {"schema":1,"kind":"mint-repair-interruption-review","markerRetained":True,"rollbackReceiptMatched":True,"recoveryAllowed":False,**FLAGS}

def main():
    title="RS Nextward | Interrupted repair review"
    try:
        if os.geteuid()==0 or STATE.resolve(strict=True)!=STATE or STATE.stat().st_uid!=os.getuid():
            raise ValueError("Desktop user required.")
        with open_lock(STATE/"maintenance.lock") as maintenance,open_lock(STATE/"update.lock") as update:
            for lock in (maintenance,update):
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            inspect(STATE)
        message="Interruption record and rollback preparation match. This is an evidence review only. Startup remains blocked; contact RS Nextward support."
        kind="--info"
    except (OSError,ValueError,RuntimeError,TypeError,AttributeError):
        message="No valid interruption evidence could be verified. Any existing marker is retained. No repair, rollback or startup was performed."
        kind="--error"
    subprocess.run(["zenity",kind,"--no-markup","--title="+title,"--text="+message],check=False)

if __name__=="__main__":
    main()
