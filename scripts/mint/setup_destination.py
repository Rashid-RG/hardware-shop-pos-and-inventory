"""Copy the manifest-bound acceptance package into a new permanent user folder."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat

def copy_release(source, destination):
    source=source.resolve(strict=True)
    destination=Path(destination)
    if not destination.is_absolute() or destination.parent.resolve(strict=True)!=destination.parent:
        raise RuntimeError("Choose an existing local parent folder without symbolic links.")
    if destination==source or source in destination.parents or destination in source.parents or os.path.lexists(destination):
        raise RuntimeError("Installation destination must be new and separate from the downloaded package.")
    manifest_file=source/"PILOT-FILES.json"
    if manifest_file.is_symlink() or not manifest_file.is_file():
        raise RuntimeError("Use the CI-generated pilot package with its file manifest.")
    manifest=json.loads(manifest_file.read_text())
    if not isinstance(manifest,dict) or not {"package.json","package-lock.json","scripts/mint/install.sh","PILOT-RELEASE.json"}.issubset(manifest):
        raise RuntimeError("Invalid installation package manifest.")
    for name,record in manifest.items():
        p=PurePosixPath(name)
        if not name or p.is_absolute() or str(p)!=name or "\\" in name or any(x in ("..",".git","node_modules","dist","uploads","backups",".ars-node-runtime",".env.local") for x in p.parts):
            raise RuntimeError("Unsafe installation package path.")
        if not isinstance(record,dict) or not isinstance(record.get("mode"),int) or record["mode"] not in (0o644,0o755,0o600):
            raise RuntimeError("Unsupported installation file mode.")
        path=source/name
        if path.resolve(strict=True)!=path or not stat.S_ISREG(path.lstat().st_mode):
            raise RuntimeError("Installation package contains a linked or non-regular file.")
        with path.open("rb") as stream:
            if hashlib.file_digest(stream,"sha256").hexdigest()!=record.get("sha256"):
                raise RuntimeError("Installation package file integrity mismatch: "+name)
    destination.mkdir(mode=0o700)
    # A failed copy remains isolated for inspection; no existing folder is removed.
    for name,record in manifest.items():
        target=destination/name
        target.parent.mkdir(parents=True,exist_ok=True)
        with (source/name).open("rb") as inp, target.open("xb") as out:
            shutil.copyfileobj(inp,out)
        with target.open("rb") as stream:
            if hashlib.file_digest(stream,"sha256").hexdigest()!=record["sha256"]:
                raise RuntimeError("Copied installation file integrity mismatch: "+name)
        target.chmod(record["mode"])
    shutil.copyfile(manifest_file,destination/"PILOT-FILES.json")
    return destination
