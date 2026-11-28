#!/usr/bin/env python3
"""Prepare both platform update bundles from one exact, committed release.

Offline packaging only: does not publish, generate production keys, or activate POS.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

def git(*args):
    return subprocess.check_output(["git",*args])

def included(name):
    path=PurePosixPath(name)
    if any(part in (".git",".github","dist","node_modules","uploads","backups","installer-runtime","__pycache__")
           or part.startswith((".env",".ars-release")) for part in path.parts):
        return False
    if path.suffix.lower() in (".pem",".key",".p12",".pfx",".dump",".backup",".sqlite",".db",".pyc",".pyo"):
        return False
    return True

def verify_feed(root,version,public_key):
    """Read-only verification of the exact signed public assets before publishing."""
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Invalid feed directory.")
    for platform,name in (("windows","release.zip"),("linux-mint","release.tar.gz")):
        folder=root/platform
        if folder.is_symlink() or not folder.is_dir() or {p.name for p in folder.iterdir()}!={name,"manifest.json","manifest.sig"}:
            raise ValueError("Unexpected feed inventory.")
        archive,manifest,signature=(folder/n for n in (name,"manifest.json","manifest.sig"))
        for path,limit in ((archive,512*1024*1024),(manifest,65536),(signature,16384)):
            if path.is_symlink() or not path.is_file() or not 0<path.stat().st_size<=limit:
                raise ValueError("Invalid feed asset.")
        subprocess.run(["openssl","dgst","-sha256","-verify",str(public_key),"-signature",str(signature),str(manifest)],check=True)
        data=json.loads(manifest.read_bytes())
        with archive.open("rb") as stream:
            digest=hashlib.file_digest(stream,"sha256").hexdigest()
        if any(data.get(k)!=v for k,v in {"product":"ARS Distributor","platform":platform,"version":version,"sha256":digest}.items()):
            raise ValueError("Signed feed asset mismatch.")
    return True

def prepare(commit,version,private_key,public_key,output):
    if not re.fullmatch(r"[a-f0-9]{40}",commit) or git("rev-parse","HEAD").decode().strip()!=commit:
        raise ValueError("Exact checked-out release commit required.")
    if not re.fullmatch(r"(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})",version):
        raise ValueError("Stable version required.")
    if json.loads(git("show",commit+":package.json"))["version"]!=version:
        raise ValueError("Release version does not match package.json.")
    if os.path.lexists(output):
        raise FileExistsError(output)
    spec=importlib.util.spec_from_file_location("signer",Path(__file__).with_name("sign-update-release.py"))
    signer=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(signer)
    entries=[]
    seen=set()
    for raw in git("ls-tree","-r","-z",commit).split(b"\0"):
        if not raw: continue
        meta,name=raw.split(b"\t",1)
        name=name.decode("utf-8")
        if not included(name): continue
        mode,kind,oid=meta.decode().split()
        if kind!="blob" or mode not in ("100644","100755"):
            raise ValueError("Unsupported committed entry: "+name)
        for part in PurePosixPath(name).parts:
            if not re.fullmatch(r"[a-zA-Z0-9_.@+ -]+",part) or part.endswith(("."," ")) or part in (".","..") or re.match(r"(?i)^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)",part):
                raise ValueError("Unsupported Windows archive path: "+name)
        if name.casefold() in seen:
            raise ValueError("Case-insensitive duplicate archive path.")
        seen.add(name.casefold())
        entries.append((name,int(mode,8)&0o777,oid))
    required={"package.json","package-lock.json","scripts/mint/compose.yaml","scripts/windows-pilot-compose.yml"}
    if not required.issubset({x[0] for x in entries}) or len(entries)>25000:
        raise ValueError("Missing or excessive release entries.")
    with tempfile.TemporaryDirectory(prefix=".ars-feed-",dir=output.parent) as tmp:
        temp=Path(tmp)
        stage=temp/"feed"
        stage.mkdir(mode=0o700)
        windows=temp/"release.zip"
        mint=temp/"release.tar.gz"
        total=0
        with zipfile.ZipFile(windows,"w",compression=zipfile.ZIP_DEFLATED) as z, tarfile.open(mint,"w:gz") as t:
            for name,mode,oid in sorted(entries):
                data=git("cat-file","blob",oid)
                total+=len(data)
                if total>512*1024*1024:
                    raise ValueError("Release exceeds extraction limit.")
                zi=zipfile.ZipInfo(name,(2026,1,1,0,0,0))
                zi.create_system=3
                zi.external_attr=(0o100000|mode)<<16
                zi.compress_type=zipfile.ZIP_DEFLATED
                z.writestr(zi,data)
                ti=tarfile.TarInfo(name)
                ti.size=len(data)
                ti.mode=mode
                t.addfile(ti,io.BytesIO(data))
        for platform,archive in (("windows",windows),("linux-mint",mint)):
            signer.sign_release(platform,version,archive,private_key,public_key,stage/platform)
        verify_feed(stage,version,public_key)
        # Only signed public artifacts are exported; never copy signing keys.
        (stage/"release-record.json").write_text(json.dumps({"commit":commit,"version":version,"published":False,"liveUpdatesApproved":False},sort_keys=True)+"\n")
        if os.path.lexists(output):
            raise FileExistsError(output)
        # Reserve a fresh output directory; never replace an existing feed.
        output.mkdir(mode=0o700)
        try:
            for child in stage.iterdir():
                child.rename(output/child.name)
        except Exception:
            shutil.rmtree(output)
            raise

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit",required=True)
    parser.add_argument("--version",required=True)
    for name in ("private-key","public-key","output"):
        parser.add_argument("--"+name,type=Path,required=True)
    prepare(**vars(parser.parse_args()))
