#!/usr/bin/env python3
"""Test a pinned recovery archive in a separate PostgreSQL instance; never restore live data."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
import uuid
import zipfile

STATE = Path.home()/".local/share/ars-hardware"
RECOVERY = STATE/"update-recovery"
IMAGE = "postgres:16-alpine"
TABLES = ("products","customers","sales_transactions","sales_transaction_items",
          "purchase_orders","purchase_order_items","supplier_payments","customer_credit_payments")

def run(args, **kwargs):
    return subprocess.run(args, check=True, timeout=900, **kwargs)

def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream,"sha256").hexdigest()

def test(folder):
    if os.geteuid()==0:
        raise ValueError("Run as the installed desktop user.")
    folder=folder.resolve(strict=True)
    if folder.parent!=RECOVERY.resolve(strict=True):
        raise ValueError("Select a pinned update recovery folder.")
    with (STATE/"update.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        metadata=json.loads((folder/"recovery.json").read_text())
        name=metadata.get("archive","")
        if not isinstance(name,str) or not re.fullmatch(r"ars-mint-\d{8}T\d{6}Z-[0-9a-f]{32}-(with-uploads|database-only)\.dump",name):
            raise ValueError("Invalid pinned archive name.")
        dump=folder/name
        project=(STATE/"project").resolve(strict=True)
        if str(project)!=metadata.get("previousProject"):
            raise ValueError("Active installation changed since backup.")
        run([str(STATE/"node"),str(project/"scripts/verify-backup.mjs"),str(dump)])
        checksum=sha(dump)
        # Invalidate any prior result before beginning another test.
        receipt=folder/"restore-test.json"
        receipt.unlink(missing_ok=True)
        if name.endswith("-with-uploads.dump"):
            with zipfile.ZipFile(folder/(dump.stem+"-uploads.zip")) as bundle:
                if bundle.testzip() is not None:
                    raise ValueError("Uploaded-file archive failed CRC verification.")
        container="ars-update-test-"+uuid.uuid4().hex
        created=False
        def db(*args,**kwargs):
            return run(["docker","exec","-i",container,*args],**kwargs)
        try:
            # No published port, no live volume, no host network, no live credentials.
            run(["docker","image","inspect",IMAGE],stdout=subprocess.DEVNULL)
            run(["docker","run","-d","--pull=never","--network","none","--name",container,
                 "--label","com.rsnextward.ars-purpose=update-restore-test",
                 "--tmpfs","/var/lib/postgresql/data:rw,mode=0700",
                 "-e","POSTGRES_USER=restore_admin",
                 "-e","POSTGRES_DB=ars_update_test",
                 "-e","POSTGRES_PASSWORD="+secrets.token_hex(32),IMAGE],stdout=subprocess.DEVNULL)
            created=True
            for _ in range(90):
                probe=subprocess.run(["docker","exec",container,"pg_isready","-h","127.0.0.1","-U","restore_admin","-d","ars_update_test"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
                if probe.returncode==0:
                    break
                time.sleep(2)
            else:
                raise RuntimeError("Isolated PostgreSQL instance not ready.")
            with dump.open("rb") as stream:
                db("pg_restore","-U","restore_admin","-d","ars_update_test",
                   "--single-transaction","--exit-on-error","--no-owner","--no-acl",stdin=stream)
            counts={}
            for table in TABLES:
                result=db("psql","-X","-U","restore_admin","-d","ars_update_test","-v","ON_ERROR_STOP=1","-Atc",
                          'SELECT count(*) FROM public."'+table+'"',stdout=subprocess.PIPE,text=True)
                counts[table]=int(result.stdout.strip())
            if sha(dump)!=checksum:
                raise ValueError("Backup changed during restoration test.")
        finally:
            if created:
                run(["docker","rm","-f","-v",container],stdout=subprocess.DEVNULL)
        result={"version":metadata["version"],"archive":name,"archiveSha256":checksum,
                "testedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "restoredRowCounts":counts,"restoreTestPassed":True,
                "migrationCompatibilityPassed":False,"activationApproved":False}
        temporary=folder/(".restore-"+uuid.uuid4().hex)
        temporary.write_text(json.dumps(result,indent=2)+"\n")
        temporary.replace(receipt)
        print("Isolated restoration verified:",receipt)
        print("Migration compatibility and activation remain unapproved.")

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder",type=Path)
    args=parser.parse_args()
    try:
        test(args.folder)
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError,zipfile.BadZipFile) as error:
        sys.exit("Restore test failed: "+str(error))
