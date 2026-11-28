"""Verify the staged source files against the original signed release archive."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile

ARCHIVE_NAME = ".ars-release.tar.gz"
MAX_BYTES = 512 * 1024 * 1024
MAX_FILES = 25000


def verify_signed_source(staged, expected_sha256):
    archive = staged / ARCHIVE_NAME
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > MAX_BYTES:
        raise ValueError("Original signed release archive unavailable. Stage the release again.")
    with archive.open("rb") as payload:
        if hashlib.file_digest(payload, "sha256").hexdigest() != expected_sha256:
            raise ValueError("Original signed release archive checksum mismatch.")
        payload.seek(0)
        source_files = set()
        source_dirs = set()
        total = 0
        with tarfile.open(fileobj=payload, mode="r:gz") as bundle:
            for index, member in enumerate(bundle):
                relative = PurePosixPath(member.name)
                if index >= 25000 or not relative.parts or relative.is_absolute() or ".." in relative.parts:
                    raise ValueError("Invalid signed source path.")
                source_dirs.update(parent for parent in relative.parents if parent.parts)
                if member.isdir():
                    source_dirs.add(relative)
                    continue
                total += member.size
                if not member.isfile() or relative in source_files or total > MAX_BYTES:
                    raise ValueError("Invalid signed source entry.")
                source_files.add(relative)
                path = staged.joinpath(*relative.parts)
                if path.resolve(strict=True) != path or not path.is_file() or path.stat().st_size != member.size:
                    raise ValueError("Staged source differs from signed release: " + relative.as_posix())
                if bool(path.stat().st_mode & 0o111) != bool(member.mode & 0o111):
                    raise ValueError("Staged executable permission differs from signed release: " + relative.as_posix())
                with bundle.extractfile(member) as expected, path.open("rb") as actual:
                    if hashlib.file_digest(expected, "sha256").digest() != hashlib.file_digest(actual, "sha256").digest():
                        raise ValueError("Staged source differs from signed release: " + relative.as_posix())
        if PurePosixPath("package.json") not in source_files:
            raise ValueError("Signed release lacks package.json.")

    generated = {"dist", "node_modules"}
    evidence = {ARCHIVE_NAME, ".ars-release-manifest.json", ".ars-release-manifest.sig"}
    runtime = {".env.local", "uploads", "backups"}
    for directory, dirs, files in os.walk(staged, followlinks=False):
        folder = Path(directory)
        for name in dirs + files:
            path = folder / name
            relative = PurePosixPath(path.relative_to(staged).as_posix())
            if folder == staged:
                if name in generated and path.is_dir() and not path.is_symlink():
                    dirs.remove(name)
                    continue
                if name in evidence and path.is_file() and not path.is_symlink():
                    continue
                if name in runtime and path.is_symlink():
                    if name in dirs:
                        dirs.remove(name)
                    continue
            signed = source_dirs if name in dirs else source_files
            if path.is_symlink() or relative not in signed:
                raise ValueError("Unexpected staged source entry: " + relative.as_posix())


def extract_verified(archive, target):
    seen = set()
    total = 0
    with tarfile.open(archive, "r:gz") as bundle:
        for index, member in enumerate(bundle):
            path = PurePosixPath(member.name)
            if index >= MAX_FILES or not path.parts or path.is_absolute() or ".." in path.parts:
                raise ValueError("Unsafe or oversized release archive.")
            if any(part in (".git", "node_modules", "backups", "uploads", ".env", ".env.local") or part.startswith((".env.", ".ars-release")) for part in path.parts):
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

def copy_evidence(path, destination, limit):
    if path.resolve(strict=True) != path:
        raise ValueError("Linked publisher evidence.")
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= limit:
        raise ValueError("Invalid publisher evidence.")
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as source:
        def identity(s):
            return (s.st_dev, s.st_ino, s.st_mode, s.st_size, s.st_mtime_ns, s.st_ctime_ns)

        if identity(before) != identity(os.fstat(source.fileno())):
            raise ValueError("Publisher evidence changed.")
        with destination.open("xb") as target:
            remaining = before.st_size
            while remaining:
                block = source.read(min(remaining, 1024 * 1024))
                if not block:
                    raise ValueError("Publisher evidence truncated.")
                target.write(block)
                remaining -= len(block)
        if source.read(1) or identity(before) != identity(os.fstat(source.fileno())) or identity(before) != identity(path.lstat()):
            raise ValueError("Publisher evidence changed.")


@contextmanager
def publisher_snapshot(project, trust_key):
    """Yield a private copy extracted from a publisher-authenticated archive."""
    project, trust_key = Path(project), Path(trust_key)
    if project.resolve(strict=True) != project or not project.is_dir():
        raise ValueError("Invalid retained release directory.")
    with tempfile.TemporaryDirectory(prefix="ars-publisher-") as directory:
        work = Path(directory)
        manifest = work / ".ars-release-manifest.json"
        signature = work / ".ars-release-manifest.sig"
        archive = work / ARCHIVE_NAME
        key = work / "trust.pem"
        assets = ((project / manifest.name, manifest, 65536),
                  (project / signature.name, signature, 16384),
                  (project / archive.name, archive, MAX_BYTES),
                  (trust_key, key, 65536))
        for source, destination, maximum in assets:
            copy_evidence(source, destination, maximum)
        subprocess.run(["/usr/bin/openssl", "dgst", "-sha256", "-verify", str(key),
                        "-signature", str(signature), str(manifest)],
                       check=True, capture_output=True, timeout=15)
        manifest_data = manifest.read_bytes()
        record = json.loads(manifest_data)
        version = record.get("version")
        digest = record.get("sha256")
        if (record.get("product") != "ARS Distributor" or record.get("platform") != "linux-mint"
                or not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", version)
                or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)):
            raise ValueError("Publisher manifest identity mismatch.")
        with archive.open("rb") as payload:
            if hashlib.file_digest(payload, "sha256").hexdigest() != digest:
                raise ValueError("Publisher archive mismatch.")
        clean = work / "source"
        clean.mkdir()
        extract_verified(archive, clean)
        if json.loads((clean / "package.json").read_bytes()).get("version") != version:
            raise ValueError("Publisher package version mismatch.")
        yield clean, {"version": version, "archiveDigest": digest,
                      "manifestDigest": hashlib.sha256(manifest_data).hexdigest()}, assets


def verify_publisher_source(project, trust_key):
    """Review the retained tree from an independently trusted installation."""
    with publisher_snapshot(project, trust_key) as (_, verified, assets):
        verify_signed_source(Path(project), verified["archiveDigest"])
        for original, snapshot, limit in assets:
            if limit == MAX_BYTES:
                continue  # The source comparison checks the archive digest.
            comparison = snapshot.with_suffix(snapshot.suffix + ".recheck")
            copy_evidence(original, comparison, limit)
            if comparison.read_bytes() != snapshot.read_bytes():
                raise ValueError("Publisher evidence changed.")
    return {**verified, "publisherSourceVerified": True, "executionAllowed": False,
            "startupAllowed": False, "activationAllowed": False, "rollbackAllowed": False}
