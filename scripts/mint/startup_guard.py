"""Read-only startup guard. No database or service modifications."""
import sys
import json
import re
from pathlib import Path
from interrupted_switch import recovery_plan

def migration_mapping_valid(root):
    """Check retained mapping evidence without requiring mutable files to stay unchanged."""
    root=Path(root)
    originals=root/"runtime-migration-originals"
    runtime=root/"runtime"
    if not originals.exists() and not originals.is_symlink():
        return True
    try:
        if originals.is_symlink() or not originals.is_dir() or runtime.is_symlink() or not runtime.is_dir():
            return False
        project=(root/"project").resolve(strict=True)
        if not (root/"project").is_symlink():
            return False
        records=[]
        for name in ("migration-receipt.json","mapping-complete.json"):
            path=runtime/name
            if path.is_symlink() or not path.is_file() or path.stat().st_size>65536:
                return False
            records.append(json.loads(path.read_text()))
        receipt,complete=records
        digest=receipt.get("storageDigest")
        if receipt.get("schema")!=1 or receipt.get("kind")!="mint-runtime-migration-staged" or receipt.get("activationAllowed") is not False or not isinstance(digest,str) or not re.fullmatch(r"[a-f0-9]{64}",digest):
            return False
        if complete!={"schema":1,"storageDigest":digest,"originalsRetained":True,"startupAllowed":False}:
            return False
        for name in (".env.local","uploads","backups"):
            link=project/name
            target=runtime/name
            original=originals/name
            if not link.is_symlink() or link.resolve(strict=True)!=target or target.is_symlink() or original.is_symlink():
                return False
            if name==".env.local":
                if not target.is_file() or not original.is_file():
                    return False
            elif not target.is_dir() or not original.is_dir():
                return False
        return True
    except (OSError,ValueError,TypeError,AttributeError,RuntimeError):
        return False

def startup_allowed(root):
    root=Path(root)
    for name in ("runtime-switch-intent.json","maintenance-hold.json","runtime-activation-interrupted.json","handoff-pending.json","runtime-migration-interrupted.json"):
        entry=root/name
        if entry.exists() or entry.is_symlink():
            return False
    if not migration_mapping_valid(root):
        return False
    journal=root/"switch-journal.json"
    if not journal.exists() and not journal.is_symlink():
        return True
    return recovery_plan(root)["action"] in ("verify-current","verify-previous")

if __name__=="__main__":
    try:
        allowed=startup_allowed(Path.home()/".local/share/ars-hardware")
    except (OSError,ValueError,RuntimeError):
        allowed=False
    if not allowed:
        print("ARS Distributor: interrupted update requires RS Nextward recovery review. No database restore was attempted.",file=sys.stderr)
        sys.exit(1)
