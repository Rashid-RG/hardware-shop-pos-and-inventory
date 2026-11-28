"""Fingerprint a staged build, including dependency files and internal symbolic links."""
import hashlib
import os
from pathlib import Path
import stat
import json

def fingerprint(root, runtime=None):
    root=Path(root).resolve(strict=True)
    h=hashlib.sha256()
    for directory,dirs,files in os.walk(root,followlinks=False):
        dirs.sort()
        files.sort()
        for name in sorted(dirs+files):
            p=Path(directory)/name
            rel=p.relative_to(root).as_posix()
            if runtime is not None and rel in (".env.local","uploads","backups"):
                target=Path(runtime)/rel
                if not p.is_symlink() or target.is_symlink() or p.resolve(strict=True)!=target.resolve(strict=True):
                    raise ValueError("Unexpected runtime mapping: "+rel)
                continue
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


def recovery_tools_fingerprint(project):
    """Observe the scripts tree, excluding generated Python caches.

    This is local integrity evidence, not a publisher signature.
    Reject symlinks and nonregular entries rather than following them.
    """
    root=Path(project)/"scripts"
    if root.resolve(strict=True)!=root or not root.is_dir():
        raise ValueError("Plain recovery scripts directory required.")
    h=hashlib.sha256(b"ars-recovery-tools-v1\n")
    def identity(s):
        return (s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    def walk_error(error):
        raise error
    for directory,dirs,files in os.walk(root,followlinks=False,onerror=walk_error):
        dirs.sort()
        files.sort()
        for name in list(dirs):
            p=Path(directory)/name
            if not stat.S_ISDIR(p.lstat().st_mode):
                raise ValueError("Unexpected recovery directory entry.")
            if name=="__pycache__":
                dirs.remove(name)
        for name in sorted(dirs+files):
            p=Path(directory)/name
            rel=p.relative_to(root).as_posix()
            initial=p.lstat()
            if stat.S_ISDIR(initial.st_mode):
                entry=[rel,"directory",initial.st_mode&0o777]
            elif stat.S_ISREG(initial.st_mode):
                if name.endswith((".pyc",".pyo")):
                    raise ValueError("Unexpected standalone Python bytecode.")
                with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK),"rb") as stream:
                    before=os.fstat(stream.fileno())
                    if not stat.S_ISREG(before.st_mode) or identity(before)!=identity(initial):
                        raise ValueError("Recovery file replaced.")
                    digest=hashlib.file_digest(stream,"sha256").hexdigest()
                    if identity(os.fstat(stream.fileno()))!=identity(before) or identity(p.lstat())!=identity(before):
                        raise ValueError("Recovery file changed.")
                entry=[rel,"file",before.st_mode&0o777,before.st_size,digest]
            else:
                raise ValueError("Unexpected recovery file entry.")
            h.update((json.dumps(entry,ensure_ascii=True,separators=(",",":"))+"\n").encode())
    return h.hexdigest()
