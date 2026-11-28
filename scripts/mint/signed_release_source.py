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
