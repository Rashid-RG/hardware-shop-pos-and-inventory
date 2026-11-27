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
    parser.add_argument("--inventory",action="store_true")
    args=parser.parse_args()
    try:
        if args.inventory:
            import json
            print(json.dumps(migration_inventory(args.project)))
        else:
            prepare(args.project)
    except (OSError,ValueError) as error:
        sys.exit("Runtime preparation blocked: "+str(error))
