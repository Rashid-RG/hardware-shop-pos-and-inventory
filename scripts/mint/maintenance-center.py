"""Read-only desktop maintenance overview. No service or database mutations."""
import json
import os
from pathlib import Path
import subprocess
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler

STATE=Path.home()/".local/share/ars-hardware"
TITLE="RS Nextward | ARS Distributor Maintenance Center"
MARKERS=("maintenance-hold.json","runtime-activation-interrupted.json","runtime-switch-intent.json","runtime-migration-interrupted.json","handoff-pending.json","repair-interrupted.json","switch-journal.json")

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def service_status():
    try:
        result=subprocess.run(["systemctl","--user","is-active","ars-hardware.service"],capture_output=True,text=True,timeout=4)
        state=result.stdout.strip()
        return state if state in ("active","inactive","failed","activating","deactivating") else "unavailable"
    except (OSError,subprocess.SubprocessError):
        return "unavailable"

def readiness():
    try:
        with build_opener(ProxyHandler({}),NoRedirect()).open("http://127.0.0.1:3000/api/ready",timeout=3) as response:
            data=json.loads(response.read(65537))
        return isinstance(data,dict) and data.get("ok") is True and data.get("status")=="ready" and data.get("database")=="reachable" and data.get("sourceOfTruth")=="normalized"
    except (OSError,ValueError):
        return False

def snapshot(state,project):
    held=any(os.path.lexists(state/name) for name in MARKERS)
    service=service_status()
    return {
        "Installation": "Production files present" if all((project/name).is_file() for name in ("dist/server.cjs","dist/index.html")) else "Review required",
        "Runtime configuration": "Present (not validated)" if (state/"runtime/.env.local").is_file() else "Review required",
        "Maintenance evidence": "Review required" if held else "No listed marker found",
        "Application service": service,
        "Database readiness": "Endpoint reports ready" if not held and service=="active" and readiness() else "Not confirmed",
    }

def main():
    from setup_ui import SetupUI
    if os.geteuid()==0 or STATE.resolve(strict=True)!=STATE:
        raise RuntimeError("Run Maintenance Center as the installed desktop user.")
    project=(STATE/"project").resolve(strict=True)
    if Path(__file__).resolve().parents[2]!=project:
        raise RuntimeError("Maintenance Center does not match the active release.")
    ui=SetupUI(project,TITLE)
    while True:
        Gtk=ui.Gtk
        win,box=ui.window("Maintenance Center")
        try:
            for label,value in snapshot(STATE,project).items():
                line=Gtk.Label(label=label+": "+value)
                line.set_xalign(0)
                box.pack_start(line,False,False,0)
            note=Gtk.Label(label="Diagnostics and isolated repair preparation. Repair activation and uninstall remain locked.")
            note.set_xalign(0)
            box.pack_start(note,False,False,0)
            for label,code in (("Recovery Center",1),("Update Center",2),("Prepare repair",4),("Review backup",5),("Test repair",6),("Review readiness",7),("Native test",8),("Prepare rollback",9),("Review interruption",10),("Activation plan",11),("Uninstall preview",12),("Refresh",3),("Close",0)):
                win.add_button(label,code)
            win.show_all()
            action=win.run()
        finally:
            win.destroy()
        if action==3:
            continue
        if action not in (1,2,4,5,6,7,8,9,10,11,12):
            return
        script=project/"scripts/mint"/({1:"recovery-center.py",2:"update-center.py",4:"prepare-repair.py",5:"repair-backup-review.py",6:"test-repair-restore.py",7:"repair-readiness.py",8:"native-repair-rehearsal.py",9:"repair-rollback-preparation.py",10:"repair_interruption.py",11:"repair-activation-plan.py",12:"uninstall-preview.py"}[action])
        if script.resolve(strict=True)!=script or not script.is_file():
            raise RuntimeError("Maintenance tool unavailable.")
        subprocess.run(["/usr/bin/python3",str(script)],cwd=project,check=True)

if __name__=="__main__":
    try:
        main()
    except (OSError,RuntimeError,ValueError,ImportError,subprocess.SubprocessError):
        subprocess.run(["zenity","--error","--no-markup","--title="+TITLE,"--text=Maintenance Center unavailable. Contact RS Nextward support. No repair or uninstall performed."])
