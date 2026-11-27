#!/usr/bin/env python3
"""Extract root-owned setup media into a new user-private folder; never run as root."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

def main():
    media=Path(__file__).resolve().parent
    payload=media/"payload.zip"
    with payload.open("rb") as stream:
        if hashlib.file_digest(stream,"sha256").hexdigest()!= (media/"payload.sha256").read_text().strip():
            raise RuntimeError("Setup media integrity mismatch.")
    with zipfile.ZipFile(payload) as archive:
        names=set()
        for item in archive.infolist():
            p=PurePosixPath(item.filename)
            if str(p)!=item.filename or not p.parts or p.parts[0]!="ARS-Distributor" or len(p.parts)<2 or ".." in p.parts or "\\" in item.filename or item.filename in names or item.is_dir():
                raise RuntimeError("Invalid setup archive path.")
            kind=stat.S_IFMT(item.external_attr>>16)
            if kind not in (0,stat.S_IFREG):
                raise RuntimeError("Unsupported setup archive entry.")
            names.add(item.filename)
        if not {"ARS-Distributor/PILOT-FILES.json","ARS-Distributor/scripts/mint/setup-wizard.py"}.issubset(names) or archive.testzip() is not None:
            raise RuntimeError("Invalid setup archive.")
        if sys.argv[1:]==["--verify-payload"]:
            return 0
        if len(sys.argv)!=1 or os.geteuid()==0:
            raise RuntimeError("Open Setup as your regular desktop user.")
        if subprocess.run(["zenity","--question","--no-markup","--title=RS Nextward Setup","--text=Thank you for choosing RS Nextward. Open the ARS Distributor pilot setup wizard?"]).returncode:
            return 0
        parent=Path.home()/".local/share"
        parent.mkdir(parents=True,exist_ok=True)
        if parent.resolve()!=parent:
            raise RuntimeError("Linked setup storage is unsupported.")
        folder=Path(tempfile.mkdtemp(prefix="ars-pilot-setup-",dir=parent))
        for item in archive.infolist():
            target=folder/item.filename
            target.parent.mkdir(parents=True,exist_ok=True)
            with archive.open(item) as inp,target.open("xb") as out:
                shutil.copyfileobj(inp,out)
            target.chmod((item.external_attr>>16)&0o755 or 0o644)
        root=folder/"ARS-Distributor"
        return subprocess.run([sys.executable,str(root/"scripts/mint/setup-wizard.py")],cwd=root).returncode

if __name__=="__main__":
    try:
        raise SystemExit(main())
    except (OSError,RuntimeError,ValueError,zipfile.BadZipFile) as error:
        if "--verify-payload" in sys.argv:
            print(error,file=sys.stderr)
        else:
            subprocess.run(["zenity","--error","--no-markup","--title=RS Nextward Setup","--text="+str(error)])
        raise SystemExit(1)
