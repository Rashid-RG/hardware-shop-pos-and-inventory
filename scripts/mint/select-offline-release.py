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

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder",type=Path)
    parser.add_argument("--confirmation",required=True)
    args=parser.parse_args()
    try:
        print(json.dumps(select_offline_release(args.folder,args.confirmation)))
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        sys.exit("Offline selection blocked. Maintenance remains active.")
