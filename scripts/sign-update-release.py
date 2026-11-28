#!/usr/bin/env python3
"""Prepare a signed update bundle for the ARS Windows or Linux Mint updater."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess


ARCHIVES = {"windows": "release.zip", "linux-mint": "release.tar.gz"}
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024


def sign_release(platform, version, archive, private_key, public_key, output, notes="", commit=None):
    if platform not in ARCHIVES or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError("Invalid platform or version.")
    archive_name = ARCHIVES[platform]
    if not archive.is_file() or not archive.name.endswith(archive_name.removeprefix("release")):
        raise ValueError("Archive format does not match the target updater.")
    if len(notes) > 1200:
        raise ValueError("Release notes must be at most 1200 characters.")
    if commit is not None and not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Exact release commit required.")
    if not private_key.is_file() or not public_key.is_file():
        raise ValueError("Both the authorized private key and the installed public trust key are required.")

    output.mkdir(mode=0o700)
    try:
        payload = output / archive_name
        digest = hashlib.sha256()
        size = 0
        with archive.open("rb") as source, payload.open("xb") as target:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                size += len(block)
                if size > MAX_ARCHIVE_BYTES:
                    raise ValueError("Archive exceeds the updater size limit.")
                digest.update(block)
                target.write(block)
        if size == 0:
            raise ValueError("Archive is empty.")

        manifest = output / "manifest.json"
        signature = output / "manifest.sig"
        record = {
            "product": "ARS Distributor", "platform": platform,
            "version": version, "sha256": digest.hexdigest(), "notes": notes,
        }
        if commit is not None:
            record["commit"] = commit
        manifest.write_text(json.dumps(record, sort_keys=True) + "\n", encoding="utf-8")
        subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(private_key),
                        "-out", str(signature), str(manifest)], check=True)
        if not 0 < signature.stat().st_size <= 16384:
            raise ValueError("Signature exceeds the updater size limit.")
        subprocess.run(["openssl", "dgst", "-sha256", "-verify", str(public_key),
                        "-signature", str(signature), str(manifest)], check=True)
    except (Exception, KeyboardInterrupt):
        shutil.rmtree(output)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=ARCHIVES, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--public-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--notes", default="")
    args = parser.parse_args()
    sign_release(**vars(args))
    print(f"Signed update bundle verified at {args.output}")


if __name__ == "__main__":
    main()
