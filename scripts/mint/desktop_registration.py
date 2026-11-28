"""Fresh Mint desktop registration evidence. No removal or service control."""
import os
import json
import stat
from pathlib import Path
import subprocess
from installation_identity import digest
from switch_journal import sync_dir

def resources(home,desktop):
    menu=home/".local/share/applications"
    unit=home/".config/systemd/user/ars-hardware.service"
    if not desktop.is_absolute() or not desktop.is_relative_to(home) or desktop==home or desktop==menu:
        raise ValueError("Separate desktop directory required.")
    files=[unit,home/".local/share/icons/hicolor/scalable/apps/ars-distributor.svg",
           menu/"ars-maintenance-center.desktop"]
    for folder in (desktop,menu):
        files.extend(folder/name for name in ("ars-hardware.desktop","ars-update-center.desktop","ars-recovery-center.desktop"))
    return files

def preflight(home,desktop):
    for p in resources(home,desktop)+[home/".config/systemd/user/default.target.wants/ars-hardware.service"]:
        if os.path.lexists(p):
            raise ValueError("Existing desktop or service registration retained.")
        # Reject linked ancestors even if the final parent has not been created.
        if p.resolve()!=p:
            raise ValueError("Linked registration path.")

def observe(home,desktop,project):
    state=home/".local/share/ars-hardware"
    if (state/"project").resolve(strict=True)!=project or not (state/"project").is_symlink():
        raise ValueError("Installation pointer mismatch.")
    entries={}
    for p in resources(home,desktop):
        s=p.lstat()
        if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1:
            raise ValueError("Non-exclusive registration file.")
        entries[str(p)]={"sha256":digest(p),"device":s.st_dev,"inode":s.st_ino,"mode":stat.S_IMODE(s.st_mode)}
    unit=home/".config/systemd/user/ars-hardware.service"
    if digest(unit)!=digest(project/"scripts/mint/ars-hardware.service"):
        raise ValueError("Service definition mismatch.")
    if digest(home/".local/share/icons/hicolor/scalable/apps/ars-distributor.svg")!=digest(project/"public/ars-official.svg"):
        raise ValueError("Icon mismatch.")
    enabled=unit.parent/"default.target.wants/ars-hardware.service"
    if enabled.parent.resolve(strict=True)!=enabled.parent or not enabled.is_symlink() or enabled.lstat().st_uid!=os.getuid() or enabled.resolve(strict=True)!=unit:
        raise ValueError("Service enablement link mismatch.")
    return {"schema":1,"kind":"mint-desktop-registration-observation","installation":str(project),"desktop":str(desktop),
            "desktopUid":os.getuid(),"files":entries,"enablementLink":str(enabled),"enablementTarget":os.readlink(enabled),
            "shortcutRemovalAllowed":False,"serviceRemovalAllowed":False,"applicationRemovalAllowed":False}

def record(home,desktop,project):
    state=home/".local/share/ars-hardware"
    target=state/"desktop-registration.json"
    evidence=observe(home,desktop,project)
    if observe(home,desktop,project)!=evidence:
        raise ValueError("Registration changed.")
    with os.fdopen(os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),"w") as stream:
        json.dump(evidence,stream,sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    sync_dir(state)

def review(home,desktop,project):
    target=home/".local/share/ars-hardware/desktop-registration.json"
    before=digest(target)
    if target.stat().st_size>65536:
        raise ValueError("Registration evidence too large.")
    if json.loads(target.read_text())!=observe(home,desktop,project) or digest(target)!=before:
        raise ValueError("Desktop registration changed.")
    return {"registrationMatched":True,"shortcutRemovalAllowed":False,"serviceRemovalAllowed":False}

def desktop_path():
    return Path(subprocess.run(["xdg-user-dir","DESKTOP"],check=True,capture_output=True,text=True,timeout=10).stdout.strip())

if __name__=="__main__":
    import sys
    if os.geteuid()==0 or len(sys.argv)!=3:
        raise SystemExit("Desktop setup user required.")
    if sys.argv[1]=="preflight":
        preflight(Path.home(),desktop_path())
    elif sys.argv[1]=="record":
        record(Path.home(),desktop_path(),Path(sys.argv[2]))
    else:
        raise SystemExit("Unknown registration operation.")
