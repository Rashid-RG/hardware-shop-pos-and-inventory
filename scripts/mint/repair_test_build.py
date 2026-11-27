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
