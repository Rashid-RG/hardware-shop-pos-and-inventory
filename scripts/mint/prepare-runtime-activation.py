#!/usr/bin/env python3
"""Retain a non-authorizing Mint activation observation. No switch or service changes."""
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from maintenance_backup import stopped, check_database_clients

STATE=Path.home()/".local/share/ars-hardware"
FLAGS={"activationAllowed":False,"runtimeActivated":False,"startupAllowed":False,"rollbackAllowed":False}

def load(name):
    path=Path(__file__).resolve().parent/name
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def plain(path, directory=False):
    if path.resolve(strict=True)!=path:
        raise ValueError("Unexpected linked evidence.")
    s=path.lstat()
    if not (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)):
        raise ValueError("Unexpected evidence type.")
    return s

def read(path, maximum=65536):
    s=plain(path)
    if not 0<s.st_size<=maximum:
        raise ValueError("Invalid evidence size.")
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),"rb") as f:
        a=os.fstat(f.fileno())
        raw=f.read(maximum+1)
        b=os.fstat(f.fileno())
    if (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)!=(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns) or a!=b or len(raw)!=s.st_size:
        raise ValueError("Evidence changed.")
    return raw

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def matches_backup_receipt(receipt,raw,meta,binding):
    return (receipt.get("schema")==1 and receipt.get("kind")=="mint-maintenance-backup-observation"
            and receipt.get("holdDigest")==sha(raw["hold"]) and receipt.get("recoveryDigest")==sha(raw["recovery"])
            and receipt.get("archive")==meta.get("archive") and receipt.get("version")==meta.get("version")
            and all(receipt.get(k)==binding.get(k) for k in ("database","systemIdentifier","databaseOid"))
            and receipt.get("locksObserved") is True and receipt.get("activationAllowed") is False
            and receipt.get("continuousExclusionVerified") is False)

def snapshot(folder):
    plain(STATE,True)
    plain(folder,True)
    if folder.parent!=STATE/"update-recovery":
        raise ValueError("Managed recovery directory required.")
    runtime=STATE/"runtime"
    plain(runtime,True)
    current=(STATE/"project").resolve(strict=True)
    if not (STATE/"project").is_symlink():
        raise ValueError("Managed release pointer required.")
    for name in (".env.local","uploads","backups"):
        plain(runtime/name,name!=".env.local")
        if not (current/name).is_symlink() or (current/name).resolve(strict=True)!=runtime/name:
            raise ValueError("Stable runtime mapping required.")
    for name in ("handoff-pending.json","switch-journal.json"):
        p=STATE/name
        if p.exists() or p.is_symlink():
            raise ValueError("Unresolved handoff or switch journal.")
    for p in [runtime/".ars-writer-loss.json",*(runtime/"backups"/n for n in (".ars-drive-backup.lock",".ars-local-backup.lock",".ars-drive-recovery.lock"))]:
        if p.exists() or p.is_symlink():
            raise ValueError("Unresolved recovery or backup incident.")
    files={"hold":STATE/"maintenance-hold.json","binding":STATE/"database-binding.json","configuration":runtime/".env.local","recovery":folder/"recovery.json","restore":folder/"restore-test.json","protectedBackup":folder/"maintenance-backup-receipt.json"}
    raw={k:read(p) for k,p in files.items()}
    hold,meta,binding=(json.loads(raw[k]) for k in ("hold","recovery","binding"))
    version=meta.get("version")
    if not isinstance(version,str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?",version):
        raise ValueError("Invalid release.")
    if hold.get("purpose")!="pre-update backup" or hold.get("previousProject")!=str(current) or hold.get("version")!=version or meta.get("previousProject")!=str(current) or meta.get("activationApproved") is not False:
        raise ValueError("Maintenance evidence mismatch.")
    if not matches_backup_receipt(json.loads(raw["protectedBackup"]),raw,meta,binding):
        raise ValueError("Protected backup belongs to another maintenance session.")
    stopped()
    db=load("database-binding.py").inspect()
    for key in ("schema","database","systemIdentifier","databaseOid","volume","port","activationAllowed"):
        if binding.get(key)!=db.get(key):
            raise ValueError("Database binding changed.")
    plan=load("update-switch-plan.py").plan(folder)
    receipt=json.loads(raw["restore"])
    if plan.get("activationAllowed") is not False or plan.get("rollbackAllowed") is not False or plan.get("candidateVersion")!=version or any(receipt.get(k) is not True for k in ("authenticatedReadsPassed","authenticatedWritesPassed","backwardStartupPassed","migrationCompatibilityPassed","restoreTestPassed")):
        raise ValueError("Compatibility review incomplete.")
    stopped()
    check_database_clients(current)
    if any(read(p)!=raw[k] for k,p in files.items()) or (STATE/"project").resolve(strict=True)!=current:
        raise ValueError("Evidence changed during observation.")
    return {"schema":1,"recoveryFolder":str(folder),"candidateVersion":version,"previousProject":str(current),"desktopUid":os.getuid(),"evidence":{k:sha(v) for k,v in raw.items()},"backupHoldBindingVerified":True,"continuousExclusionVerified":False,**FLAGS}

def matches(record, observed):
    return record.get("schema")==1 and record.get("kind")=="mint-runtime-activation-proposal" and record.get("observationOnly") is True and record.get("snapshot")==observed

def prepare(folder, verify=False, confirmation=""):
    if os.geteuid()==0:
        raise ValueError("Desktop user required.")
    plain(STATE,True)
    if not folder.is_absolute():
        raise ValueError("Absolute managed recovery folder required.")
    target=STATE/"runtime-activation-proposal.json"
    with os.fdopen(os.open(STATE/"maintenance.lock",os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600),"a") as maintenance, os.fdopen(os.open(STATE/"update.lock",os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600),"a") as update:
        for lock in (maintenance,update):
            if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode):
                raise ValueError("Invalid lock.")
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if not verify and confirmation!="PREPARE MINT ACTIVATION":
            raise ValueError("Explicit confirmation required.")
        observed=snapshot(folder)
        if not verify:
            if target.exists() or target.is_symlink():
                raise ValueError("Existing proposal must be retained.")
            if snapshot(folder)!=observed:
                raise ValueError("Activation evidence changed.")
            record={"schema":1,"kind":"mint-runtime-activation-proposal","observationOnly":True,"preparedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"snapshot":observed}
            with os.fdopen(os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),"w") as f:
                json.dump(record,f)
                f.flush()
                os.fsync(f.fileno())
            fd=os.open(STATE,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(fd)
            finally:os.close(fd)
        raw=read(target)
        if not matches(json.loads(raw),snapshot(folder)) or read(target)!=raw:
            raise ValueError("Activation proposal invalid or stale.")
        return {"proposalMatched":True,"proposalDigest":sha(raw),"backupHoldBindingVerified":True,"continuousExclusionVerified":False,**FLAGS}

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder",type=Path)
    parser.add_argument("--verify",action="store_true")
    parser.add_argument("--confirmation",default="")
    args=parser.parse_args()
    try:
        print(json.dumps(prepare(args.folder,args.verify,args.confirmation)))
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        sys.exit("ARS Distributor activation proposal blocked. Contact RS Nextward support.")
