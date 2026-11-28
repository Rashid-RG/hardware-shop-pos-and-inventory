"""Build only a verified repair package in disposable storage, never mount live files."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
from setup_destination import copy_release
from release_fingerprint import fingerprint

def assert_local_docker():
    if any(os.environ.get(k) for k in ("DOCKER_HOST","DOCKER_CONTEXT","DOCKER_TLS_VERIFY","DOCKER_CERT_PATH")):
        raise RuntimeError("Custom Docker connection is unsupported.")
    host=subprocess.check_output(["docker","context","inspect","--format","{{.Endpoints.docker.Host}}"],text=True,timeout=10).strip()
    if host!="unix:///var/run/docker.sock":
        raise RuntimeError("Local Docker socket required.")

def build_candidate(repair):
    assert_local_docker()
    temp=tempfile.TemporaryDirectory(prefix="ars-repair-build-")
    isolated=Path(temp.name)/"candidate"
    try:
        copy_release(repair/"candidate",isolated)
        image="node:22-bookworm-slim"
        subprocess.run(["docker","image","inspect",image],check=True,stdout=subprocess.DEVNULL,timeout=20)
        # Network access is used only for locked dependencies. No live credentials,
        # Docker socket, home directory or application runtime are mounted.
        subprocess.run(["docker","run","--rm","--pull=never","--cap-drop","ALL","--security-opt","no-new-privileges",
                        "--user",f"{os.getuid()}:{os.getgid()}","-e","HOME=/tmp","-v",str(isolated)+":/app:rw","-w","/app",
                        image,"sh","-c","npm ci --include=dev && npm run build"],check=True,timeout=900)
        return temp,isolated,fingerprint(isolated)
    except BaseException:
        temp.cleanup()
        raise


def verify_retained_build(repair, expected):
    """Check the retained executable tree, never follow an external runtime link."""
    root=repair/"tested-build"
    if root.resolve(strict=True)!=root or not root.is_dir():
        raise ValueError("Retained repair build unavailable.")
    for name in (".env.local","uploads","backups",".git"):
        if os.path.lexists(root/name):
            raise ValueError("Unexpected runtime data in repair build.")
    for name in ("dist/server.cjs","dist/index.html","package-lock.json"):
        path=root/name
        if path.resolve(strict=True)!=path or not path.is_file():
            raise ValueError("Required executable file unavailable.")
    if not (root/"node_modules").is_dir() or (root/"node_modules").is_symlink():
        raise ValueError("Retained dependencies unavailable.")
    if fingerprint(root)!=expected:
        raise ValueError("Retained build fingerprint mismatch.")
    return root

def retain_tested_build(repair, isolated, expected):
    """Copy the exact rehearsed tree into a fresh private directory. Never overwrite."""
    import shutil
    if repair.resolve(strict=True)!=repair or not repair.is_dir():
        raise ValueError("Invalid repair preparation.")
    target=repair/"tested-build"
    if os.path.lexists(target):
        raise ValueError("Existing tested build must be retained.")
    if fingerprint(isolated)!=expected:
        raise ValueError("Tested build changed.")
    target.mkdir(mode=0o700)
    # Copy only to a newly created directory. Incomplete copies remain blocked.
    shutil.copytree(isolated,target,symlinks=True,dirs_exist_ok=True)
    if fingerprint(isolated)!=expected:
        raise ValueError("Tested build changed during retention.")
    return verify_retained_build(repair,expected)
