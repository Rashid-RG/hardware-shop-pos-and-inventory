"""Non-authorizing installation identity evidence for fresh Mint setup.

An exact tree observation is not proof of exclusive ownership or permission to
delete it. Unknown, changed or legacy installations remain ineligible.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
from release_fingerprint import fingerprint
from switch_journal import sync_dir

def digest(path):
    s=path.lstat()
    if path.resolve(strict=True)!=path or not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid():
        raise ValueError("Invalid owned installation evidence.")
    with path.open("rb") as stream:
        return hashlib.file_digest(stream,"sha256").hexdigest()

def observe(state,project):
    for p in (state,project,state/"runtime"):
        if p.resolve(strict=True)!=p or not p.is_dir() or p.stat().st_uid!=os.getuid():
            raise ValueError("Invalid installation directory.")
    if project==state or project.is_relative_to(state) or state.is_relative_to(project):
        raise ValueError("Installation and state overlap.")
    pointer=state/"project"
    if not pointer.is_symlink() or pointer.resolve(strict=True)!=project:
        raise ValueError("Registered installation mismatch.")
    manifest=project/"PILOT-FILES.json"
    if manifest.stat().st_size>16777216:
        raise ValueError("Package manifest too large.")
    manifest_hash=digest(manifest)
    records=json.loads(manifest.read_text())
    if not isinstance(records,dict) or not {"package.json","package-lock.json","PILOT-RELEASE.json","scripts/mint/install.sh"}.issubset(records):
        raise ValueError("Missing package provenance.")
    for name,record in records.items():
        path=Path(name)
        if path.is_absolute() or path.as_posix()!=name or "\\" in name or any(p in (".","..",".git",".env.local","uploads","backups","node_modules","dist") for p in path.parts):
            raise ValueError("Unsafe package member.")
        if digest(project/path)!=record.get("sha256"):
            raise ValueError("Package member changed.")
    for name in ("dist/server.cjs","dist/index.html"):
        digest(project/name)
    for name in (".env.local","uploads","backups"):
        target=state/"runtime"/name
        if not (project/name).is_symlink() or (project/name).resolve(strict=True)!=target or target.resolve(strict=True)!=target:
            raise ValueError("Permanent runtime mapping changed.")
    result={"schema":1,"kind":"mint-installation-identity-observation","installation":str(project),
            "desktopUid":os.getuid(),"packageManifestDigest":manifest_hash,
            "releaseMetadataDigest":digest(project/"PILOT-RELEASE.json"),
            "applicationTreeDigest":fingerprint(project,state/"runtime"),
            "installationOwnershipCertified":False,"applicationRemovalAllowed":False,
            "serviceRemovalAllowed":False,"databaseDeletionAllowed":False}
    if digest(manifest)!=manifest_hash or pointer.resolve(strict=True)!=project:
        raise ValueError("Installation identity changed.")
    return result

def record(state,project):
    target=state/"installation-identity.json"
    if os.path.lexists(target):
        raise ValueError("Existing installation identity must be retained.")
    evidence=observe(state,project)
    if observe(state,project)!=evidence:
        raise ValueError("Installation changed during recording.")
    with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),"w") as stream:
        json.dump(evidence,stream,sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    sync_dir(state)

def review(state,project):
    target=state/"installation-identity.json"
    before=digest(target)
    if target.stat().st_size>65536:
        raise ValueError("Invalid identity evidence size.")
    saved=json.loads(target.read_text())
    if saved!=observe(state,project) or digest(target)!=before:
        raise ValueError("Installation identity differs from recorded setup.")
    return {"installationIdentityMatched":True,"installationOwnershipCertified":False,"applicationRemovalAllowed":False}

if __name__=="__main__":
    import sys
    if os.geteuid()==0 or len(sys.argv)!=2:
        raise SystemExit("Desktop setup user required.")
    record(Path.home()/".local/share/ars-hardware",Path(sys.argv[1]))
