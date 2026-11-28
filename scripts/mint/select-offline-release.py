#!/usr/bin/env python3
"""Explicit offline release selection; no service start or database restore."""
import argparse
import fcntl
import importlib.util
import json
import hashlib
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
        for name in ("runtime-activation-interrupted.json","runtime-migration-interrupted.json","handoff-pending.json","switch-journal.json","repair-interrupted.json"):
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

def verify_reviewed_evidence(review, records, active):
    """Compare the operator's review after acquiring both maintenance locks."""
    if review is None:
        return  # Existing explicitly confirmed command-line recovery remains available.
    expected={path.name:hashlib.sha256(raw).hexdigest() for path,raw in records}
    expected["activeProject"]=str(active)
    if review!=expected:
        raise ValueError("Operator-reviewed recovery evidence changed.")


def verify_recovery_tools(previous, binding):
    """Check retained local integrity evidence; legacy intents remain offline-only."""
    from release_fingerprint import recovery_tools_fingerprint
    import re
    if "previousRecoveryToolsDigest" not in binding:
        return False
    expected=binding["previousRecoveryToolsDigest"]
    if not isinstance(expected,str) or not re.fullmatch(r"[a-f0-9]{64}",expected) or recovery_tools_fingerprint(previous)!=expected:
        raise ValueError("Previous recovery tools fingerprint changed.")
    return True

def rollback_offline_release(confirmation, reviewed_evidence=None):
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
        for name in ("runtime-activation-interrupted.json","runtime-migration-interrupted.json","handoff-pending.json","repair-interrupted.json"):
            if os.path.lexists(STATE/name):
                raise ValueError("Unresolved recovery evidence.")
        raw=proposal.read(target)
        hold_raw=proposal.read(hold)
        record=json.loads(raw)
        binding=record["binding"]
        journal_raw=proposal.read(journal_path)
        journal=json.loads(journal_raw)
        verify_reviewed_evidence(reviewed_evidence,((target,raw),(hold,hold_raw),(journal_path,journal_raw)),(STATE/"project").resolve(strict=True))
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
        verify_recovery_tools(previous,binding)
        journal["phase"]="offline-rollback-pending"
        write_journal(STATE,journal)
        if pointer.resolve(strict=True)==candidate:
            switch_pointer(pointer,candidate,previous)
        stopped()
        check_database_clients(previous)
        if pointer.resolve(strict=True)!=previous or proposal.read(target)!=raw or proposal.read(hold)!=hold_raw:
            raise ValueError("Rollback verification failed.")
        verify_recovery_tools(previous,binding)
        journal["phase"]="offline-rolled-back"
        write_journal(STATE,journal)
        return {"previousSelected":True,"maintenanceRetained":True,"startupAllowed":False,"databaseRestored":False}

def finalize_offline_rollback(confirmation, reviewed_evidence=None):
    """Archive an offline rollback's blockers; leave ordinary resume separate."""
    from resume_maintenance import open_lock
    from maintenance_backup import stopped, check_database_clients
    from switch_journal import sync_dir
    from startup_guard import migration_mapping_valid
    import re
    if os.geteuid()==0 or confirmation!="FINALIZE OFFLINE ROLLBACK":
        raise ValueError("Explicit rollback finalization approval required.")
    intent=load_intent()
    proposal=intent.load()
    proposal.plain(STATE,True)
    with open_lock(STATE/"maintenance.lock") as maintenance, open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for name in ("runtime-activation-interrupted.json","runtime-migration-interrupted.json","handoff-pending.json","repair-interrupted.json"):
            if os.path.lexists(STATE/name):
                raise ValueError("Unresolved recovery evidence.")
        hold=STATE/"maintenance-hold.json"
        hold_raw=proposal.read(hold)
        h=json.loads(hold_raw)
        journal=STATE/"switch-journal.json"
        raw=proposal.read(journal)
        j=json.loads(raw)
        switch_id=j.get("switchId")
        if j.get("schema")!=1 or j.get("kind")!="mint-offline-release-selection" or j.get("phase")!="offline-rolled-back" or j.get("startupAllowed") is not False or not isinstance(switch_id,str) or not re.fullmatch(r"[a-f0-9]{32}",switch_id):
            raise ValueError("Completed offline rollback required.")
        previous=Path(j["previous"])
        if not (STATE/"project").is_symlink() or (STATE/"project").resolve(strict=True)!=previous or h.get("purpose")!="pre-update backup" or h.get("previousProject")!=str(previous) or j.get("maintenanceDigest")!=proposal.sha(hold_raw) or not migration_mapping_valid(STATE):
            raise ValueError("Rollback maintenance binding mismatch.")
        target=STATE/"runtime-switch-intent.json"
        archive=STATE/("rolled-back-intent-"+switch_id+".json")
        journal_archive=STATE/("rolled-back-journal-"+switch_id+".json")
        # Retain exact evidence before removing any blocker. A retry can use
        # the archived intent if a crash happened after its unlink.
        intent_path=target if os.path.lexists(target) else archive
        intent_raw=proposal.read(intent_path)
        verify_reviewed_evidence(reviewed_evidence,((intent_path,intent_raw),(hold,hold_raw),(journal,raw)),(STATE/"project").resolve(strict=True))
        record=json.loads(intent_raw)
        binding=record["binding"]
        if not intent.matches(record,binding) or record.get("switchId")!=switch_id or binding.get("desktopUid")!=os.getuid() or binding.get("previousProject")!=str(previous) or binding.get("maintenanceDigest")!=proposal.sha(hold_raw) or proposal.sha(intent_raw)!=j.get("intentDigest"):
            raise ValueError("Rollback intent mismatch.")
        # Validate every source before publishing any archive. Retain the
        # journal until the other two records have been safely archived.
        prop=STATE/"runtime-activation-proposal.json"
        prop_archive=STATE/("rolled-back-proposal-"+switch_id+".json")
        prop_raw=proposal.read(prop if os.path.lexists(prop) else prop_archive)
        if proposal.sha(prop_raw)!=binding.get("proposalDigest"):
            raise ValueError("Activation proposal mismatch.")
        entries=((prop,prop_archive,prop_raw),(target,archive,intent_raw),(journal,journal_archive,raw))
        def verify_sources():
            verify_recovery_tools(previous,binding)
            if proposal.read(hold)!=hold_raw or not (STATE/"project").is_symlink() or (STATE/"project").resolve(strict=True)!=previous:
                raise ValueError("Maintenance evidence changed.")
            for source,dest,expected in entries:
                if proposal.read(source if os.path.lexists(source) else dest)!=expected:
                    raise ValueError("Rollback source evidence changed.")
                if os.path.lexists(dest) and proposal.read(dest)!=expected:
                    raise ValueError("Archived rollback evidence mismatch.")
        stopped()
        check_database_clients(previous)
        verify_sources()
        for source,dest,expected in entries:
            if not os.path.lexists(dest):
                os.link(source,dest,follow_symlinks=False)
                sync_dir(STATE)
            if proposal.read(dest)!=expected:
                raise ValueError("Archived rollback evidence mismatch.")
        # Recheck the entire evidence set before each removal. A partial
        # finalization remains recoverable using the retained archives.
        for source,dest,expected in entries:
            verify_sources()
            if proposal.read(dest)!=expected:
                raise ValueError("Archived rollback evidence mismatch.")
            if os.path.lexists(source):
                source.unlink()
                sync_dir(STATE)
        return {"rollbackFinalized":True,"maintenanceRetained":True,"startupAllowed":False}

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder",type=Path,nargs="?")
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument("--rollback-offline",action="store_true")
    mode.add_argument("--finalize-rollback",action="store_true")
    parser.add_argument("--confirmation",required=True)
    parser.add_argument("--reviewed-evidence",default=None)
    args=parser.parse_args()
    try:
        review=json.loads(args.reviewed_evidence) if args.reviewed_evidence is not None else None
        if args.reviewed_evidence is not None and (not isinstance(review,dict) or not (args.finalize_rollback or args.rollback_offline)):
            raise ValueError("Invalid reviewed evidence.")
        if args.finalize_rollback:
            print(json.dumps(finalize_offline_rollback(args.confirmation,review)))
        elif args.rollback_offline:
            print(json.dumps(rollback_offline_release(args.confirmation,review)))
        elif args.folder is not None:
            print(json.dumps(select_offline_release(args.folder,args.confirmation)))
        else:
            parser.error("Recovery folder required for selection.")
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        sys.exit("Offline selection blocked. Maintenance remains active.")
