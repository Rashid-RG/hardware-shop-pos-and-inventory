"""Manage existing rclone remotes and systemd backup timer; never expose credentials."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys

STATE=Path.home()/".local/share/ars-hardware"
TIMER="ars-drive-backup.timer"
SERVICE="ars-drive-backup.service"

def run(*args,**kwargs):
    return subprocess.run(args,check=True,timeout=60,**kwargs)

def validate():
    types=run("rclone","listremotes","--long",capture_output=True,text=True).stdout
    if not re.search(r"^ars-drive:\s+drive\s*$",types,re.M) or not re.search(r"^ars-encrypted:\s+crypt\s*$",types,re.M):
        raise ValueError("Configure ars-drive (Google Drive) and ars-encrypted (crypt) first.")
    run("rclone","lsd","ars-encrypted:","--crypt-remote","ars-drive:ARS-Backups",stdout=subprocess.DEVNULL)
    print("Encrypted remote is accessible. Upload and recovery tests are still required.")

def manage(action):
    if os.geteuid()==0:
        raise ValueError("Run as the desktop user.")
    project=(STATE/"project").resolve(strict=True)
    if action=="validate":
        validate()
    elif action=="enable":
        validate()
        run("bash",str(project/"scripts/mint/install-drive-backup.sh"))
    elif action=="disable":
        run("systemctl","--user","disable","--now",TIMER)
        print("Scheduled backups disabled. Existing backups are preserved.")
    elif action=="backup":
        validate()
        # Use the same systemd unit for manual and scheduled execution.
        # No second independent upload process is launched.
        result=subprocess.run(["systemctl","--user","start",SERVICE],check=True,timeout=3600)
        print("Backup service completed. Check last verified cloud backup status.")
    else:
        raise ValueError("Unknown action.")

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action",choices=["validate","enable","disable","backup"])
    args=parser.parse_args()
    try: manage(args.action)
    except (OSError,ValueError,subprocess.SubprocessError) as error:
        sys.exit("Cloud backup action failed: "+str(error))
