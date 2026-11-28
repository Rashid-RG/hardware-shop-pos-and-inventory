"""Prepare a stopped-service backup; never activate a release or restore a database."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import socket
import re
from switch_journal import sync_dir

STATE=Path.home()/".local/share/ars-hardware"
UNIT="ars-hardware.service"

def stopped(*, startup_control_pid=None):
    properties="ActiveState,SubState,MainPID"
    if startup_control_pid is not None:
        properties+=",ControlPID"
    result=subprocess.run(["systemctl","--user","show",UNIT,"--property="+properties],check=True,capture_output=True,text=True,timeout=15)
    values=dict(line.split("=",1) for line in result.stdout.splitlines() if "=" in line)
    inactive=values.get("ActiveState")=="inactive" and values.get("SubState")=="dead"
    # Our own ExecCondition can inspect a stopped writer before systemd starts
    # ExecStartPre. No other activating service state is accepted.
    own_condition=(startup_control_pid is not None and values.get("ActiveState")=="activating"
                   and values.get("SubState")=="condition" and values.get("ControlPID")==str(startup_control_pid))
    if values.get("MainPID")!="0" or not (inactive or own_condition):
        raise RuntimeError("POS service is not confirmed stopped.")
    with socket.socket() as probe:
        probe.settimeout(1)
        if probe.connect_ex(("127.0.0.1",3000))==0:
            raise RuntimeError("Another process is listening on the POS port.")

def check_database_clients(project, env_file=None, *, compose_file=None):
    # Observational check only: do not terminate sessions or change PostgreSQL settings.
    config=Path(env_file) if env_file is not None else Path(project)/".env.local"
    if not config.is_absolute() or not config.is_file():
        raise ValueError("Valid absolute database configuration required.")
    compose_file=compose_file or "scripts/mint/compose.yaml"
    cmd=["docker","compose","-p","ars-mint","--env-file",str(config),"-f",str(compose_file),"exec","-T","postgres","psql","-X","-U","ars","-d","hardware_pos_ars","-v","ON_ERROR_STOP=1","-Atc",
         "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'"]
    result=subprocess.run(cmd,cwd=project,check=True,capture_output=True,text=True,timeout=30)
    if result.stdout.strip()!="0":
        raise RuntimeError("Other PostgreSQL clients detected. Close external database tools before maintenance. No connections were terminated.")

def prepare(version,confirmation):
    if os.geteuid()==0 or confirmation!="STOP POS FOR BACKUP":
        raise ValueError("Explicit desktop-user maintenance approval required.")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?",version):
        raise ValueError("Invalid staged version.")
    project=(STATE/"project").resolve(strict=True)
    guard=STATE/"update-tools/startup_guard.py"
    # Require installed guard to support the maintenance marker before stopping.
    if not guard.is_file() or "maintenance-hold.json" not in guard.read_text():
        raise ValueError("Install maintenance-aware startup guard first.")
    condition=subprocess.run(["systemctl","--user","show",UNIT,"--property=ExecCondition","--value"],check=True,capture_output=True,text=True).stdout
    if str(guard) not in condition:
        raise ValueError("Installed system service lacks the startup guard.")
    hold=STATE/"maintenance-hold.json"
    # Separate maintenance lock: the backup preparation script takes update.lock.
    with (STATE/"maintenance.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with hold.open("x") as stream:
            json.dump({"purpose":"pre-update backup","previousProject":str(project),"version":version,"createdAt":datetime.datetime.now(datetime.timezone.utc).isoformat()},stream)
            stream.flush()
            os.fsync(stream.fileno())
        sync_dir(STATE)
        subprocess.run(["systemctl","--user","stop",UNIT],check=True,timeout=180)
        stopped()
        check_database_clients(project)
        result=subprocess.run([str(STATE/"node"),str(project/"scripts/mint/locked-backup.mjs"),version],cwd=project,check=True,capture_output=True,text=True,timeout=1200)
        archives=[x.removeprefix("Pinned recovery archive: ") for x in result.stdout.splitlines() if x.startswith("Pinned recovery archive: ")]
        if len(archives)!=1:
            raise RuntimeError("Protected backup did not return a unique archive.")
        folder=Path(archives[0]).resolve(strict=True)
        if folder.parent!=(STATE/"update-recovery").resolve(strict=True):
            raise ValueError("Unexpected recovery archive location.")
        stopped()
        check_database_clients(project)
        print("Backup prepared with managed POS service stopped. Maintenance hold remains active.")
        print("Protected recovery archive:",folder)
        print("Existing public table writes were fenced during backup. Activation is not approved.")

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("--confirmation",required=True)
    args=parser.parse_args()
    try:
        prepare(args.version,args.confirmation)
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError) as error:
        sys.exit("Maintenance backup stopped: "+str(error))
