#!/usr/bin/env python3
"""Prepare one Git commit for an approved pair of signed update bundles."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


PLATFORMS = {"windows": "release.zip", "linux-mint": "release.tar.gz"}
VERSION = re.compile(r"(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})")
COMMIT = re.compile(r"[a-f0-9]{40}")
GITHUB_FILE_LIMIT = 100 * 1024 * 1024


def git(*args, env=None):
    return subprocess.check_output(["git", *args], env=env)


def read_status(base):
    status = json.loads(git("show", f"{base}:feed/status.json"))
    if not isinstance(status, dict) or status.get("product") != "ARS Distributors" or status.get("channel") != "production":
        raise ValueError("Expected the ARS production feed branch.")
    if status.get("status") == "awaiting-signed-release":
        return None
    version = status.get("version")
    if status.get("status") != "published" or not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError("Existing production release status is invalid.")
    return version


def read_release(feed, approved_commit):
    record = feed / "release-record.json"
    if feed.is_symlink() or not feed.is_dir() or {p.name for p in feed.iterdir()} != {*PLATFORMS, record.name}:
        raise ValueError("Unexpected prepared update directory inventory.")
    if record.is_symlink() or not record.is_file() or not 0 < record.stat().st_size <= 4096:
        raise ValueError("Invalid prepared release record.")
    release = json.loads(record.read_bytes())
    if (not isinstance(release, dict) or release.get("commit") != approved_commit
            or release.get("published") is not False or release.get("liveUpdatesApproved") is not False):
        raise ValueError("Prepared release does not match the approved commit.")
    version = release.get("version")
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError("Stable release version required.")
    package = json.loads(git("show", f"{approved_commit}:package.json"))
    if not isinstance(package, dict) or package.get("version") != version:
        raise ValueError("The approved commit and prepared release versions differ.")
    return version


def snapshot_feed(feed, snapshot):
    for platform, archive in PLATFORMS.items():
        source = feed / platform
        limits = {archive: GITHUB_FILE_LIMIT, "manifest.json": 65536, "manifest.sig": 16384}
        if source.is_symlink() or not source.is_dir() or {p.name for p in source.iterdir()} != limits.keys():
            raise ValueError("Unexpected platform asset inventory.")
        (snapshot / platform).mkdir()
        for name, limit in limits.items():
            asset = source / name
            if asset.is_symlink() or not asset.is_file() or not 0 < asset.stat().st_size <= limit:
                raise ValueError(f"Invalid or oversized {platform} asset: {name}.")
            output = snapshot / platform / name
            with asset.open("rb") as input_stream, output.open("xb") as output_stream:
                remaining = limit
                while block := input_stream.read(min(remaining + 1, 1024 * 1024)):
                    remaining -= len(block)
                    if remaining < 0:
                        raise ValueError(f"{platform} asset exceeded its size limit.")
                    output_stream.write(block)


def prepare_publication(feed, approved_commit, feed_base, public_key):
    if not COMMIT.fullmatch(approved_commit) or not COMMIT.fullmatch(feed_base):
        raise ValueError("Use full application and feed commit IDs.")
    version = read_release(feed, approved_commit)
    previous = read_status(feed_base)
    if previous is not None and tuple(map(int, version.split("."))) <= tuple(map(int, previous.split("."))):
        raise ValueError("A publication must advance the production version.")
    spec = importlib.util.spec_from_file_location("release_feed", Path(__file__).with_name("prepare-update-feed.py"))
    verification = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verification)

    with tempfile.TemporaryDirectory(prefix="ars-publication-") as temporary:
        workspace = Path(temporary)
        snapshot = workspace / "feed"
        snapshot.mkdir()
        snapshot_feed(feed, snapshot)
        verification.verify_feed(snapshot, version, public_key, commit=approved_commit)
        (snapshot / "status.json").write_text(json.dumps({
            "product": "ARS Distributors", "channel": "production", "status": "published",
            "version": version, "commit": approved_commit, "platforms": list(PLATFORMS),
        }, sort_keys=True) + "\n", encoding="utf-8")
        index_env = {**os.environ, "GIT_INDEX_FILE": str(workspace / "index")}
        git("read-tree", feed_base, env=index_env)
        for asset in sorted(snapshot.rglob("*")):
            if asset.is_file():
                blob = git("hash-object", "-w", "--no-filters", str(asset)).decode().strip()
                target = asset.relative_to(workspace).as_posix()
                git("update-index", "--add", "--cacheinfo", f"100644,{blob},{target}", env=index_env)
        tree = git("write-tree", env=index_env).decode().strip()
        publication = git("commit-tree", tree, "-p", feed_base, "-m", f"Publish signed ARS update {version}", env=index_env)
    return {"version": version, "releaseCommit": approved_commit, "feedBase": feed_base,
            "publicationCommit": publication.decode().strip()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--feed", required=True, type=Path)
    parser.add_argument("--approved-commit", required=True)
    parser.add_argument("--feed-base", required=True)
    parser.add_argument("--public-key", required=True, type=Path)
    try:
        print(json.dumps(prepare_publication(**vars(parser.parse_args()))))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit("Publication preparation failed: " + str(error))


if __name__ == "__main__":
    main()
