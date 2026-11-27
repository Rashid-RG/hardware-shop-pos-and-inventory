"""Record rollback prerequisites without selecting a release or altering live files."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
from release_fingerprint import fingerprint
from resume_maintenance import open_lock
from repair_test_build import assert_local_docker, verify_retained_build

STATE=Path.home()/".local/share/ars-hardware"
FLAGS={"activationAllowed":False,"startupAllowed":False,"repairApplied":False,"rollbackAllowed":False}

def load_readiness():
    spec=importlib.util.spec_from_file_location("repair_readiness",Path(__file__).with_name("repair-readiness.py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def validate_previous(restore, current):
    expected=restore.get("previousBuildFingerprint")
    if not isinstance(expected,str) or not re.fullmatch(r"[a-f0-9]{64}",expected):
        raise ValueError("Previous executable fingerprint missing.")
    if any(restore.get(k) is not True for k in ("restoreTestPassed","migrationCompatibilityPassed","backwardStartupPassed","authenticatedReadsPassed","authenticatedWritesPassed")):
        raise ValueError("Prior backward compatibility rehearsal incomplete.")
    if restore.get("activationApproved") is not False or current!=expected:
        raise ValueError("Previous executable differs from tested rollback build.")
    return expected

def executable_fingerprint(project):
    # Match the original rollback rehearsal: fingerprint only dist and node_modules,
    # without copying configuration, uploads, archives or credentials.
    import tempfile
    import shutil
    with tempfile.TemporaryDirectory(prefix="ars-rollback-inspection-") as directory:
        copy=Path(directory)
        for name in ("dist","node_modules"):
            source=project/name
            if source.resolve(strict=True)!=source or not source.is_dir():
                raise ValueError("Previous executable tree unavailable.")
            # Validate links before copying; never follow a symbolic link during copying.
            fingerprint(source)
            shutil.copytree(source,copy/name,symlinks=True)
            if fingerprint(source)!=fingerprint(copy/name):
                raise ValueError("Previous executable changed during inspection.")
        if not (copy/"dist/server.cjs").is_file():
            raise ValueError("Previous server unavailable.")
        return fingerprint(copy)

def observe(repair):
    if os.geteuid()==0:
        raise ValueError("Desktop user required.")
    assert_local_docker()
    readiness=load_readiness()
    review=readiness.load_review()
    observer=review.load_observer()
    observer.plain(STATE,True)
    for name in ("runtime-activation-interrupted.json","runtime-switch-intent.json","runtime-migration-interrupted.json","switch-journal.json","handoff-pending.json","repair-interrupted.json"):
        if os.path.lexists(STATE/name):
            raise ValueError("Unresolved maintenance incident.")
    project=(STATE/"project").resolve(strict=True)
    binding=review.validate_repair(repair,project,observer)
    paths={"backup":repair/"backup-observation.json","test":repair/"repair-restore-test.json","completion":repair/"repair-rehearsal-observation.json"}
    raw={key:observer.read(path) for key,path in paths.items()}
    backup,test=readiness.validate_receipts(binding,raw,observer)
    evidence=backup["backupObservation"]
    recovery=Path(evidence["recoveryFolder"])
    if observer.snapshot(recovery)!=evidence:
        raise ValueError("Protected backup evidence changed.")
    previous_raw=observer.read(recovery/"restore-test.json")
    previous=json.loads(previous_raw)
    for name in ("version","archive","archiveSha256"):
        if not test.get(name) or test[name]!=previous.get(name):
            raise ValueError("Different recovery archives.")
    if test.get("testedBuildRetained") is not True:
        raise ValueError("Retained repair build required.")
    verify_retained_build(repair,test["buildFingerprint"])
    old=validate_previous(previous,executable_fingerprint(project))
    if test.get("previousBuildFingerprint")!=old:
        raise ValueError("Repair-specific backward executable mismatch.")
    if observer.snapshot(recovery)!=evidence or observer.read(recovery/"restore-test.json")!=previous_raw or any(observer.read(p)!=raw[k] for k,p in paths.items()) or review.validate_repair(repair,project,observer)!=binding or executable_fingerprint(project)!=old:
        raise ValueError("Rollback prerequisites changed.")
    verify_retained_build(repair,test["buildFingerprint"])
    result={"schema":1,"kind":"mint-repair-rollback-preparation","previousProject":str(project),
            "previousBuildFingerprint":old,"repairBuildFingerprint":test["buildFingerprint"],
            "archiveSha256":test["archiveSha256"],"previousRestoreDigest":observer.sha(previous_raw),
            "repairEvidenceDigests":{k:observer.sha(v) for k,v in raw.items()},
            "previousUpdateRollbackEvidenceMatched":True,"repairSpecificRollbackTested":True,
            "continuousExclusionVerified":False,**FLAGS}
    return result

def prepare(repair):
    with open_lock(STATE/"maintenance.lock") as maintenance,open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        result=observe(repair)
        target=repair/"rollback-preparation.json"
        with os.fdopen(os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),"w") as stream:
            json.dump(result,stream,sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        fd=os.open(repair,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)
        return result

def main():
    title="RS Nextward | Repair rollback preparation"
    def dialog(*args):
        return subprocess.run(["zenity","--title="+title,*args],capture_output=True,text=True)
    selection=dialog("--file-selection","--directory","--filename="+str(STATE)+"/")
    if selection.returncode:
        return
    try:
        prepare(Path(selection.stdout.strip()))
        dialog("--info","--no-markup","--text=Previous application fingerprint and existing rollback evidence matched. Isolated repair-specific backward testing matched. No live rollback or activation authorized.")
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        dialog("--error","--no-markup","--text=Rollback preparation blocked. Previous application or protected backup evidence could not be verified. No repair applied.")

if __name__=="__main__":
    main()
