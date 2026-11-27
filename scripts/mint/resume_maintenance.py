"""Resume unchanged POS after maintenance backup; never switch releases or restore data."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import urlopen
from switch_journal import sync_dir
from startup_guard import startup_allowed

STATE=Path.home()/".local/share/ars-hardware"
UNIT="ars-hardware.service"

def resume(confirmation):
    if os.geteuid()==0 or confirmation!="RESUME CURRENT POS":
        raise ValueError("Explicit desktop-user resume approval required.")
    with (STATE/"maintenance.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with (STATE/"update.lock").open("a") as update:
            fcntl.flock(update,fcntl.LOCK_EX|fcntl.LOCK_NB)
            hold=STATE/"maintenance-hold.json"
            journal=STATE/"switch-journal.json"
            for name in ("runtime-switch-intent.json","runtime-activation-interrupted.json","handoff-pending.json"):
                if os.path.lexists(STATE/name):
                    raise ValueError("Retained update evidence requires manual review before resume.")
            if hold.is_symlink() or not hold.is_file() or journal.exists() or journal.is_symlink():
                raise ValueError("Missing maintenance hold or software switch journal present. Manual review required.")
            record=json.loads(hold.read_text())
            current=(STATE/"project").resolve(strict=True)
            if record.get("purpose")!="pre-update backup" or record.get("previousProject")!=str(current):
                raise ValueError("Cannot confirm unchanged application. Manual review required.")
            saved=hold.read_bytes()
            hold.unlink()
            sync_dir(STATE)
            try:
                if not startup_allowed(STATE):
                    raise RuntimeError("Startup guard rejected resume.")
                subprocess.run(["systemctl","--user","start","--no-block",UNIT],check=True,timeout=30)
                for _ in range(155):
                    active=subprocess.run(["systemctl","--user","is-active",UNIT],capture_output=True,text=True,timeout=10)
                    try:
                        with urlopen("http://127.0.0.1:3000/api/ready",timeout=1) as response:
                            data=json.load(response)
                        if active.stdout.strip()=="active" and data.get("ok") is True and data.get("status")=="ready" and data.get("database")=="reachable" and data.get("sourceOfTruth")=="normalized":
                            print("Current POS resumed.")
                            return
                    except (OSError,ValueError):
                        pass
                    time.sleep(1)
                raise RuntimeError("POS readiness was not confirmed.")
            except BaseException:
                with hold.open("xb") as stream:
                    stream.write(saved)
                    stream.flush()
                    os.fsync(stream.fileno())
                sync_dir(STATE)
                subprocess.run(["systemctl","--user","stop",UNIT],check=True,timeout=180)
                raise

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirmation",required=True)
    args=parser.parse_args()
    try:
        resume(args.confirmation)
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError) as error:
        sys.exit("Resume blocked: "+str(error))
