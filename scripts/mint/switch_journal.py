"""Release-pointer primitives. No service control or live activation entry point."""
import json
import os
from pathlib import Path
import tempfile
import uuid

def sync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def write_journal(folder, record):
    folder=Path(folder)
    fd,name=tempfile.mkstemp(prefix=".switch-",dir=folder)
    try:
        with os.fdopen(fd,"w") as stream:
            json.dump(record,stream,indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name,folder/"switch-journal.json")
        sync_dir(folder)
    finally:
        Path(name).unlink(missing_ok=True)

def switch_pointer(pointer, expected, candidate):
    """Caller must hold update lock and stop all writers. Never changes database."""
    pointer=Path(pointer)
    expected=Path(expected).resolve(strict=True)
    candidate=Path(candidate).resolve(strict=True)
    if not pointer.is_symlink() or pointer.resolve(strict=True)!=expected:
        raise ValueError("Active release pointer changed.")
    if not candidate.is_dir() or not (candidate/"dist/server.cjs").is_file():
        raise ValueError("Candidate executable missing.")
    if candidate==expected:
        raise ValueError("Candidate already active.")
    temporary=pointer.parent/(".project-"+uuid.uuid4().hex)
    try:
        temporary.symlink_to(candidate,target_is_directory=True)
        os.replace(temporary,pointer)
        sync_dir(pointer.parent)
    finally:
        temporary.unlink(missing_ok=True)
