"""Native repair rehearsal in a new user, PID, mount and network namespace.
No fallback to unsandboxed execution is permitted.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from repair_test_build import verify_retained_build
from repair_native_probe import digest

STATE=Path.home()/".local/share/ars-hardware"

def load_readiness():
    spec=importlib.util.spec_from_file_location("readiness",Path(__file__).with_name("repair-readiness.py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def sandbox_args(node,build,dump,helpers):
    args=["/usr/bin/bwrap","--unshare-all","--die-with-parent","--new-session","--clearenv",
          "--ro-bind","/usr","/usr","--proc","/proc","--dev","/dev","--tmpfs","/tmp",
          "--dir","/etc","--ro-bind",str(node),"/native-node","--ro-bind",str(build),"/app",
          "--tmpfs","/app/uploads","--ro-bind",str(dump),"/recovery.dump",
          "--ro-bind",str(helpers/"native_repair_worker.py"),"/worker.py",
          "--ro-bind",str(helpers/"compatibility-api-probe.mjs"),"/read-probe.mjs",
          "--ro-bind",str(helpers/"compatibility-write-probe.mjs"),"/write-probe.mjs"]
    for name in ("bin","sbin","lib","lib64"):
        path=Path("/"+name)
        if path.is_symlink():
            args+=["--symlink",os.readlink(path),str(path)]
        elif path.is_dir():
            args+=["--ro-bind",str(path),str(path)]
    return args+["--setenv","PATH","/usr/bin:/bin","--setenv","HOME","/tmp","--chdir","/tmp","/usr/bin/python3","/worker.py"]

def rehearse(repair):
    if os.geteuid()==0:
        raise ValueError("Desktop user required.")
    for tool in ("/usr/bin/bwrap","/usr/lib/postgresql/16/bin/initdb","/usr/lib/postgresql/16/bin/pg_restore"):
        if not os.access(tool,os.X_OK):
            raise ValueError("Bubblewrap and native PostgreSQL 16 tools are required. No unsafe fallback.")
    readiness=load_readiness()
    before=readiness.inspect(repair)
    expected=before["testedBuildFingerprint"]
    build=verify_retained_build(repair,expected)
    node=(STATE/"node").resolve(strict=True)
    test=json.loads((repair/"repair-restore-test.json").read_text())
    backup=json.loads((repair/"backup-observation.json").read_text())
    recovery=Path(backup["backupObservation"]["recoveryFolder"])
    name=test["archive"]
    import re
    if not re.fullmatch(r"ars-mint-\d{8}T\d{6}Z-[0-9a-f]{32}-(?:v2-)?(with-uploads|database-only)\.dump",name):
        raise ValueError("Invalid archive name.")
    dump=recovery/name
    if dump.resolve(strict=True)!=dump or digest(dump)!=test["archiveSha256"]:
        raise ValueError("Archive changed.")
    receipt=repair/"native-startup-observation.json"
    if os.path.lexists(receipt):
        raise ValueError("Existing native evidence must be retained.")
    # Use a private copy: the tested tree is never mounted writable.
    with tempfile.TemporaryDirectory(prefix="ars-native-copy-") as temp:
        isolated=Path(temp)/"build"
        shutil.copytree(build,isolated,symlinks=True)
        from release_fingerprint import fingerprint
        if fingerprint(isolated)!=expected:
            raise ValueError("Build copy differs.")
        # Mountpoint created only in the disposable copy.
        (isolated/"uploads").mkdir(mode=0o700)
        result=subprocess.run(sandbox_args(node,isolated,dump,Path(__file__).resolve().parent),
                              check=True,timeout=1200,capture_output=True,text=True,
                              env={"PATH":"/usr/bin:/bin","HOME":temp,"LANG":"C"})
        if "ARS_NATIVE_REHEARSAL_PASSED" not in result.stdout.splitlines():
            raise RuntimeError("Native rehearsal not confirmed.")
    if readiness.inspect(repair)!=before or digest(dump)!=test["archiveSha256"]:
        raise ValueError("Repair evidence changed.")
    record={"schema":1,"kind":"mint-native-repair-startup-observation",
            "buildFingerprint":expected,"archiveSha256":test["archiveSha256"],
            "nodeExecutableSha256":before["nativeProbe"]["nodeExecutableSha256"],
            "nativeStartupPassed":True,"authenticatedReadsPassed":True,"authenticatedWritesPassed":True,
            "historicalRowsCompared":True,"activationAllowed":False,"startupAllowed":False,"repairApplied":False}
    with receipt.open("x") as stream:
        json.dump(record,stream,sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())

def main():
    title="RS Nextward | Native repair rehearsal"
    def dialog(*args):
        return subprocess.run(["zenity","--title="+title,*args],capture_output=True,text=True)
    answer=dialog("--file-selection","--directory","--filename="+str(STATE)+"/")
    if answer.returncode:
        return
    if dialog("--question","--no-markup","--text=Test the retained repair build using a disconnected native PostgreSQL instance? No live repair will be applied.").returncode:
        return
    try:
        rehearse(Path(answer.stdout.strip()))
        dialog("--info","--no-markup","--text=Native isolated rehearsal passed. Activation remains locked.")
    except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
        dialog("--error","--no-markup","--text=Native rehearsal blocked or failed. Bubblewrap and PostgreSQL 16 tools are required. No live repair applied.")

if __name__=="__main__":
    main()
