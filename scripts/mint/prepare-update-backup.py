#!/usr/bin/env python3
"""Prepare a retained recovery archive before an approved update. Does not activate releases."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

STATE = Path.home()/".local/share/ars-hardware"
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?")

def prepare(version):
    if os.geteuid() == 0 or not VERSION.fullmatch(version):
        raise ValueError("Use a valid staged release as the desktop user.")
    project = (STATE/"project").resolve(strict=True)
    staged = STATE/"staged-releases"/version
    if not staged.is_dir() or staged.is_symlink() or not (staged/"dist/server.cjs").is_file():
        raise ValueError("Stage a verified release first.")
    subprocess.run(["openssl","dgst","-sha256","-verify",str(STATE/"release-signing-public.pem"),"-signature",str(staged/".ars-release-manifest.sig"),str(staged/".ars-release-manifest.json")],check=True)
    manifest=json.loads((staged/".ars-release-manifest.json").read_text())
    if manifest.get("version")!=version or manifest.get("product")!="ARS Distributor" or manifest.get("platform")!="linux-mint":
        raise ValueError("Release manifest does not match the requested update.")
    recovery=STATE/"update-recovery"
    recovery.mkdir(mode=0o700,parents=True,exist_ok=True)
    with (STATE/"update.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        # The existing backup command binds itself to the configured Mint database.
        output=subprocess.run(["python3",str(project/"scripts/mint/backup.py")],cwd=project,stdout=subprocess.PIPE,text=True,check=True).stdout
        paths=[line.split("=",1)[1] for line in output.splitlines() if line.startswith("ARS_ARCHIVE=")]
        if len(paths)!=1:
            raise ValueError("Backup did not return a unique archive path.")
        dump=Path(paths[0]).resolve(strict=True)
        if dump.parent!=(project/"backups").resolve() or dump.suffix!=".dump":
            raise ValueError("Unexpected backup location.")
        with tempfile.TemporaryDirectory(prefix="preflight-",dir=recovery) as tmp:
            folder=Path(tmp)/"snapshot"
            folder.mkdir(mode=0o700)
            files=[dump,Path(str(dump)+".sha256")]
            if "-v2-" in dump.stem:
                manifest = dump.with_suffix(".manifest.json")
                files.extend([manifest, Path(str(manifest) + ".sha256")])
            if dump.name.endswith("-with-uploads.dump"):
                archive=dump.with_name(dump.stem+"-uploads.zip")
                files.extend([archive,Path(str(archive)+".sha256")])
            for source in files:
                shutil.copyfile(source,folder/source.name)
            copied=folder/dump.name
            subprocess.run([str(STATE/"node"),str(project/"scripts/verify-backup.mjs"),str(copied)],check=True)
            # Pin independently from normal rotating backups.
            metadata={"version":version,"previousProject":str(project),"archive":dump.name,
                      "createdAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      "activationApproved":False,"restoreTestPassed":False,
                      "note":"Online preflight backup only. Quiesced fresh backup and compatibility test required before activation."}
            (folder/"recovery.json").write_text(json.dumps(metadata,indent=2)+"\n")
            target=recovery/(version+"-"+dump.stem)
            folder.rename(target)
        print("Pinned recovery archive:",target)
        print("Activation remains blocked; no software switch or database restore performed.")

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    args=parser.parse_args()
    try:
        prepare(args.version)
    except (OSError,ValueError,subprocess.SubprocessError) as error:
        sys.exit("Update backup preparation failed: "+str(error))
