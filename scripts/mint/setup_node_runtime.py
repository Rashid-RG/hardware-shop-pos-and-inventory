"""Use an optional packaged Node runtime without modifying system software."""
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile

def compatible():
    if not shutil.which("node") or not shutil.which("npm"):
        return False
    return subprocess.run(["node","-e","const [a,b]=process.versions.node.split('.').map(Number);if(a!==22||b<12)process.exit(1)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0

def manifest(root):
    result={}
    for path in sorted(root.rglob("*")):
        name=path.relative_to(root).as_posix()
        if path.is_symlink():
            result[name]=("link",os.readlink(path))
        elif path.is_dir():
            result[name]=("directory",)
        elif path.is_file():
            with path.open("rb") as stream:
                result[name]=("file",path.stat().st_mode & 0o777,hashlib.file_digest(stream,"sha256").hexdigest())
        else:
            raise RuntimeError("Unsupported runtime entry.")
    return result

def activate(destination):
    previous=os.environ.get("PATH","")
    for name in ("node","npm"):
        target=destination/"bin"/name
        if not target.resolve().is_relative_to(destination) or not os.access(target,os.X_OK):
            raise RuntimeError("Invalid retained runtime executable.")
    os.environ["PATH"]=str(destination/"bin")+os.pathsep+previous
    try:
        if not compatible():
            raise RuntimeError("Retained runtime compatibility check failed.")
        subprocess.run(["npm","--version"],check=True,stdout=subprocess.DEVNULL)
    except Exception:
        os.environ["PATH"]=previous
        raise

def prepare_node(root, dialog):
    if compatible():
        return
    payload=root/"installer-runtime/node-linux-x64.tar.gz"
    checksum=root/"installer-runtime/node-linux-x64.sha256"
    if not payload.exists() and not checksum.exists():
        return  # existing APT prerequisite flow
    if platform.system()!="Linux" or platform.machine() not in ("x86_64","AMD64"):
        raise RuntimeError("Bundled runtime is for Linux x64 only.")
    if not payload.is_file() or not checksum.is_file():
        raise RuntimeError("Incomplete bundled Node runtime.")
    expected=checksum.read_text().strip()
    with payload.open("rb") as stream:
        actual=hashlib.file_digest(stream,"sha256").hexdigest()
    if actual!=expected:
        raise RuntimeError("Bundled runtime integrity check failed.")
    destination=root/".ars-node-runtime"
    if not hasattr(tarfile,"data_filter"):
        raise RuntimeError("Python with safe tar extraction support is required.")
    if os.path.lexists(destination):
        # Compare retained runtime with a newly verified extraction before executing it.
        # Do not trust an editable receipt or replace any existing files.
        if destination.is_symlink() or not destination.is_dir():
            raise RuntimeError("Invalid retained runtime directory.")
        with tempfile.TemporaryDirectory(prefix=".ars-verify-",dir=root) as folder:
            reference=Path(folder)
            with tarfile.open(payload,"r:gz") as archive:
                archive.extractall(reference,filter="data")
            if manifest(reference)!=manifest(destination):
                raise RuntimeError("Retained runtime differs from the verified package. Contact support.")
        activate(destination)
        return
    if dialog("--question","--no-markup","--text=Setup will use its packaged Node.js runtime without replacing your system Node.js.","--ok-label=Continue","--cancel-label=Cancel"):
        raise RuntimeError("Runtime setup cancelled before extraction.")
    # Python's data filter rejects unsafe paths and links. No root extraction.
    if not hasattr(tarfile,"data_filter"):
        raise RuntimeError("Python with safe tar extraction support is required.")
    with tempfile.TemporaryDirectory(prefix=".ars-node-",dir=root) as folder:
        stage=Path(folder)/"runtime"
        stage.mkdir(mode=0o700)
        with tarfile.open(payload,"r:gz") as archive:
            archive.extractall(stage,filter="data")
        for name in ("node","npm"):
            target=stage/"bin"/name
            if not target.resolve().is_relative_to(stage) or not os.access(target,os.X_OK):
                raise RuntimeError("Invalid packaged runtime executable.")
        previous=os.environ.get("PATH","")
        os.environ["PATH"]=str(stage/"bin")+os.pathsep+previous
        try:
            if not compatible():
                raise RuntimeError("Bundled runtime failed compatibility check.")
            subprocess.run(["npm","--version"],check=True,stdout=subprocess.DEVNULL)
        finally:
            os.environ["PATH"]=previous
        stage.rename(destination)
    os.environ["PATH"]=str(destination/"bin")+os.pathsep+os.environ.get("PATH","")
