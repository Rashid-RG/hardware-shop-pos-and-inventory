#!/usr/bin/env python3
"""Prepare permanent runtime storage. Existing installations require explicit migration."""
import argparse
import os
from pathlib import Path
import secrets
import sys

STATE=Path.home()/".local/share/ars-hardware"
RUNTIME=STATE/"runtime"

def migration_inventory(project):
    """Read-only legacy storage inventory; never copy credentials or alter paths."""
    import stat
    project=project.resolve(strict=True)
    if not (STATE/"project").is_symlink() or (STATE/"project").resolve(strict=True)!=project:
        raise ValueError("Registered project required.")
    if STATE.resolve(strict=True)!=STATE or RUNTIME.is_symlink():
        raise ValueError("Unexpected linked runtime directory.")
    entries=[]
    for name in (".env.local","uploads","backups"):
        source=project/name
        target=RUNTIME/name
        if source.is_symlink():
            status="already-mapped" if not target.is_symlink() and source.resolve()==target and target.exists() else "unsafe-link"
        elif not source.exists():
            status="missing-source"
        elif not (stat.S_ISREG(source.lstat().st_mode) if name==".env.local" else stat.S_ISDIR(source.lstat().st_mode)):
            status="invalid-source"
        elif os.path.lexists(target):
            status="destination-conflict"
        else:
            status="legacy-source"
        entries.append({"name":name,"status":status})
    return {"schema":1,"kind":"mint-runtime-migration-inventory","entries":entries,"migrationAllowed":False,"requiresVerifiedBackup":True}

def storage_manifest(root):
    import hashlib
    import stat
    root=Path(root)
    if root.resolve(strict=True)!=root or not root.is_dir():
        raise ValueError("Invalid storage root.")
    result={}
    def visit(path, relative):
        info=path.lstat()
        if stat.S_ISDIR(info.st_mode):
            result[relative]=("directory",)
            for child in sorted(path.iterdir()):
                visit(child,relative+"/"+child.name)
        elif stat.S_ISREG(info.st_mode):
            with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),"rb") as stream:
                before=os.fstat(stream.fileno())
                digest=hashlib.file_digest(stream,"sha256").hexdigest()
                after=os.fstat(stream.fileno())
            def identity(item):
                return (item.st_dev,item.st_ino,item.st_size,item.st_mtime_ns,item.st_ctime_ns)
            if identity(info)!=identity(before) or identity(before)!=identity(after):
                raise ValueError("Legacy file changed during verification.")
            result[relative]=("file",info.st_size,digest)
        else:
            raise ValueError("Unsupported legacy storage entry.")
    for name in (".env.local","uploads","backups"):
        visit(root/name,name)
    return result

def copy_legacy_storage(source, destination):
    """Copy to a new private staging directory. No source deletion or activation."""
    import hashlib
    import stat
    import shutil
    source=Path(source)
    destination=Path(destination)
    if source.resolve(strict=True)!=source or destination.parent.resolve(strict=True)!=destination.parent:
        raise ValueError("Linked storage path rejected.")
    if destination==source or source in destination.parents or os.path.lexists(destination):
        raise ValueError("Destination must be new and outside source.")
    before=storage_manifest(source)
    destination.mkdir(mode=0o700)
    # On failure retain partial staging for review; do not delete source data.
    for name in (".env.local","uploads","backups"):
        entry=source/name
        if entry.is_dir():
            shutil.copytree(entry,destination/name,symlinks=True)
        elif entry.is_file():
            shutil.copy2(entry,destination/name,follow_symlinks=False)
        else:
            raise ValueError("Missing legacy storage entry.")
    after=storage_manifest(source)
    copied=storage_manifest(destination)
    if before!=after or before!=copied:
        raise ValueError("Legacy storage changed or copy verification failed.")
    os.chmod(destination/".env.local",0o600)
    return {"verified":True,"files":sum(v[0]=="file" for v in copied.values()),"activationAllowed":False}

def verify_staged_storage(project, destination):
    """Detect stale or modified copies before any runtime mapping is changed."""
    import json
    import hashlib
    import stat
    from switch_journal import sync_dir
    project=Path(project)
    destination=Path(destination)
    original=storage_manifest(project)
    copied=storage_manifest(destination)
    if original!=copied:
        raise ValueError("Staged storage differs from the original installation.")
    if original.get(".env.local",())[0]!="file" or any(original.get(name,())[0]!="directory" for name in ("uploads","backups")):
        raise ValueError("Unexpected runtime storage types.")
    if stat.S_IMODE(destination.stat().st_mode)&0o077 or stat.S_IMODE((destination/".env.local").stat().st_mode)&0o077:
        raise ValueError("Staged credentials are not private.")
    # Flush copied files and directories before retaining a successful receipt.
    for name,entry in copied.items():
        path=destination/name
        if entry[0]=="file":
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    for name,entry in reversed(list(copied.items())):
        if entry[0]=="directory":
            sync_dir(destination/name)
    sync_dir(destination)
    if storage_manifest(project)!=original or storage_manifest(destination)!=original:
        raise ValueError("Storage changed during durable verification.")
    return hashlib.sha256(json.dumps(original,sort_keys=True,separators=(",",":")).encode()).hexdigest()

def rehearse_runtime_mapping(root, fail_after=None):
    """Exercise retained originals and runtime links in a disposable fixture only."""
    from switch_journal import sync_dir
    root=Path(root)
    if root.resolve(strict=True)!=root or not (root/".ars-runtime-test").is_file() or (root/".ars-runtime-test").is_symlink():
        raise ValueError("Disposable runtime test directory required.")
    project=root/"legacy"
    staged=root/"staged"
    runtime=root/"runtime"
    retained=root/"originals"
    if any(os.path.lexists(p) for p in (runtime,retained)):
        raise ValueError("Runtime rehearsal destination already exists.")
    digest=verify_staged_storage(project,staged)
    retained.mkdir(mode=0o700)
    staged.rename(runtime)
    sync_dir(root)
    names=(".env.local","uploads","backups")
    try:
        for index,name in enumerate(names,1):
            (project/name).rename(retained/name)
            (project/name).symlink_to(runtime/name,target_is_directory=name!=".env.local")
            sync_dir(project)
            sync_dir(retained)
            if fail_after==index:
                raise RuntimeError("Injected mapping failure.")
        if verify_staged_storage(retained,runtime)!=digest:
            raise ValueError("Runtime fingerprint mismatch.")
        if any(not (project/n).is_symlink() or (project/n).resolve(strict=True)!=runtime/n for n in names):
            raise ValueError("Runtime mapping mismatch.")
        return {"mapped":True,"originalsRetained":True,"activationAllowed":False}
    except Exception:
        for name in reversed(names):
            original=retained/name
            link=project/name
            if os.path.lexists(original):
                if link.is_symlink() and link.resolve(strict=True)==runtime/name:
                    link.unlink()
                if os.path.lexists(link):
                    raise RuntimeError("Unexpected rollback destination; preserve all files.")
                original.rename(link)
        sync_dir(project)
        sync_dir(retained)
        if verify_staged_storage(project,runtime)!=digest:
            raise RuntimeError("Rollback verification failed.")
        raise

def stage_migration(project, folder, confirmation):
    """Retain a verified private copy under the maintenance hold; never activate."""
    import json
    import hashlib
    import fcntl
    import subprocess
    from resume_maintenance import open_lock
    from maintenance_backup import stopped, check_database_clients
    from switch_journal import sync_dir
    if os.geteuid()==0 or confirmation!="STAGE RUNTIME MIGRATION":
        raise ValueError("Explicit desktop-user staging approval required.")
    project=project.resolve(strict=True)
    folder=Path(folder)
    if not folder.is_absolute() or folder.resolve(strict=True)!=folder or folder.parent!=STATE/"update-recovery":
        raise ValueError("Managed recovery folder required.")
    def evidence(path):
        if path.is_symlink() or not path.is_file() or path.stat().st_size>65536:
            raise ValueError("Invalid migration evidence.")
        return path.read_bytes()
    with open_lock(STATE/"maintenance.lock") as maintenance, open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        inventory=migration_inventory(project)
        if any(e["status"]!="legacy-source" for e in inventory["entries"]) or os.path.lexists(RUNTIME):
            raise ValueError("Migration requires three legacy sources and an absent runtime destination.")
        for name in ("runtime-switch-intent.json","runtime-activation-interrupted.json","handoff-pending.json","switch-journal.json"):
            if os.path.lexists(STATE/name):
                raise ValueError("Unresolved update evidence.")
        for name in (".ars-drive-backup.lock",".ars-local-backup.lock",".ars-drive-recovery.lock"):
            if os.path.lexists(project/"backups"/name):
                raise ValueError("Active or interrupted backup detected.")
        hold=evidence(STATE/"maintenance-hold.json")
        meta=evidence(folder/"recovery.json")
        receipt=evidence(folder/"maintenance-backup-receipt.json")
        restore=evidence(folder/"restore-test.json")
        h,m,r,v=map(json.loads,(hold,meta,receipt,restore))
        sha=lambda data:hashlib.sha256(data).hexdigest()
        if h.get("purpose")!="pre-update backup" or h.get("previousProject")!=str(project) or m.get("previousProject")!=str(project) or h.get("version")!=m.get("version") or m.get("activationApproved") is not False:
            raise ValueError("Maintenance hold mismatch.")
        if r.get("kind")!="mint-maintenance-backup-observation" or r.get("holdDigest")!=sha(hold) or r.get("recoveryDigest")!=sha(meta) or r.get("locksObserved") is not True or r.get("activationAllowed") is not False or r.get("archive")!=m.get("archive"):
            raise ValueError("Protected backup receipt mismatch.")
        archive=m.get("archive")
        if not isinstance(archive,str) or Path(archive).name!=archive or not archive.endswith(".dump"):
            raise ValueError("Invalid archive name.")
        dump=folder/archive
        if dump.is_symlink() or not dump.is_file():
            raise ValueError("Missing protected archive.")
        with dump.open("rb") as stream:
            digest=hashlib.file_digest(stream,"sha256").hexdigest()
        if v.get("archiveSha256")!=digest or v.get("archive")!=archive or v.get("version")!=m.get("version") or v.get("restoreTestPassed") is not True:
            raise ValueError("Verified restoration required.")
        stopped()
        check_database_clients(project)
        subprocess.run([str(STATE/"node"),str(project/"scripts/verify-backup.mjs"),str(dump)],check=True,stdout=subprocess.DEVNULL,timeout=180)
        destination=STATE/"runtime-migration-staged"
        result=copy_legacy_storage(project,destination)
        stopped()
        check_database_clients(project)
        if any(evidence(p)!=raw for p,raw in ((STATE/"maintenance-hold.json",hold),(folder/"recovery.json",meta),(folder/"maintenance-backup-receipt.json",receipt),(folder/"restore-test.json",restore))) or migration_inventory(project)!=inventory:
            raise ValueError("Migration evidence changed.")
        storage_digest=verify_staged_storage(project,destination)
        record={"schema":1,"kind":"mint-runtime-migration-staged","storageDigest":storage_digest,"source":str(project),"archiveSha256":digest,"holdDigest":sha(hold),"files":result["files"],"activationAllowed":False}
        with (destination/"migration-receipt.json").open("x") as stream:
            json.dump(record,stream)
            stream.flush()
            os.fsync(stream.fileno())
        sync_dir(destination)
        sync_dir(STATE)
        return record

def map_staged_runtime(project, confirmation):
    """Explicit offline mapping of verified storage. Never starts POS or changes SQL."""
    import json
    import hashlib
    import fcntl
    from resume_maintenance import open_lock
    from maintenance_backup import stopped, check_database_clients
    from switch_journal import sync_dir
    if os.geteuid()==0 or confirmation!="MAP VERIFIED RUNTIME":
        raise ValueError("Explicit desktop-user mapping approval required.")
    project=Path(project).resolve(strict=True)
    staged=STATE/"runtime-migration-staged"
    originals=STATE/"runtime-migration-originals"
    marker=STATE/"runtime-migration-interrupted.json"
    hold=STATE/"maintenance-hold.json"
    names=(".env.local","uploads","backups")
    def evidence(path):
        if path.resolve(strict=True)!=path or not path.is_file() or path.stat().st_size>65536:
            raise ValueError("Invalid migration evidence.")
        return path.read_bytes()
    with open_lock(STATE/"maintenance.lock") as maintenance, open_lock(STATE/"update.lock") as update:
        for lock in (maintenance,update):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if any(os.path.lexists(p) for p in (RUNTIME,originals,marker)):
            raise ValueError("Existing migration destination or incident requires review.")
        for name in ("runtime-switch-intent.json","runtime-activation-interrupted.json","handoff-pending.json","switch-journal.json"):
            if os.path.lexists(STATE/name):
                raise ValueError("Unresolved update evidence.")
        if any(e["status"]!="legacy-source" for e in migration_inventory(project)["entries"]):
            raise ValueError("Legacy runtime layout changed.")
        hold_raw=evidence(hold)
        receipt_raw=evidence(staged/"migration-receipt.json")
        h,receipt=map(json.loads,(hold_raw,receipt_raw))
        if h.get("purpose")!="pre-update backup" or h.get("previousProject")!=str(project) or receipt.get("schema")!=1 or receipt.get("kind")!="mint-runtime-migration-staged" or receipt.get("source")!=str(project) or receipt.get("holdDigest")!=hashlib.sha256(hold_raw).hexdigest() or receipt.get("activationAllowed") is not False:
            raise ValueError("Staged migration receipt does not match maintenance hold.")
        stopped()
        check_database_clients(project)
        digest=verify_staged_storage(project,staged)
        if digest!=receipt.get("storageDigest") or evidence(hold)!=hold_raw or evidence(staged/"migration-receipt.json")!=receipt_raw:
            raise ValueError("Staged migration is stale.")
        for name in (".ars-drive-backup.lock",".ars-local-backup.lock",".ars-drive-recovery.lock"):
            if os.path.lexists(project/"backups"/name):
                raise ValueError("Active or interrupted backup detected.")
        # The existing maintenance hold stays in place throughout. A separate
        # durable marker prevents a failed mapping from being mistaken for a
        # normal cancelled update.
        with os.fdopen(os.open(marker,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),"w") as stream:
            json.dump({"schema":1,"kind":"mint-runtime-mapping-interrupted","source":str(project),"storageDigest":digest,"startupAllowed":False},stream)
            stream.flush()
            os.fsync(stream.fileno())
        sync_dir(STATE)
        originals.mkdir(mode=0o700)
        staged.rename(RUNTIME)
        sync_dir(STATE)
        for name in names:
            (project/name).rename(originals/name)
            sync_dir(originals)
            sync_dir(project)
            (project/name).symlink_to(RUNTIME/name,target_is_directory=name!=".env.local")
            sync_dir(project)
        if verify_staged_storage(originals,RUNTIME)!=digest or any(not (project/n).is_symlink() or (project/n).resolve(strict=True)!=RUNTIME/n for n in names):
            raise ValueError("Runtime mapping verification failed; maintenance remains active.")
        stopped()
        check_database_clients(project)
        if evidence(hold)!=hold_raw or evidence(RUNTIME/"migration-receipt.json")!=receipt_raw:
            raise ValueError("Maintenance evidence changed.")
        # Retain evidence and original files; operator must separately resume.
        with (RUNTIME/"mapping-complete.json").open("x") as stream:
            json.dump({"schema":1,"storageDigest":digest,"originalsRetained":True,"startupAllowed":False},stream)
            stream.flush()
            os.fsync(stream.fileno())
        sync_dir(RUNTIME)
        marker.unlink()
        sync_dir(STATE)
        return {"mapped":True,"originalsRetained":True,"maintenanceRetained":True,"startupAllowed":False}

def prepare(project):
    if os.geteuid()==0:
        raise ValueError("Run setup as the desktop user.")
    project=project.resolve(strict=True)
    active=STATE/"project"
    if os.path.lexists(active):
        # An installer is not an update or recovery tool. Never rebuild or
        # restart an already registered installation in place.
        raise ValueError("An installation is already registered. Use the Update Center or RS Nextward recovery support.")
    if STATE.is_symlink() or STATE.resolve()!=STATE:
        raise ValueError("Unexpected linked installation directory.")
    for name in ("maintenance-hold.json","runtime-switch-intent.json","runtime-activation-interrupted.json","handoff-pending.json","switch-journal.json"):
        if os.path.lexists(STATE/name):
            raise ValueError("Existing recovery evidence requires review before installation.")
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    if RUNTIME.is_symlink():
        raise ValueError("Runtime directory must not be a symbolic link.")
    RUNTIME.mkdir(mode=0o700,exist_ok=True)
    os.chmod(RUNTIME,0o700)
    # Never silently import or replace existing credentials, uploads or backups.
    for name in (".env.local","uploads","backups"):
        old=project/name
        target=RUNTIME/name
        if old.exists() or old.is_symlink():
            if not old.is_symlink() or old.resolve()!=target.resolve():
                raise ValueError("Existing project runtime data requires reviewed migration: "+name)
        if target.is_symlink():
            raise ValueError("Unexpected runtime symbolic link: "+name)
    config=RUNTIME/".env.local"
    if not config.exists():
        # An existing Docker volume could contain a database with a different password.
        import subprocess
        volumes=subprocess.run(["docker","volume","ls","--filter","label=com.docker.compose.project=ars-mint","--format","{{.Name}}"],check=True,capture_output=True,text=True)
        if volumes.stdout.strip():
            raise ValueError("Existing ARS database volume detected. Preserve its original credentials and use recovery support.")
        password=secrets.token_hex(32)
        with os.fdopen(os.open(config,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as stream:
            stream.write(f"ARS_MINT_DB_PASSWORD={password}\nDATABASE_URL=postgresql://ars:{password}@127.0.0.1:5434/hardware_pos_ars\nJWT_SECRET={secrets.token_hex(48)}\n")
    if not config.is_file():
        raise ValueError("Runtime configuration must be a regular file.")
    os.chmod(config,0o600)
    lines=config.read_text().splitlines()
    passwords=[x.partition("=")[2] for x in lines if x.startswith("ARS_MINT_DB_PASSWORD=")]
    if len(passwords)!=1 or not passwords[0] or [x for x in lines if x.startswith("DATABASE_URL=")]!=[f"DATABASE_URL=postgresql://ars:{passwords[0]}@127.0.0.1:5434/hardware_pos_ars"]:
        raise ValueError("Unexpected runtime database configuration.")
    for name in ("uploads","backups"):
        target=RUNTIME/name
        target.mkdir(mode=0o700,exist_ok=True)
        if not target.is_dir():
            raise ValueError("Runtime storage is not a directory: "+name)
    for name in (".env.local","uploads","backups"):
        link=project/name
        if not link.is_symlink():
            link.symlink_to(RUNTIME/name,target_is_directory=name!=".env.local")
    print("Permanent runtime storage prepared:",RUNTIME)

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project",type=Path)
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument("--inventory",action="store_true")
    mode.add_argument("--stage",type=Path)
    mode.add_argument("--map-staged",action="store_true")
    parser.add_argument("--confirmation",default="")
    args=parser.parse_args()
    try:
        if args.inventory:
            import json
            print(json.dumps(migration_inventory(args.project)))
        elif args.stage:
            import json
            print(json.dumps(stage_migration(args.project,args.stage,args.confirmation)))
        elif args.map_staged:
            import json
            print(json.dumps(map_staged_runtime(args.project,args.confirmation)))
        else:
            prepare(args.project)
    except (OSError,ValueError) as error:
        sys.exit("Runtime preparation blocked: "+str(error))
