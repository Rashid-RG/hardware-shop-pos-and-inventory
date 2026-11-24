"""Download a selected encrypted backup; never restore or overwrite business data."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

STATE=Path.home()/".local/share/ars-hardware"
NAME=re.compile(r"ars-[a-zA-Z0-9_-]+-(with-uploads|database-only)")
REMOTE="ars-encrypted:daily"
BACKING="ars-drive:ARS-Backups"

def run(*args):
    return subprocess.run(["rclone",*args],check=True,capture_output=True,text=True,timeout=1800).stdout

def check_remotes():
    types=run("listremotes","--long")
    if not re.search(r"^ars-drive:\s+drive\s*$",types,re.M) or not re.search(r"^ars-encrypted:\s+crypt\s*$",types,re.M):
        raise ValueError("Configure the ARS Drive and encrypted remotes first.")

def list_sets():
    check_remotes()
    return sorted({line.rstrip("/") for line in run("lsf",REMOTE,"--dirs-only","--max-depth","1","--crypt-remote",BACKING).splitlines() if NAME.fullmatch(line.rstrip("/"))},reverse=True)

def download(stem):
    if stem not in list_sets():
        raise ValueError("Backup is not a listed managed encrypted set.")
    project=(STATE/"project").resolve(strict=True)
    root=STATE/"downloaded-recovery"
    root.mkdir(mode=0o700,exist_ok=True)
    if root.is_symlink():
        raise ValueError("Unexpected recovery folder link.")
    files=[stem+".dump",stem+".dump.sha256"]
    if stem.endswith("-with-uploads"):
        files.extend([stem+"-uploads.zip",stem+"-uploads.zip.sha256"])
    with tempfile.TemporaryDirectory(prefix=".download-",dir=root) as tmp:
        folder=Path(tmp)/"verified"
        folder.mkdir(mode=0o700)
        for name in files:
            run("copyto",REMOTE+"/"+stem+"/"+name,str(folder/name),"--crypt-remote",BACKING,"--immutable")
        subprocess.run([str(STATE/"node"),str(project/"scripts/verify-backup.mjs"),str(folder/files[0])],check=True,timeout=300)
        target=root/(stem+"-"+uuid.uuid4().hex)
        folder.rename(target)
        print("Verified local recovery copy:",target)
        print("No database restore was performed.")

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--list",action="store_true")
    group.add_argument("--download")
    args=parser.parse_args()
    try:
        if args.list:
            for stem in list_sets(): print(stem)
        else: download(args.download)
    except (OSError,ValueError,subprocess.SubprocessError) as error:
        sys.exit("Encrypted recovery download failed: "+str(error))
