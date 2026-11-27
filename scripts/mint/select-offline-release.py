#!/usr/bin/env python3
"""Explicit offline release selection; no service start or database restore."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

STATE=Path.home()/".local/share/ars-hardware"

def load_intent():
    spec=importlib.util.spec_from_file_location("switch_intent",Path(__file__).resolve().parent/"prepare-switch-intent.py")
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def select_offline_release(folder, confirmation):
    """Select a verified release while retaining all startup blockers."""
    from switch_journal import write_journal, switch_pointer
    from maintenance_backup import stopped, check_database_clients
    from resume_maintenance import open_lock
    if os.geteuid()==0 or confirmation!="SELECT OFFLINE RELEASE" or not folder.is_absolute():
        raise ValueError("Explicit offline selection approval required.")
    intent=load_intent()
    proposal=intent.load()
    proposal.plain(STATE,True)
    target=STATE/"runtime-switch-intent.json"
    with open_lock(STATE/"maintenance.lock") as maintenance, open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for name in ("runtime-activation-interrupted.json","runtime-migration-interrupted.json","handoff-pending.json","switch-journal.json"):
            if os.path.lexists(STATE/name):
                raise ValueError("Unresolved recovery evidence.")
        raw=proposal.read(target)
        record=json.loads(raw)
        binding=intent.verified_binding(folder,proposal)
        if not intent.matches(record,binding):
            raise ValueError("Verified switch intent required.")
        previous=Path(binding["previousProject"])
        candidate=STATE/"staged-releases"/binding["candidateVersion"]
        pointer=STATE/"project"
        if candidate.resolve(strict=True)!=candidate or previous.resolve(strict=True)!=previous or candidate==previous or not pointer.is_symlink() or pointer.resolve(strict=True)!=previous:
            raise ValueError("Unexpected release layout.")
        intent.prepare_candidate_runtime(candidate,STATE/"runtime")
        stopped()
        check_database_clients(previous)
        if intent.verified_binding(folder,proposal)!=binding or proposal.read(target)!=raw:
            raise ValueError("Switch evidence changed.")
        journal={"schema":1,"kind":"mint-offline-release-selection","previous":str(previous),"candidate":str(candidate),"phase":"backup-verified","switchId":record["switchId"],"intentDigest":proposal.sha(raw),"maintenanceDigest":binding["maintenanceDigest"],"startupAllowed":False}
        write_journal(STATE,journal)
        switch_pointer(pointer,previous,candidate)
        journal["phase"]="switched"
        write_journal(STATE,journal)
        stopped()
        check_database_clients(candidate)
        if proposal.read(target)!=raw or proposal.sha(proposal.read(STATE/"maintenance-hold.json"))!=binding["maintenanceDigest"] or pointer.resolve(strict=True)!=candidate:
            raise ValueError("Offline selection evidence changed; retain startup protection.")
        return {"selected":True,"maintenanceRetained":True,"startupAllowed":False,"rollbackAllowed":False,"continuousExclusionVerified":False}

def rollback_offline_release(confirmation):
    """Reverse offline selection only; never restore SQL or authorize startup."""
    from switch_journal import write_journal, switch_pointer
    from maintenance_backup import stopped, check_database_clients
    from resume_maintenance import open_lock
    from release_fingerprint import fingerprint
    import tempfile
    import shutil
    import re
    if os.geteuid()==0 or confirmation!="ROLL BACK OFFLINE RELEASE":
        raise ValueError("Explicit rollback approval required.")
    intent=load_intent()
    proposal=intent.load()
    proposal.plain(STATE,True)
    target=STATE/"runtime-switch-intent.json"
    journal_path=STATE/"switch-journal.json"
    hold=STATE/"maintenance-hold.json"
    with open_lock(STATE/"maintenance.lock") as maintenance, open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for name in ("runtime-activation-interrupted.json","runtime-migration-interrupted.json","handoff-pending.json"):
            if os.path.lexists(STATE/name):
                raise ValueError("Unresolved recovery evidence.")
        raw=proposal.read(target)
        hold_raw=proposal.read(hold)
        record=json.loads(raw)
        binding=record["binding"]
        journal_raw=proposal.read(journal_path)
        journal=json.loads(journal_raw)
        if not intent.matches(record,binding) or binding.get("desktopUid")!=os.getuid() or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?",binding["candidateVersion"]):
            raise ValueError("Invalid switch intent.")
        previous=Path(binding["previousProject"])
        candidate=STATE/"staged-releases"/binding["candidateVersion"]
        expected={"schema":1,"kind":"mint-offline-release-selection","previous":str(previous),"candidate":str(candidate),"switchId":record["switchId"],"intentDigest":proposal.sha(raw),"maintenanceDigest":proposal.sha(hold_raw),"startupAllowed":False}
        if any(journal.get(k)!=v for k,v in expected.items()) or journal.get("phase") not in ("backup-verified","switched","offline-rollback-pending","offline-rolled-back") or binding["maintenanceDigest"]!=expected["maintenanceDigest"]:
            raise ValueError("Rollback evidence mismatch.")
        h=json.loads(hold_raw)
        if h.get("purpose")!="pre-update backup" or h.get("previousProject")!=str(previous):
            raise ValueError("Original maintenance hold required.")
        pointer=STATE/"project"
        if previous.resolve(strict=True)!=previous or candidate.resolve(strict=True)!=candidate or previous==candidate or not pointer.is_symlink() or pointer.resolve(strict=True) not in (previous,candidate):
            raise ValueError("Unexpected release layout.")
        for name in (".env.local","uploads","backups"):
            destination=STATE/"runtime"/name
            if destination.is_symlink() or not (previous/name).is_symlink() or (previous/name).resolve(strict=True)!=destination:
                raise ValueError("Previous runtime mapping changed.")
        stopped()
        check_database_clients(previous)
        with tempfile.TemporaryDirectory(prefix="ars-rollback-build-") as temp:
            old=Path(temp)
            for part in ("dist","node_modules"):
                shutil.copytree(previous/part,old/part,symlinks=True)
            if fingerprint(old)!=binding["previousBuildDigest"]:
                raise ValueError("Previous build fingerprint changed.")
        if proposal.read(target)!=raw or proposal.read(hold)!=hold_raw or proposal.read(journal_path)!=journal_raw:
            raise ValueError("Rollback evidence changed.")
        journal["phase"]="offline-rollback-pending"
        write_journal(STATE,journal)
        if pointer.resolve(strict=True)==candidate:
            switch_pointer(pointer,candidate,previous)
        stopped()
        check_database_clients(previous)
        if pointer.resolve(strict=True)!=previous or proposal.read(target)!=raw or proposal.read(hold)!=hold_raw:
            raise ValueError("Rollback verification failed.")
        journal["phase"]="offline-rolled-back"
        write_journal(STATE,journal)
        return {"previousSelected":True,"maintenanceRetained":True,"startupAllowed":False,"databaseRestored":False}

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder",type=Path,nargs="?")
    parser.add_argument("--rollback-offline",action="store_true")
    parser.add_argument("--confirmation",required=True)
    args=parser.parse_args()
    try:
        if args.rollback_offline:
            print(json.dumps(rollback_offline_release(args.confirmation)))
        elif args.folder is not None:
            print(json.dumps(select_offline_release(args.folder,args.confirmation)))
        else:
            parser.error("Recovery folder required for selection.")
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        sys.exit("Offline selection blocked. Maintenance remains active.")
