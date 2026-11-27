"""Read-only repair readiness observation; no activation, startup or rollback."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
from resume_maintenance import open_lock
from repair_test_build import assert_local_docker, verify_retained_build
from repair_native_probe import inspect_native

STATE=Path.home()/".local/share/ars-hardware"
FLAGS=("activationAllowed","startupAllowed","repairApplied")

def load_review():
    spec=importlib.util.spec_from_file_location("repair_review",Path(__file__).with_name("repair-backup-review.py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def validate_receipts(binding, raw, observer):
    backup,test,final=(json.loads(raw[k]) for k in ("backup","test","completion"))
    if any(record.get(k) is not False for record in (backup,test,final) for k in FLAGS):
        raise ValueError("Unexpected repair authorization.")
    if backup.get("schema")!=1 or backup.get("kind")!="repair-backup-observation" or backup.get("backupEvidenceMatched") is not True or backup.get("repairCandidateRestoreTested") is not False or backup.get("repairReceiptDigest")!=binding[0] or backup.get("manifestDigest")!=binding[1]:
        raise ValueError("Repair backup evidence mismatch.")
    if test.get("kind")!="isolated-repair-restore-test" or any(test.get(k) is not True for k in ("restoreTestPassed","authenticatedReadsPassed","authenticatedWritesPassed","migrationCompatibilityPassed","repairSpecificBackwardTested","backwardStartupPassed","backwardReadsPassed","backwardWritesPassed")) or test.get("continuousExclusionVerified") is not False or test.get("activationApproved") is not False:
        raise ValueError("Incomplete repair rehearsal.")
    if not isinstance(test.get("buildFingerprint"),str) or not re.fullmatch(r"[a-f0-9]{64}",test["buildFingerprint"]):
        raise ValueError("Tested build fingerprint missing.")
    if final.get("schema")!=1 or final.get("kind")!="mint-repair-rehearsal-observation" or final.get("backupObservationDigest")!=observer.sha(raw["backup"]) or final.get("testReceiptDigest")!=observer.sha(raw["test"]) or final.get("repairReceiptDigest")!=binding[0]:
        raise ValueError("Post-test observation missing or mismatched.")
    if not isinstance(test.get("previousBuildFingerprint"),str) or not re.fullmatch(r"[a-f0-9]{64}",test["previousBuildFingerprint"]):
        raise ValueError("Previous executable fingerprint missing.")
    return backup,test

def inspect(repair):
    if os.geteuid()==0:
        raise ValueError("Desktop user required.")
    assert_local_docker()
    review=load_review()
    observer=review.load_observer()
    observer.plain(STATE,True)
    with open_lock(STATE/"maintenance.lock") as maintenance,open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for name in ("runtime-activation-interrupted.json","runtime-switch-intent.json","runtime-migration-interrupted.json","switch-journal.json","handoff-pending.json","repair-interrupted.json"):
            if os.path.lexists(STATE/name):
                raise ValueError("Unresolved maintenance evidence.")
        project=(STATE/"project").resolve(strict=True)
        binding=review.validate_repair(repair,project,observer)
        files={"backup":repair/"backup-observation.json","test":repair/"repair-restore-test.json","completion":repair/"repair-rehearsal-observation.json"}
        raw={key:observer.read(path) for key,path in files.items()}
        backup,test=validate_receipts(binding,raw,observer)
        evidence=backup["backupObservation"]
        recovery=Path(evidence["recoveryFolder"])
        if observer.snapshot(recovery)!=evidence:
            raise ValueError("Backup evidence is stale.")
        restore=json.loads(observer.read(recovery/"restore-test.json"))
        for key in ("version","archive","archiveSha256"):
            if not test.get(key) or test[key]!=restore.get(key):
                raise ValueError("Repair rehearsal used different backup evidence.")
        if test["previousBuildFingerprint"]!=restore.get("previousBuildFingerprint"):
            raise ValueError("Previous executable differs from recovery evidence.")
        if review.validate_repair(repair,project,observer)!=binding or any(observer.read(path)!=raw[key] for key,path in files.items()) or observer.snapshot(recovery)!=evidence:
            raise ValueError("Evidence changed during review.")
        if test.get("testedBuildRetained") is not True:
            raise ValueError("A new rehearsal with retained build is required.")
        verify_retained_build(repair,test["buildFingerprint"])
        native=inspect_native(STATE,repair,test["buildFingerprint"])
        return {"nativeProbe":native,"schema":1,"repairEvidenceMatched":True,"testedBuildFingerprint":test["buildFingerprint"],"testedBuildRetained":True,"repairSpecificBackwardTested":True,"previousBuildFingerprint":test["previousBuildFingerprint"],"continuousExclusionVerified":False,"rollbackVerified":False,**{key:False for key in FLAGS}}

def main():
    title="RS Nextward | Repair readiness review"
    def dialog(*args):
        return subprocess.run(["zenity","--title="+title,*args],capture_output=True,text=True)
    answer=dialog("--file-selection","--directory","--filename="+str(STATE)+"/","--title=Select managed repair preparation")
    if answer.returncode:
        return
    try:
        inspect(Path(answer.stdout.strip()))
        dialog("--info","--no-markup","--text=Repair and backup evidence matched. The exact tested build is retained and its fingerprint matches. Registered Node runtime and server syntax checks passed. Native add-on loading and host startup are not certified. Isolated backward testing passed. Continuous writer exclusion, live rollback and physical acceptance are not certified. Live repair remains locked.")
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        dialog("--error","--no-markup","--text=Repair readiness review blocked. Missing, stale or altered evidence. No repair applied.")

if __name__=="__main__":
    main()
