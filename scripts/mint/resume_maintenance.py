"""Resume unchanged POS after maintenance backup; never switch releases or restore data."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import stat
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener
from switch_journal import sync_dir
from startup_guard import startup_allowed, migration_mapping_valid
from maintenance_backup import stopped, check_database_clients

STATE=Path.home()/".local/share/ars-hardware"
UNIT="ars-hardware.service"

class NoReadinessRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def active_process():
    result = subprocess.run(
        ["systemctl", "--user", "show", UNIT, "--property=ActiveState,MainPID,ExecMainStartTimestampMonotonic"],
        check=True, capture_output=True, text=True, timeout=10,
    )
    fields = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    pid = fields.get("MainPID", "")
    started = fields.get("ExecMainStartTimestampMonotonic", "")
    if fields.get("ActiveState") != "active" or not re.fullmatch(r"[1-9][0-9]{0,9}", pid) or not re.fullmatch(r"[1-9][0-9]{0,19}", started):
        return None
    return int(pid), started

def wait_for_current_release(project, version, *, timeout=155):
    local = build_opener(ProxyHandler({}), NoReadinessRedirect())
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        instance = active_process()
        if instance is not None:
            pid, _ = instance
            try:
                with local.open("http://127.0.0.1:3000/api/ready", timeout=1) as response:
                    raw = response.read(16385)
                    if len(raw) > 16384:
                        raise RuntimeError("POS readiness response exceeded its size limit.")
                    data = json.loads(raw)
            except (OSError, ValueError):
                data = None
            if isinstance(data, dict) and data.get("ok") is True and data.get("status") == "ready" and data.get("database") == "reachable" and data.get("sourceOfTruth") == "normalized":
                if type(data.get("processId")) is not int or data["processId"] != pid or data.get("buildVersion") != version:
                    raise RuntimeError("Readiness belongs to another POS process or release.")
                if active_process() != instance or (STATE/"project").resolve(strict=True) != project:
                    raise RuntimeError("The POS process or release changed during readiness verification.")
                return
        time.sleep(1)
    raise RuntimeError("POS readiness was not confirmed.")

def open_lock(path):
    stream=os.fdopen(os.open(path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600),"a")
    if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
        stream.close()
        raise ValueError("Invalid maintenance lock.")
    return stream

def resume(confirmation):
    if os.geteuid()==0 or confirmation!="RESUME CURRENT POS":
        raise ValueError("Explicit desktop-user resume approval required.")
    with open_lock(STATE/"maintenance.lock") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with open_lock(STATE/"update.lock") as update:
            fcntl.flock(update,fcntl.LOCK_EX|fcntl.LOCK_NB)
            hold=STATE/"maintenance-hold.json"
            journal=STATE/"switch-journal.json"
            for name in ("runtime-switch-intent.json","runtime-activation-interrupted.json","handoff-pending.json","runtime-migration-interrupted.json","repair-interrupted.json"):
                if os.path.lexists(STATE/name):
                    raise ValueError("Retained update evidence requires manual review before resume.")
            if hold.is_symlink() or not hold.is_file() or journal.exists() or journal.is_symlink():
                raise ValueError("Missing maintenance hold or software switch journal present. Manual review required.")
            record=json.loads(hold.read_text())
            current=(STATE/"project").resolve(strict=True)
            if record.get("purpose")!="pre-update backup" or record.get("previousProject")!=str(current):
                raise ValueError("Cannot confirm unchanged application. Manual review required.")
            if not migration_mapping_valid(STATE):
                raise ValueError("Runtime migration mapping is incomplete; maintenance hold retained.")
            saved=hold.read_bytes()
            stopped()
            check_database_clients(current)
            package = current / "package.json"
            if package.is_symlink() or not package.is_file() or package.stat().st_size > 65536:
                raise ValueError("Installed release version cannot be verified.")
            metadata = json.loads(package.read_bytes())
            version = metadata.get("version") if isinstance(metadata, dict) else None
            if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", version):
                raise ValueError("Installed release version cannot be verified.")
            if hold.is_symlink() or hold.read_bytes()!=saved or (STATE/"project").resolve(strict=True)!=current:
                raise ValueError("Maintenance evidence changed before resume.")
            hold.unlink()
            try:
                sync_dir(STATE)
                if not startup_allowed(STATE):
                    raise RuntimeError("Startup guard rejected resume.")
                subprocess.run(["systemctl","--user","start","--no-block",UNIT],check=True,timeout=30)
                wait_for_current_release(current, version)
                print("Current POS resumed.")
            except BaseException:
                try:
                    with hold.open("xb") as stream:
                        stream.write(saved)
                        stream.flush()
                        os.fsync(stream.fileno())
                    sync_dir(STATE)
                finally:
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
