#!/usr/bin/env python3
"""Read-only activation preflight. Never switch code or restore a live database."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import shutil
from release_fingerprint import fingerprint

STATE=Path.home()/".local/share/ars-hardware"

def sha(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f,"sha256").hexdigest()

def plan(folder):
    folder=folder.resolve(strict=True)
    if folder.parent!=(STATE/"update-recovery").resolve(strict=True):
        raise ValueError("Choose a managed recovery folder.")
    meta=json.loads((folder/"recovery.json").read_text())
    receipt=json.loads((folder/"restore-test.json").read_text())
    version=meta.get("version","")
    if not isinstance(version,str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?",version):
        raise ValueError("Invalid version.")
    current=(STATE/"project").resolve(strict=True)
    staged=STATE/"staged-releases"/version
    if staged.is_symlink() or not (staged/"dist/server.cjs").is_file():
        raise ValueError("Staged release unavailable.")
    if str(current)!=meta.get("previousProject"):
        raise ValueError("Active installation changed; prepare a new backup.")
    archive=meta.get("archive","")
    if not isinstance(archive,str) or not re.fullmatch(r"ars-mint-\d{8}T\d{6}Z-[0-9a-f]{32}-(with-uploads|database-only)\.dump",archive):
        raise ValueError("Invalid archive reference.")
    dump=folder/archive
    subprocess.run([str(STATE/"node"),str(current/"scripts/verify-backup.mjs"),str(dump)],check=True)
    if receipt.get("version")!=version or receipt.get("archive")!=archive or receipt.get("archiveSha256")!=sha(dump) or receipt.get("restoreTestPassed") is not True or receipt.get("migrationCompatibilityPassed") is not True:
        raise ValueError("Matching successful restoration and compatibility results required.")
    subprocess.run(["openssl","dgst","-sha256","-verify",str(STATE/"release-signing-public.pem"),"-signature",str(staged/".ars-release-manifest.sig"),str(staged/".ars-release-manifest.json")],check=True)
    manifest=json.loads((staged/".ars-release-manifest.json").read_text())
    if manifest.get("version")!=version or manifest.get("product")!="ARS Distributor" or manifest.get("platform")!="linux-mint":
        raise ValueError("Manifest mismatch.")
    if receipt.get('buildFingerprint')!=fingerprint(staged):
        raise ValueError('Exact staged build differs from compatibility-tested files. Repeat compatibility test.')
    if receipt.get("backwardStartupPassed") is not True:
        raise ValueError("Successful previous-version startup test required.")
    with tempfile.TemporaryDirectory(prefix="ars-preflight-old-") as temp:
        old=Path(temp)
        for part in ("dist","node_modules"):
            shutil.copytree(current/part,old/part,symlinks=True)
        if receipt.get("previousBuildFingerprint")!=fingerprint(old):
            raise ValueError("Previous application changed since backward compatibility test.")
    runtime=STATE/"runtime"
    stable=not runtime.is_symlink() and all((current/name).is_symlink() and (current/name).resolve()==(runtime/name).resolve() and (runtime/name).exists() and not (runtime/name).is_symlink() for name in (".env.local","uploads","backups"))
    blockers=[
        "Suspend writes and take a fresh verified recovery snapshot.",
        "Obtain explicit installation approval and verify recovery on physical Mint."
    ]
    if not stable:
        blockers.insert(0,"Permanent runtime storage migration required.")
    blockers.insert(0,"Verify authenticated billing and financial operations with both versions; startup alone is insufficient.")
    return {"currentProject":str(current),"candidateProject":str(staged),
            "candidateVersion":version,"recoveryFolder":str(folder),
            "activationAllowed":False,"rollbackAllowed":False,"blockers":blockers}

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder",type=Path)
    args=parser.parse_args()
    try:
        print(json.dumps(plan(args.folder),indent=2))
    except (OSError,ValueError,subprocess.SubprocessError) as error:
        sys.exit("Update preflight blocked: "+str(error))
