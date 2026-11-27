"""Pin a dedicated uninstall backup without staged release or removal authorization.

Internal child of locked-backup.mjs. Not exposed in the wizard until the
uninstall maintenance and isolated restoration workflows are implemented.
"""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from repair_interruption import read_regular, sync_dir
from resume_maintenance import open_lock
from repair_test_build import assert_local_docker

STATE=Path.home()/".local/share/ars-hardware"
ARCHIVE=re.compile(r"ars-mint-\d{8}T\d{6}Z-[a-f0-9]{32}-v2-with-uploads\.dump")

def validate_hold(record,project,version):
    if record.get("purpose")!="pre-uninstall backup" or record.get("previousProject")!=str(project) or record.get("version")!=version or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?",version) or not isinstance(record.get("uninstallId"),str) or not re.fullmatch(r"[a-f0-9]{32}",record["uninstallId"]) or record.get("applicationRemovalAllowed") is not False:
        raise ValueError("Matching uninstall hold required.")

def members(dump):
    if not ARCHIVE.fullmatch(dump.name):
        raise ValueError("Complete database and upload archive required.")
    manifest=dump.with_suffix(".manifest.json")
    uploads=dump.with_name(dump.stem+"-uploads.zip")
    return [p for item in (dump,manifest,uploads) for p in (item,Path(str(item)+".sha256"))]

def prepare(version):
    if os.geteuid()==0 or STATE.resolve(strict=True)!=STATE or STATE.stat().st_uid!=os.getuid():
        raise ValueError("Managed desktop user required.")
    assert_local_docker()
    project=(STATE/"project").resolve(strict=True)
    if not (STATE/"project").is_symlink() or project!=Path(__file__).resolve().parents[2]:
        raise ValueError("Managed installation required.")
    hold_path=STATE/"maintenance-hold.json"
    raw=read_regular(hold_path)
    hold=json.loads(raw)
    validate_hold(hold,project,version)
    runtime=STATE/"runtime"
    for name in (".env.local","uploads","backups"):
        target=runtime/name
        if target.resolve(strict=True)!=target or not (project/name).is_symlink() or (project/name).resolve(strict=True)!=target:
            raise ValueError("Permanent runtime required.")
    recovery=STATE/"uninstall-recovery"
    recovery.mkdir(mode=0o700,exist_ok=True)
    if recovery.resolve(strict=True)!=recovery or recovery.stat().st_uid!=os.getuid():
        raise ValueError("Invalid recovery directory.")
    with open_lock(STATE/"update.lock") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        target=recovery/hold["uninstallId"]
        if os.path.lexists(target):
            raise ValueError("Existing recovery must be retained.")
        for marker in ("repair-interrupted.json","runtime-switch-intent.json","runtime-activation-interrupted.json","runtime-migration-interrupted.json","switch-journal.json","handoff-pending.json"):
            if os.path.lexists(STATE/marker):
                raise ValueError("Unresolved maintenance incident.")
        output=subprocess.run(["python3",str(project/"scripts/mint/backup.py"),"--retain-all"],cwd=project,check=True,capture_output=True,text=True).stdout
        paths=[s.partition("=")[2] for s in output.splitlines() if s.startswith("ARS_ARCHIVE=")]
        if len(paths)!=1:
            raise ValueError("Unique backup required.")
        dump=Path(paths[0]).resolve(strict=True)
        if dump.parent!=runtime/"backups":
            raise ValueError("Unexpected archive location.")
        with tempfile.TemporaryDirectory(prefix="uninstall-",dir=recovery) as temp:
            folder=Path(temp)/"snapshot"
            folder.mkdir(mode=0o700)
            for source in members(dump):
                if source.resolve(strict=True)!=source or not source.is_file() or source.stat().st_uid!=os.getuid():
                    raise ValueError("Invalid archive member.")
                dest=folder/source.name
                with source.open("rb") as inp,dest.open("xb") as out:
                    shutil.copyfileobj(inp,out)
                    out.flush()
                    os.fsync(out.fileno())
            copied=folder/dump.name
            subprocess.run([str(STATE/"node"),str(project/"scripts/verify-backup.mjs"),str(copied)],check=True)
            with copied.open("rb") as stream:
                digest=hashlib.file_digest(stream,"sha256").hexdigest()
            if read_regular(hold_path)!=raw or (STATE/"project").resolve(strict=True)!=project:
                raise ValueError("Maintenance evidence changed.")
            meta=dict(schema=1,kind="mint-final-uninstall-backup",uninstallId=hold["uninstallId"],version=version,previousProject=str(project),archive=dump.name,archiveSha256=digest,createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),activationApproved=False,restoreTestPassed=False,applicationRemovalAllowed=False,databaseDeletionAllowed=False)
            with (folder/"recovery.json").open("x") as stream:
                json.dump(meta,stream,sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            sync_dir(folder)
            folder.rename(target)
            sync_dir(recovery)
        print("Pinned recovery archive:",target)

if __name__=="__main__":
    os.umask(0o077)
    if len(sys.argv)!=2:
        sys.exit("Version required.")
    prepare(sys.argv[1])
