"""Verify the staged source files against the original signed release archive."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import tarfile

ARCHIVE_NAME = ".ars-release.tar.gz"
MAX_BYTES = 512 * 1024 * 1024


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


def verify_publisher_source(project, trust_key):
    """Authenticate retained release source with an independently supplied key.

    This is an observation only; it does not authorize execution. The verifier
    itself and the supplied public key must come from a trusted installation.
    """
    import json
    import re
    import stat
    import subprocess
    import tempfile

    def snapshot(path, limit):
        if path.resolve(strict=True) != path:
            raise ValueError("Linked publisher evidence.")
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= limit:
            raise ValueError("Invalid publisher evidence.")
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
            opened = os.fstat(stream.fileno())
            raw = stream.read(limit + 1)
            after = os.fstat(stream.fileno())
        def identity(s):
            return (s.st_dev, s.st_ino, s.st_mode, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if not identity(before) == identity(opened) == identity(after) == identity(path.lstat()) or len(raw) != before.st_size:
            raise ValueError("Publisher evidence changed.")
        return raw

    project, trust_key = Path(project), Path(trust_key)
    if project.resolve(strict=True) != project or not project.is_dir():
        raise ValueError("Invalid retained release directory.")
    manifest = project / ".ars-release-manifest.json"
    signature = project / ".ars-release-manifest.sig"
    paths = ((manifest, 65536), (signature, 16384), (trust_key, 65536))
    values = [snapshot(path, limit) for path, limit in paths]
    with tempfile.TemporaryDirectory(prefix="ars-publisher-review-") as directory:
        temporary = Path(directory)
        for name, raw in zip(("manifest", "signature", "trust"), values):
            (temporary / name).write_bytes(raw)
        subprocess.run(["openssl", "dgst", "-sha256", "-verify", str(temporary / "trust"),
                        "-signature", str(temporary / "signature"), str(temporary / "manifest")],
                       check=True, capture_output=True, timeout=15)
    record = json.loads(values[0])
    version = record.get("version")
    digest = record.get("sha256")
    if (record.get("product") != "ARS Distributor" or record.get("platform") != "linux-mint"
            or not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", version)
            or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)):
        raise ValueError("Publisher manifest identity mismatch.")
    verify_signed_source(project, digest)
    package = json.loads(snapshot(project / "package.json", 1048576))
    if package.get("version") != version:
        raise ValueError("Publisher package version mismatch.")
    if [snapshot(path, limit) for path, limit in paths] != values:
        raise ValueError("Publisher evidence changed.")
    return {"version": version, "archiveDigest": digest,
            "manifestDigest": hashlib.sha256(values[0]).hexdigest(),
            "publisherSourceVerified": True, "executionAllowed": False,
            "startupAllowed": False, "activationAllowed": False, "rollbackAllowed": False}
