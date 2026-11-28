#!/usr/bin/env python3
"""Owner-local detached signing of native installation packages; no publication."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

FINGERPRINT = "5585a52128cf936b283116885a9c6f47555827ea1f092e9e82651ef77a0a9fb6"
FILES = {"windows": "ARS-Distributor-Setup.exe"}

def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def verify_key(key):
    lines = key.read_text(encoding="ascii").splitlines()
    if len(lines) < 3 or lines[0] != "-----BEGIN PUBLIC KEY-----" or lines[-1] != "-----END PUBLIC KEY-----":
        raise ValueError("Invalid public key")
    if hashlib.sha256(base64.b64decode("".join(lines[1:-1]), validate=True)).hexdigest() != FINGERPRINT:
        raise ValueError("Unexpected publisher key")

def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("windows", "mint", "private-key", "public-key", "output"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--commit", required=True)
    a = p.parse_args()
    if not re.fullmatch("[0-9a-f]{40}", a.commit):
        raise ValueError("Exact CI commit required")
    verify_key(a.public_key)
    if a.output.exists() or a.output.is_symlink():
        raise FileExistsError(a.output)
    records = {}
    with tempfile.TemporaryDirectory(dir=a.output.parent) as tmp:
        stage = Path(tmp) / "signed-installers"
        stage.mkdir()
        for platform, source, suffix in (("windows", a.windows, ".exe"), ("linux-mint", a.mint, ".deb")):
            if source.is_symlink() or not source.is_file() or source.suffix.lower() != suffix or not 0 < source.stat().st_size <= 512*1024*1024:
                raise ValueError("Invalid native installer")
            expected = source.with_name(source.name + ".sha256").read_text().split()[0].lower()
            name = "ARS-Distributors-Setup" + suffix
            target = stage / name
            shutil.copyfile(source, target)
            actual = digest(target)
            if actual != expected:
                raise ValueError("CI checksum mismatch")
            records[platform] = {"file": name, "sha256": actual, "bytes": target.stat().st_size}
        manifest = stage / "installers.json"
        signature = stage / "installers.sig"
        manifest.write_text(json.dumps({"publisher":"RS Nextward","product":"ARS Distributors","commit":a.commit,"channel":"acceptance-only","liveUpdatesApproved":False,"installers":records},sort_keys=True)+"\n",encoding="utf-8")
        subprocess.run(["openssl","dgst","-sha256","-sign",str(a.private_key),"-out",str(signature),str(manifest)],check=True)
        subprocess.run(["openssl","dgst","-sha256","-verify",str(a.public_key),"-signature",str(signature),str(manifest)],check=True)
        a.output.mkdir()
        try:
            for file in stage.iterdir():
                with (a.output/file.name).open("xb") as out, file.open("rb") as inp:
                    shutil.copyfileobj(inp,out)
        except BaseException:
            shutil.rmtree(a.output)
            raise
    print("Detached publisher signature verified; acceptance packages only.")

if __name__ == "__main__":
    main()
