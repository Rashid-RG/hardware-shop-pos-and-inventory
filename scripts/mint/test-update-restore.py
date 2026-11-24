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
from release_fingerprint import fingerprint

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

def test(folder, compatibility=False):
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
        app_created=False
        app_name=container+'-app'
        password=secrets.token_hex(32)
        compatibility_result=False
        build_fingerprint=None
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
                 "-e","POSTGRES_PASSWORD="+password,IMAGE],stdout=subprocess.DEVNULL)
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
            if compatibility:
                version=metadata.get("version","")
                if not isinstance(version,str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?",version):
                    raise ValueError("Invalid release version.")
                staged=STATE/"staged-releases"/version
                if not staged.is_dir() or staged.is_symlink() or not (staged/"dist/server.cjs").is_file():
                    raise ValueError("Verified staged application required.")
                run(["openssl","dgst","-sha256","-verify",str(STATE/"release-signing-public.pem"),"-signature",str(staged/".ars-release-manifest.sig"),str(staged/".ars-release-manifest.json")])
                manifest=json.loads((staged/".ars-release-manifest.json").read_text())
                if manifest.get("version")!=version or manifest.get("product")!="ARS Distributor" or manifest.get("platform")!="linux-mint":
                    raise ValueError("Release manifest mismatch.")
                build_fingerprint=fingerprint(staged)
                node_image="node:22-bookworm-slim"
                run(["docker","image","inspect",node_image],stdout=subprocess.DEVNULL)
                def snapshot():
                    # Compare all original public table columns and rows, ignoring newly added columns.
                    tables=db("psql","-X","-U","restore_admin","-d","ars_update_test","-v","ON_ERROR_STOP=1","-Atc","SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",stdout=subprocess.PIPE,text=True).stdout.splitlines()
                    return {t:db("psql","-X","-U","restore_admin","-d","ars_update_test","-v","ON_ERROR_STOP=1","-Atc","SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='"+t+"' ORDER BY ordinal_position",stdout=subprocess.PIPE,text=True).stdout.splitlines() for t in tables if re.fullmatch(r"[a-z_][a-z0-9_]*",t)}
                def fingerprints(schema):
                    values={}
                    for t,cols in schema.items():
                        if not cols or any(not re.fullmatch(r"[a-z_][a-z0-9_]*",c) for c in cols):
                            raise ValueError("Unsupported database column identifier.")
                        projection=",".join('"'+c+'"' for c in cols)
                        sql='SELECT row_to_json(q)::text FROM (SELECT '+projection+' FROM public."'+t+'") q ORDER BY row_to_json(q)::text COLLATE "C"'
                        h=hashlib.sha256()
                        with subprocess.Popen(["docker","exec","-i",container,"psql","-X","-U","restore_admin","-d","ars_update_test","-v","ON_ERROR_STOP=1","-Atc",sql],stdout=subprocess.PIPE) as proc:
                            for block in iter(lambda:proc.stdout.read(1048576),b""):
                                h.update(block)
                            if proc.wait()!=0:
                                raise RuntimeError("Database fingerprint query failed.")
                        values[t]=h.hexdigest()
                    return values
                schema=snapshot()
                before=fingerprints(schema)
                # Share only the isolated PostgreSQL container's network namespace.
                # Mount staged code read-only, never the live project or credentials.
                run(["docker","run","-d","--pull=never","--name",app_name,
                     "--network","container:"+container,"--read-only","--tmpfs","/tmp",
                     "--tmpfs","/app/uploads","--cap-drop","ALL","--security-opt","no-new-privileges",
                     "-v",str(staged)+":/app:ro","-w","/app",
                     "-e","NODE_ENV=production","-e","ARS_LISTEN_HOST=127.0.0.1",
                     "-e","PORT=3000","-e","JWT_SECRET="+secrets.token_hex(48),
                     "-e","DATABASE_URL=postgresql://restore_admin:"+password+"@127.0.0.1:5432/ars_update_test",
                     node_image,"node","dist/server.cjs"],stdout=subprocess.DEVNULL)
                app_created=True
                for _ in range(90):
                    probe=subprocess.run(["docker","exec",app_name,"node","-e","fetch('http://127.0.0.1:3000/api/ready').then(r=>r.json()).then(d=>process.exit(d.ok===true&&d.status==='ready'&&d.database==='reachable'&&d.sourceOfTruth==='normalized'?0:1)).catch(()=>process.exit(1))"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
                    if probe.returncode==0:
                        break
                    time.sleep(2)
                else:
                    raise RuntimeError("Staged application failed readiness on isolated database.")
                run(["docker","stop","-t","15",app_name],stdout=subprocess.DEVNULL)
                if fingerprints(schema)!=before:
                    raise RuntimeError("Existing database rows changed during startup; automatic compatibility approval blocked.")
                if fingerprint(staged)!=build_fingerprint:
                    raise ValueError("Staged build changed during compatibility testing.")
                compatibility_result=True
            if sha(dump)!=checksum:
                raise ValueError("Backup changed during restoration test.")
        finally:
            if app_created:
                run(["docker","rm","-f","-v",app_name],stdout=subprocess.DEVNULL)
            if created:
                run(["docker","rm","-f","-v",container],stdout=subprocess.DEVNULL)
        result={"version":metadata["version"],"archive":name,"archiveSha256":checksum,
                "testedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "restoredRowCounts":counts,"restoreTestPassed":True,
                "buildFingerprint":build_fingerprint,"migrationCompatibilityPassed":compatibility_result,"activationApproved":False}
        temporary=folder/(".restore-"+uuid.uuid4().hex)
        temporary.write_text(json.dumps(result,indent=2)+"\n")
        temporary.replace(receipt)
        print("Isolated restoration verified:",receipt)
        print("Compatibility check:",compatibility_result,"; activation remains unapproved.")

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder",type=Path)
    parser.add_argument("--compatibility",action="store_true")
    args=parser.parse_args()
    try:
        test(args.folder,args.compatibility)
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError,zipfile.BadZipFile) as error:
        sys.exit("Restore test failed: "+str(error))
