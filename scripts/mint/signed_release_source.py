"""Verify the staged source files against the original signed release archive."""
import hashlib
from pathlib import PurePosixPath
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
        total = 0
        with tarfile.open(fileobj=payload, mode="r:gz") as bundle:
            for index, member in enumerate(bundle):
                relative = PurePosixPath(member.name)
                if index >= 25000 or not relative.parts or relative.is_absolute() or ".." in relative.parts:
                    raise ValueError("Invalid signed source path.")
                if member.isdir():
                    continue
                total += member.size
                if not member.isfile() or relative in source_files or total > MAX_BYTES:
                    raise ValueError("Invalid signed source entry.")
                source_files.add(relative)
                path = staged.joinpath(*relative.parts)
                if path.resolve(strict=True) != path or not path.is_file() or path.stat().st_size != member.size:
                    raise ValueError("Staged source differs from signed release: " + relative.as_posix())
                with bundle.extractfile(member) as expected, path.open("rb") as actual:
                    if hashlib.file_digest(expected, "sha256").digest() != hashlib.file_digest(actual, "sha256").digest():
                        raise ValueError("Staged source differs from signed release: " + relative.as_posix())
        if PurePosixPath("package.json") not in source_files:
            raise ValueError("Signed release lacks package.json.")
