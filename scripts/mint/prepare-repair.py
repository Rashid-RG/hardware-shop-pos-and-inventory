"""Prepare an exact-version repair source in isolation; never activate or build it."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
from setup_destination import copy_release

def plain_file(path):
    if path.resolve(strict=True)!=path or not path.is_file():
        raise RuntimeError("Repair package metadata unavailable.")
    return path.read_bytes()

def prepare(state, project, source):
    state=Path(state)
    project=Path(project)
    source=Path(source)
    if state.resolve(strict=True)!=state or project.resolve(strict=True)!=project or source.resolve(strict=True)!=source:
        raise RuntimeError("Linked repair roots are unsupported.")
    if not (state/"project").is_symlink() or (state/"project").resolve(strict=True)!=project:
        raise RuntimeError("Active release binding unavailable.")
    if source==project or source in project.parents or project in source.parents or state==source or state in source.parents or source in state.parents:
        raise RuntimeError("Choose a separate extracted installation package.")
    for marker in ("runtime-activation-interrupted.json","runtime-migration-interrupted.json","switch-journal.json","runtime-switch-intent.json","handoff-pending.json"):
        if os.path.lexists(state/marker):
            raise RuntimeError("Resolve retained maintenance evidence before repair preparation.")
    installed=plain_file(project/"PILOT-FILES.json")
    offered=plain_file(source/"PILOT-FILES.json")
    if installed!=offered or plain_file(project/"PILOT-RELEASE.json")!=plain_file(source/"PILOT-RELEASE.json"):
        raise RuntimeError("Repair requires the exact installed package manifest and release identity.")
    folder=Path(tempfile.mkdtemp(prefix="repair-preparation-",dir=state))
    candidate=copy_release(source,folder/"candidate")
    if plain_file(candidate/"PILOT-FILES.json")!=installed or (state/"project").resolve(strict=True)!=project:
        raise RuntimeError("Repair evidence changed during preparation.")
    receipt={"schema":1,"manifestSha256":hashlib.sha256(installed).hexdigest(),
             "candidate":str(candidate),"sourceVerified":True,"backupVerified":False,
             "activationAllowed":False,"startupAllowed":False,"repairApplied":False}
    with (folder/"repair-preparation.json").open("x") as stream:
        json.dump(receipt,stream,sort_keys=True)
    return folder

def main():
    import subprocess
    state=Path.home()/".local/share/ars-hardware"
    title="RS Nextward | Repair preparation"
    def dialog(*args):
        return subprocess.run(["zenity","--title="+title,*args],capture_output=True,text=True)
    try:
        if os.geteuid()==0:
            raise RuntimeError("Run as the desktop user.")
        project=(state/"project").resolve(strict=True)
        if Path(__file__).resolve().parents[2]!=project:
            raise RuntimeError("Active release mismatch.")
        answer=dialog("--file-selection","--directory","--title=Select extracted exact-version ARS package")
        if answer.returncode:
            return
        if dialog("--question","--no-markup","--text=Verify and copy the exact installed package into isolated repair storage? No software or database will be replaced. A verified backup is required before any repair activation.").returncode:
            return
        folder=prepare(state,project,Path(answer.stdout.strip()))
        dialog("--info","--no-markup","--text=Repair source prepared. No repair applied. Backup and activation review remain required.\n\n"+str(folder))
    except (OSError,ValueError,RuntimeError):
        dialog("--error","--no-markup","--text=Repair preparation blocked. Existing application and database retained. Contact RS Nextward support.")

if __name__=="__main__":
    main()
