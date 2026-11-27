"""Run a repair-specific restored database rehearsal; never select the repair."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
from resume_maintenance import open_lock
from repair_test_build import assert_local_docker, verify_retained_build
STATE=Path.home()/".local/share/ars-hardware"

def load(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+".py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def run(repair):
    if os.geteuid()==0:
        raise ValueError("Desktop user required.")
    assert_local_docker()
    review=load("repair-backup-review")
    observer=review.load_observer()
    observer.plain(STATE,True)
    with open_lock(STATE/"maintenance.lock") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        project=(STATE/"project").resolve(strict=True)
        binding=review.validate_repair(repair,project,observer)
        raw=observer.read(repair/"backup-observation.json")
        record=json.loads(raw)
        if record.get("kind")!="repair-backup-observation" or record.get("backupEvidenceMatched") is not True or record.get("repairReceiptDigest")!=binding[0] or record.get("manifestDigest")!=binding[1] or any(record.get(k) is not False for k in ("repairCandidateRestoreTested","activationAllowed","startupAllowed","repairApplied")):
            raise ValueError("Matching repair backup observation required.")
        evidence=record["backupObservation"]
        recovery=Path(evidence["recoveryFolder"])
        if observer.snapshot(recovery)!=evidence:
            raise ValueError("Backup observation is stale.")
        harness=load("test-update-restore")
        harness.test(recovery,compatibility=True,repair=repair)
        # Result is not authoritative if any evidence changed during rehearsal.
        if review.validate_repair(repair,project,observer)!=binding or observer.read(repair/"backup-observation.json")!=raw or observer.snapshot(recovery)!=evidence:
            raise ValueError("Evidence changed; repair result is not approved.")
        test_raw=observer.read(repair/"repair-restore-test.json")
        result=json.loads(test_raw)
        if result.get("kind")!="isolated-repair-restore-test" or any(result.get(k) is not True for k in ("restoreTestPassed","authenticatedReadsPassed","authenticatedWritesPassed","migrationCompatibilityPassed","candidateRestartPreserved","previousRestartPreserved","repairSpecificBackwardTested","backwardStartupPassed","backwardReadsPassed","backwardWritesPassed")) or any(result.get(k) is not False for k in ("activationAllowed","startupAllowed","repairApplied")):
            raise ValueError("Incomplete repair rehearsal.")
        if result.get("testedBuildRetained") is not True:
            raise ValueError("Tested build retention required.")
        prior=json.loads(observer.read(recovery/"restore-test.json"))
        if result.get("previousBuildFingerprint")!=prior.get("previousBuildFingerprint") or result.get("archiveSha256")!=prior.get("archiveSha256"):
            raise ValueError("Previous executable or recovery archive mismatch.")
        verify_retained_build(repair,result["buildFingerprint"])
        final={"schema":1,"kind":"mint-repair-rehearsal-observation","backupObservationDigest":observer.sha(raw),"testReceiptDigest":observer.sha(test_raw),"repairReceiptDigest":binding[0],"activationAllowed":False,"startupAllowed":False,"repairApplied":False}
        with (repair/"repair-rehearsal-observation.json").open("x") as stream:
            json.dump(final,stream,sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())

def main():
    title="RS Nextward | Isolated repair restoration"
    def dialog(*args):
        return subprocess.run(["zenity","--title="+title,*args],capture_output=True,text=True)
    answer=dialog("--file-selection","--directory","--filename="+str(STATE)+"/","--title=Select managed repair preparation")
    if answer.returncode:
        return
    if dialog("--question","--no-markup","--text=Build the repair candidate and exercise billing against a disposable restored database? Internet access for locked dependencies is required. No live repair will be applied.").returncode:
        return
    try:
        run(Path(answer.stdout.strip()))
        dialog("--info","--no-markup","--text=Isolated repair restoration rehearsal completed. Activation remains locked.")
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        dialog("--error","--no-markup","--text=Repair rehearsal blocked or failed. No live repair applied. Contact RS Nextward support.")

if __name__=="__main__":
    main()
