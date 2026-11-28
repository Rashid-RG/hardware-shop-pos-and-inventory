"""Non-executing host compatibility checks for a rehearsed repair build.

Only the registered Node executable runs; candidate JavaScript is syntax-checked,
not evaluated. Native add-on compatibility is deliberately not certified.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import tempfile
from repair_test_build import verify_retained_build

def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream,"sha256").hexdigest()

def inspect_native(state,repair,expected):
    if platform.system()!="Linux" or platform.machine() not in ("x86_64","AMD64"):
        raise ValueError("Linux x64 host required.")
    build=verify_retained_build(repair,expected)
    link=state/"node"
    if not link.is_symlink():
        raise ValueError("Registered Node runtime required.")
    node=link.resolve(strict=True)
    if not stat.S_ISREG(node.stat().st_mode) or not os.access(node,os.X_OK):
        raise ValueError("Registered Node executable unavailable.")
    before=digest(node)
    # Do not inherit database credentials, NODE_OPTIONS, NODE_PATH or preload hooks.
    with tempfile.TemporaryDirectory(prefix="ars-native-probe-") as directory:
        env={"PATH":"/usr/bin:/bin","HOME":directory,"LANG":"C","LC_ALL":"C"}
        def run(*args):
            return subprocess.run([str(node),*args],cwd=directory,env=env,check=True,
                                  capture_output=True,text=True,timeout=30).stdout.strip()
        observed=json.loads(run("-e","console.log(JSON.stringify({version:process.versions.node,abi:process.versions.modules,platform:process.platform,arch:process.arch}))"))
        match=re.fullmatch(r"22\.([0-9]+)\.[0-9]+",observed.get("version",""))
        if not match or int(match[1])<12 or observed.get("platform")!="linux" or observed.get("arch")!="x64":
            raise ValueError("Registered runtime must be Node 22.12+ on Linux x64.")
        run("--check",str(build/"dist/server.cjs"))
    if link.resolve(strict=True)!=node or digest(node)!=before:
        raise ValueError("Registered Node runtime changed during probe.")
    verify_retained_build(repair,expected)
    # Detect compiled dependencies; do not load them on the operational host.
    addons=sum(1 for p in (build/"node_modules").rglob("*.node") if p.is_file())
    return {"schema":1,"nodeVersion":observed["version"],"nodeAbi":observed["abi"],
            "nodeExecutableSha256":before,"buildFingerprint":expected,
            "serverSyntaxPassed":True,"nativeAddonCount":addons,
            "nativeAddonCompatibilityVerified":False,"nativeStartupVerified":False,
            "activationAllowed":False,"startupAllowed":False,"repairApplied":False}
