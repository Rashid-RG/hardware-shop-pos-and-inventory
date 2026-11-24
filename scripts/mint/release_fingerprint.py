"""Fingerprint a staged build, including dependency files and internal symbolic links."""
import hashlib
import os
from pathlib import Path
import stat
import json

def fingerprint(root):
    root=Path(root).resolve(strict=True)
    h=hashlib.sha256()
    for directory,dirs,files in os.walk(root,followlinks=False):
        dirs.sort()
        files.sort()
        for name in sorted(dirs+files):
            p=Path(directory)/name
            rel=p.relative_to(root).as_posix()
            mode=p.lstat().st_mode
            if stat.S_ISLNK(mode):
                target=os.readlink(p)
                if Path(target).is_absolute() or not p.resolve(strict=True).is_relative_to(root):
                    raise ValueError("Release contains an external symbolic link: "+rel)
                entry=[rel,"link",target]
            elif stat.S_ISDIR(mode):
                entry=[rel,"directory",mode&0o777]
            elif stat.S_ISREG(mode):
                with p.open("rb") as stream:
                    digest=hashlib.file_digest(stream,"sha256").hexdigest()
                entry=[rel,"file",mode&0o777,p.stat().st_size,digest]
            else:
                raise ValueError("Unsupported release filesystem entry: "+rel)
            h.update((json.dumps(entry,ensure_ascii=True,separators=(",",":"))+"\n").encode())
    return h.hexdigest()
