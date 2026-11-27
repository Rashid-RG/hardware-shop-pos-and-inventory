#!/usr/bin/env python3
"""Create a deterministic source-only acceptance package from a verified Git commit."""
import hashlib, json, pathlib, subprocess, sys, zipfile
commit, target = sys.argv[1:]
actual = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
if actual != commit:
    raise SystemExit("Checked out commit does not match requested release identity")
out = pathlib.Path(target)
out.mkdir(parents=True, exist_ok=True)
files = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", "-z", commit]).decode().split("\0")
required = {"package.json", "package-lock.json", "Launch-Hardware-POS.vbs", "Start-Hardware-POS.bat", "scripts/mint/install.sh", "docs/v1-shop-opening-acceptance.md"}
if not required.issubset(files):
    raise SystemExit("Required installation files missing")
def allowed(name):
    p = pathlib.PurePosixPath(name)
    if any(x in {".git", "node_modules", "dist", "uploads", "backups"} for x in p.parts):
        return False
    if p.name.startswith(".env") and p.name not in {".env.example", ".env.local.example"}:
        return False
    if p.suffix.lower() in {".pem", ".key", ".p12", ".pfx", ".dump", ".backup", ".sqlite", ".db"}:
        return False
    return True
name = "ARS-Distributor-v1.0-pilot-" + commit[:12] + ".zip"
archive = out / name
# git archive reads only committed files, not the runner workspace or runtime.
paths = sorted(x for x in files if x and allowed(x))
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for path in paths:
        data = subprocess.check_output(["git", "show", commit + ":" + path])
        item = zipfile.ZipInfo("ARS-Distributor/" + path, (2026, 1, 1, 0, 0, 0))
        item.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(item, data)
    z.writestr("ARS-Distributor/PILOT-RELEASE.json", json.dumps({"commit":commit,"status":"acceptance-only","liveUpdatesApproved":False}, sort_keys=True)+"\n")
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert all("ARS-Distributor/" + f in z.namelist() for f in required)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / (name + ".sha256")).write_text(digest + "  " + name + "\n")
print("Acceptance package:", name, digest)
