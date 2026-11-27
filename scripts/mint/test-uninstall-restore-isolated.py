"""Isolated final-uninstall restoration review. Never connects to the live database."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import time
import uuid
import zipfile
from backup_snapshot import fingerprints, psql_command
from repair_interruption import read_regular, sync_dir
from repair_test_build import assert_local_docker
from resume_maintenance import open_lock

STATE=Path.home()/".local/share/ars-hardware"
IMAGE="postgres:16-alpine"
FLAGS=("applicationRemovalAllowed","databaseDeletionAllowed","serviceRemovalAllowed","uninstalled","finalUninstallBackupVerified","continuousExclusionVerified")
REQUIRED={"products","customers","sales_transactions","sales_transaction_items","customer_credit_payments"}

def load_prepare():
    spec=importlib.util.spec_from_file_location("uninstall_prepare",Path(__file__).with_name("prepare-uninstall-backup.py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def sha(path):
    if path.resolve(strict=True)!=path or not path.is_file() or path.stat().st_uid!=os.getuid():
        raise ValueError("Invalid archive member.")
    with path.open("rb") as stream:
        return hashlib.file_digest(stream,"sha256").hexdigest()

def validate_manifest(manifest,archive,digest):
    if manifest.get("version")!=1 or manifest.get("archive")!=archive or manifest.get("dumpSha256")!=digest:
        raise ValueError("Manifest does not match backup.")
    tables=manifest.get("tables")
    if not isinstance(tables,dict) or not REQUIRED.issubset(tables):
        raise ValueError("Required business tables missing.")
    for name,record in tables.items():
        if not isinstance(name,str) or not name or not isinstance(record,dict) or type(record.get("rows")) is not int or record["rows"]<0 or not isinstance(record.get("sha256"),str) or not re.fullmatch(r"[a-f0-9]{64}",record["sha256"]):
            raise ValueError("Invalid table evidence.")
    return tables

def verify_uploads(path):
    with zipfile.ZipFile(path) as bundle:
        names=set()
        for info in bundle.infolist():
            name=info.filename.rstrip("/")
            parts=name.split("/")
            mode=info.external_attr>>16
            if not name or parts[0]!="uploads" or any(p in ("",".","..") for p in parts) or "\\" in name or name in names or stat.S_IFMT(mode) not in (0,stat.S_IFREG,stat.S_IFDIR):
                raise ValueError("Unsafe or duplicate upload member.")
            names.add(name)
        if bundle.testzip() is not None:
            raise ValueError("Upload archive CRC mismatch.")
        return len(names)

def result(expected,actual,archive_digest,upload_count):
    if actual!=expected:
        raise ValueError("Restored database fingerprints differ from original manifest.")
    return {"schema":1,"kind":"mint-uninstall-restore-observation","archiveSha256":archive_digest,
            "isolatedRestorePassed":True,"allPublicTableFingerprintsMatched":True,
            "restoredTableCount":len(actual),"uploadArchiveIntegrityVerified":True,
            "uploadMemberCount":upload_count,**{flag:False for flag in FLAGS}}

def inspect(folder):
    if os.geteuid()==0 or STATE.resolve(strict=True)!=STATE or STATE.stat().st_uid!=os.getuid():
        raise ValueError("Managed desktop user required.")
    if folder.resolve(strict=True)!=folder or folder.parent!=STATE/"uninstall-recovery" or not re.fullmatch(r"[a-f0-9]{32}",folder.name) or folder.stat().st_uid!=os.getuid():
        raise ValueError("Managed uninstall recovery required.")
    assert_local_docker()
    prepare=load_prepare()
    with open_lock(STATE/"maintenance.lock") as maintenance,open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        target=folder/"uninstall-restore-test.json"
        if os.path.lexists(target):
            raise ValueError("Existing restore evidence must be retained.")
        for name in ("repair-interrupted.json","runtime-switch-intent.json","runtime-activation-interrupted.json","runtime-migration-interrupted.json","switch-journal.json","handoff-pending.json"):
            if os.path.lexists(STATE/name):
                raise ValueError("Unresolved maintenance incident.")
        files={"hold":STATE/"maintenance-hold.json","meta":folder/"recovery.json","receipt":folder/"maintenance-backup-receipt.json"}
        raw={k:read_regular(p) for k,p in files.items()}
        hold,meta,receipt=(json.loads(raw[k]) for k in ("hold","meta","receipt"))
        project=(STATE/"project").resolve(strict=True)
        prepare.validate_hold(hold,project,meta["version"])
        if meta.get("kind")!="mint-final-uninstall-backup" or meta.get("previousProject")!=str(project) or meta.get("uninstallId")!=folder.name or hold.get("uninstallId")!=folder.name or meta.get("restoreTestPassed") is not False or meta.get("applicationRemovalAllowed") is not False or meta.get("databaseDeletionAllowed") is not False:
            raise ValueError("Invalid uninstall archive evidence.")
        if receipt.get("kind")!="mint-uninstall-backup-observation" or receipt.get("uninstallId")!=folder.name or receipt.get("holdDigest")!=hashlib.sha256(raw["hold"]).hexdigest() or receipt.get("recoveryDigest")!=hashlib.sha256(raw["meta"]).hexdigest() or receipt.get("archive")!=meta["archive"] or receipt.get("database")!="hardware_pos_ars" or receipt.get("locksObserved") is not True or any(receipt.get(k) is not False for k in ("activationAllowed","applicationRemovalAllowed","finalUninstallBackupVerified","continuousExclusionVerified")):
            raise ValueError("Protected backup receipt mismatch.")
        if not prepare.ARCHIVE.fullmatch(meta["archive"]):
            raise ValueError("Invalid archive name.")
        dump=folder/meta["archive"]
        members=prepare.members(dump)
        before={p.name:sha(p) for p in members}
        if before[dump.name]!=meta.get("archiveSha256"):
            raise ValueError("Archive digest mismatch.")
        subprocess.run([str(STATE/"node"),str(project/"scripts/verify-backup.mjs"),str(dump)],check=True,timeout=300)
        manifest_path=dump.with_suffix(".manifest.json")
        if manifest_path.stat().st_size>16*1024*1024:
            raise ValueError("Manifest too large.")
        expected=validate_manifest(json.loads(manifest_path.read_text()),dump.name,before[dump.name])
        uploads=dump.with_name(dump.stem+"-uploads.zip")
        upload_count=verify_uploads(uploads)
        name="ars-uninstall-test-"+uuid.uuid4().hex
        created=False
        def run(args,**kwargs):
            return subprocess.run(args,check=True,timeout=900,**kwargs)
        try:
            run(["docker","image","inspect",IMAGE],stdout=subprocess.DEVNULL)
            run(["docker","run","-d","--pull=never","--network","none","--name",name,
                 "--label","com.rsnextward.ars-purpose=uninstall-restore-test",
                 "--tmpfs","/var/lib/postgresql/data:rw,mode=0700",
                 "-e","POSTGRES_USER=restore_admin","-e","POSTGRES_DB=ars_uninstall_test",
                 "-e","POSTGRES_PASSWORD="+secrets.token_hex(32),IMAGE],stdout=subprocess.DEVNULL)
            created=True
            for _ in range(90):
                ready=subprocess.run(["docker","exec",name,"pg_isready","-h","127.0.0.1","-U","restore_admin","-d","ars_uninstall_test"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
                if ready.returncode==0:
                    break
                time.sleep(2)
            else:
                raise RuntimeError("Disposable database unavailable.")
            with dump.open("rb") as stream:
                run(["docker","exec","-i",name,"pg_restore","-U","restore_admin","-d","ars_uninstall_test","--single-transaction","--exit-on-error","--no-owner","--no-acl"],stdin=stream)
            actual=fingerprints(psql_command(["docker","exec","-i",name],"restore_admin","ars_uninstall_test"))
            observation=result(expected,actual,before[dump.name],upload_count)
        finally:
            if created:
                run(["docker","rm","-f","-v",name],stdout=subprocess.DEVNULL)
        if any(read_regular(p)!=raw[k] for k,p in files.items()) or any(sha(p)!=before[p.name] for p in members) or (STATE/"project").resolve(strict=True)!=project:
            raise ValueError("Recovery evidence changed during test.")
        observation.update(uninstallId=folder.name,evidenceDigests={k:hashlib.sha256(v).hexdigest() for k,v in raw.items()},archiveMemberDigests=before)
        with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),"w") as stream:
            json.dump(observation,stream,sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        sync_dir(folder)
        return observation

if __name__=="__main__":
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder",type=Path)
    args=parser.parse_args()
    os.umask(0o077)
    print(json.dumps(inspect(args.folder)))
