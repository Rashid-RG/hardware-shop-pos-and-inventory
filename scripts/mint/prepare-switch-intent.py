#!/usr/bin/env python3
"""Retain a Mint switch intent only; never change the project pointer or service."""
import argparse
import datetime
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import uuid

STATE=Path.home()/".local/share/ars-hardware"
FLAGS={"activationAllowed":False,"startupAllowed":False,"rollbackAllowed":False,"runtimeActivated":False}

def load():
    spec=importlib.util.spec_from_file_location("activation_proposal",Path(__file__).resolve().parent/"prepare-runtime-activation.py")
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def verified_binding(folder, proposal):
    raw=proposal.read(STATE/"runtime-activation-proposal.json")
    record=json.loads(raw)
    observed=proposal.snapshot(folder)
    if not proposal.matches(record,observed) or proposal.read(STATE/"runtime-activation-proposal.json")!=raw:
        raise ValueError("Verified activation proposal required.")
    restore=proposal.read(folder/"restore-test.json")
    if proposal.sha(restore)!=observed["evidence"]["restore"]:
        raise ValueError("Restore evidence changed.")
    receipt=json.loads(restore)
    candidate=receipt.get("buildFingerprint")
    previous=receipt.get("previousBuildFingerprint")
    if not all(isinstance(x,str) and re.fullmatch(r"[a-f0-9]{64}",x) for x in (candidate,previous)):
        raise ValueError("Release fingerprints required.")
    return {"proposalDigest":proposal.sha(raw),"recoveryFolder":str(folder),"candidateVersion":observed["candidateVersion"],"previousProject":observed["previousProject"],"candidateDigest":candidate,"previousBuildDigest":previous,"maintenanceDigest":observed["evidence"]["hold"],"desktopUid":os.getuid()}

def matches(record,binding):
    return (record.get("schema")==1 and record.get("kind")=="mint-runtime-switch-intent"
            and isinstance(record.get("switchId"),str) and re.fullmatch(r"[a-f0-9]{32}",record["switchId"]) is not None
            and record.get("observationOnly") is True and record.get("binding")==binding
            and all(record.get(k) is False for k in FLAGS))

def retain(folder,verify=False,confirmation=""):
    if os.geteuid()==0 or not folder.is_absolute():
        raise ValueError("Desktop user and absolute recovery folder required.")
    if not verify and confirmation!="RETAIN MINT SWITCH INTENT":
        raise ValueError("Explicit confirmation required.")
    proposal=load()
    proposal.plain(STATE,True)
    target=STATE/"runtime-switch-intent.json"
    with os.fdopen(os.open(STATE/"maintenance.lock",os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600),"a") as maintenance, os.fdopen(os.open(STATE/"update.lock",os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600),"a") as update:
        for lock in (maintenance,update):
            if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode):
                raise ValueError("Invalid lock.")
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        binding=verified_binding(folder,proposal)
        if not verify:
            if target.exists() or target.is_symlink():
                raise ValueError("Existing intent must be retained.")
            if verified_binding(folder,proposal)!=binding:
                raise ValueError("Binding changed.")
            record={"schema":1,"kind":"mint-runtime-switch-intent","switchId":uuid.uuid4().hex,"recordedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"observationOnly":True,"binding":binding,**FLAGS}
            with os.fdopen(os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),"w") as f:
                json.dump(record,f)
                f.flush()
                os.fsync(f.fileno())
            fd=os.open(STATE,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(fd)
            finally:os.close(fd)
        raw=proposal.read(target)
        record=json.loads(raw)
        if not matches(record,verified_binding(folder,proposal)) or proposal.read(target)!=raw:
            raise ValueError("Intent stale or invalid.")
        return {"schema":1,"intentMatched":True,"switchId":record["switchId"],"intentDigest":proposal.sha(raw),**FLAGS}

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder",type=Path)
    parser.add_argument("--verify",action="store_true")
    parser.add_argument("--confirmation",default="")
    args=parser.parse_args()
    try:
        print(json.dumps(retain(args.folder,args.verify,args.confirmation)))
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        sys.exit("ARS Distributor switch intent blocked. Contact RS Nextward support.")
