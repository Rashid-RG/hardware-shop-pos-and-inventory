#!/usr/bin/env python3
"""Prepare an approved signed update without touching the active POS or database."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

STATE = Path.home() / ".local" / "share" / "ars-hardware"
TRUST = STATE / "release-signing-public.pem"
STAGING = STATE / "staged-releases"
MAX_BYTES = 512 * 1024 * 1024
MAX_FILES = 25000

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def extract_verified(archive, target):
    seen = set()
    total = 0
    with tarfile.open(archive, "r:gz") as bundle:
        for index, member in enumerate(bundle):
            path = PurePosixPath(member.name)
            if index >= MAX_FILES or not path.parts or path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe or oversized release archive.")
            if any(part in (".git", "node_modules", "backups", "uploads", ".env", ".env.local") or part.startswith(".env.") for part in path.parts):
                raise ValueError("Release contains prohibited runtime or private files.")
            if path in seen or not (member.isdir() or member.isfile()):
                raise ValueError("Duplicate or unsupported release archive member.")
            seen.add(path)
            total += member.size
            if total > MAX_BYTES:
                raise ValueError("Release exceeds extraction limit.")
            dest = target.joinpath(*path.parts)
            if member.isdir():
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(member) as source, dest.open("xb") as out:
                    shutil.copyfileobj(source, out)
                dest.chmod(0o700 if member.mode & 0o111 else 0o600)

def stage(manifest, signature, archive):
    if os.geteuid() == 0:
        raise ValueError("Run update preparation as the desktop user.")
    if not (STATE / "project").exists():
        raise ValueError("Install ARS Distributor before preparing updates.")
    if not TRUST.is_file():
        raise ValueError("No trusted release signing key configured. Contact RS Nextward.")
    STAGING.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / "update.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(prefix="verify-", dir=STAGING) as tmp:
            work = Path(tmp)
            # Verify private copies to avoid changes to the supplied files after verification.
            for source, name, limit in ((manifest, "manifest.json", 65536), (signature, "manifest.sig", 16384), (archive, "release.tar.gz", MAX_BYTES)):
                if not source.is_file() or source.stat().st_size > limit:
                    raise ValueError("Missing or oversized release input.")
                shutil.copyfile(source, work / name)
                if (work / name).stat().st_size > limit:
                    raise ValueError("Release input exceeded size limit.")
            subprocess.run(["openssl", "dgst", "-sha256", "-verify", str(TRUST), "-signature", str(work/"manifest.sig"), str(work/"manifest.json")], check=True)
            data = json.loads((work/"manifest.json").read_text())
            version = data.get("version")
            if data.get("product") != "ARS Distributor" or data.get("platform") != "linux-mint" or not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", version):
                raise ValueError("Release manifest does not match ARS Distributor for Linux Mint.")
            if data.get("sha256") != digest(work/"release.tar.gz"):
                raise ValueError("Release checksum mismatch.")
            target = STAGING / version
            if target.exists() or target.is_symlink():
                raise ValueError("This version is already staged.")
            source = work/"source"
            source.mkdir()
            extract_verified(work/"release.tar.gz", source)
            for required in ("package.json", "package-lock.json", "scripts/mint/compose.yaml"):
                if not (source/required).is_file():
                    raise ValueError("Release is missing required application files.")
            # Do not provide database credentials to build subprocesses.
            env = {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR") if key in os.environ}
            subprocess.run(["npm", "ci", "--include=dev"], cwd=source, env=env, check=True)
            subprocess.run(["npm", "run", "build"], cwd=source, env=env, check=True)
            if not (source/"dist/server.cjs").is_file():
                raise ValueError("Release build did not produce the expected server.")
            shutil.copyfile(work/"manifest.json", source/".ars-release-manifest.json")
            shutil.copyfile(work/"manifest.sig", source/".ars-release-manifest.sig")
            source.rename(target)
            print("Verified staged release:", target)
            print("Active installation and database were not changed.")

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("signature", type=Path)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    try:
        stage(args.manifest, args.signature, args.archive)
    except (OSError, ValueError, subprocess.SubprocessError, tarfile.TarError) as error:
        sys.exit("Update preparation failed: " + str(error))

if __name__ == "__main__":
    main()
