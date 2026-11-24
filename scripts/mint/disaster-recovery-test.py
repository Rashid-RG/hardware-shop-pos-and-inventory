"""Rehearse recovery from a verified backup without touching the running database."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile

STATE=Path.home()/".local/share/ars-hardware"
TABLES=("products","customers","sales_transactions","sales_transaction_items","purchase_orders","supplier_payments","customer_credit_payments")

def run(*args,**kwargs):
    return subprocess.run(args,check=True,timeout=900,**kwargs)

FINANCIAL_TABLES=("ars_financial_accounts","ars_financial_movements","ars_customer_cheques",
                  "ars_customer_cheque_events","ars_financial_reconciliations","ars_cash_handovers",
                  "ars_partner_capital_entries","ars_partner_profit_allocations","ars_partner_profit_shares",
                  "ars_position_register","ars_supplier_due_dates","ars_invoice_due_dates",
                  "stock_logs","purchase_order_items","ars_receipt_cost_entries")

def financial_checks(container):
    def query(sql):
        return run("docker","exec",container,"psql","-X","-U","restore_admin","-d","ars_rehearsal","-v","ON_ERROR_STOP=1","-Atc",sql,capture_output=True,text=True).stdout.strip()
    counts={}
    missing=[]
    for table in FINANCIAL_TABLES:
        if query("SELECT to_regclass('public."+table+"') IS NOT NULL")!="t":
            missing.append(table)
        else:
            counts[table]=int(query('SELECT count(*) FROM public."'+table+'"'))
    checks={
        "customerReceivables": "SELECT COALESCE(SUM(credit_balance) FILTER (WHERE credit_balance>0),0)::text FROM customers",
        "customerCredits": "SELECT COALESCE(-SUM(credit_balance) FILTER (WHERE credit_balance<0),0)::text FROM customers",
        "supplierPayments": "SELECT COALESCE(SUM(amount),0)::text FROM supplier_payments",
    }
    if "ars_financial_movements" in counts:
        checks["netFinancialMovements"]="SELECT COALESCE(SUM(amount),0)::text FROM ars_financial_movements"
    if "ars_partner_capital_entries" in counts:
        checks["capitalContributions"]="SELECT COALESCE(SUM(amount_lkr) FILTER (WHERE entry_type='Contribution'),0)::text FROM ars_partner_capital_entries"
        checks["capitalDrawings"]="SELECT COALESCE(SUM(amount_lkr) FILTER (WHERE entry_type='Drawing'),0)::text FROM ars_partner_capital_entries"
    return {"ledgerCounts":counts,"missingTables":missing,"restoredTotals":{key:query(sql) for key,sql in checks.items()},
            "sourceReconciled":False,"note":"Restored totals only; no original snapshot comparison or certified accounting reconciliation."}

def rehearse(source):
    if os.geteuid()==0:
        raise ValueError("Run as the desktop user.")
    if source.is_symlink() or not source.is_file() or not re.fullmatch(r"ars-[A-Za-z0-9_-]+-(with-uploads|database-only)\.dump",source.name):
        raise ValueError("Select a regular managed ARS backup dump.")
    source=source.resolve(strict=True)
    project=(STATE/"project").resolve(strict=True)
    run(str(STATE/"node"),str(project/"scripts/verify-backup.mjs"),str(source))
    with source.open("rb") as stream:
        digest=hashlib.file_digest(stream,"sha256").hexdigest()
    if source.name.endswith("-with-uploads.dump"):
        with zipfile.ZipFile(source.with_name(source.stem+"-uploads.zip")) as archive:
            if archive.testzip() is not None:
                raise ValueError("Uploaded documents failed CRC verification.")
    name="ars-recovery-test-"+uuid.uuid4().hex
    image="postgres:16-alpine"
    run("docker","image","inspect",image,stdout=subprocess.DEVNULL)
    created=False
    try:
        run("docker","run","-d","--pull=never","--network","none","--name",name,
            "--label","com.rsnextward.ars-purpose=disaster-recovery-test",
            "--tmpfs","/var/lib/postgresql/data:rw,mode=0700",
            "-e","POSTGRES_USER=restore_admin","-e","POSTGRES_DB=ars_rehearsal",
            "-e","POSTGRES_PASSWORD="+secrets.token_hex(32),image,stdout=subprocess.DEVNULL)
        created=True
        for _ in range(90):
            probe=subprocess.run(["docker","exec",name,"pg_isready","-h","127.0.0.1","-U","restore_admin","-d","ars_rehearsal"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
            if probe.returncode==0: break
            time.sleep(2)
        else:
            raise RuntimeError("Isolated recovery database did not become ready.")
        with source.open("rb") as stream:
            run("docker","exec","-i",name,"pg_restore","-U","restore_admin","-d","ars_rehearsal","--single-transaction","--exit-on-error","--no-owner","--no-acl",stdin=stream)
        counts={}
        for table in TABLES:
            result=run("docker","exec",name,"psql","-X","-U","restore_admin","-d","ars_rehearsal","-v","ON_ERROR_STOP=1","-Atc",'SELECT count(*) FROM public."'+table+'"',capture_output=True,text=True)
            counts[table]=int(result.stdout.strip())
        finance=financial_checks(name)
        run(str(STATE/"node"),str(project/"scripts/verify-backup.mjs"),str(source))
        with source.open("rb") as stream:
            if hashlib.file_digest(stream,"sha256").hexdigest()!=digest:
                raise ValueError("Backup changed during rehearsal.")
    finally:
        if created:
            run("docker","rm","-f","-v",name,stdout=subprocess.DEVNULL)
    reports=STATE/"recovery-reports"
    reports.mkdir(mode=0o700,exist_ok=True)
    if reports.is_symlink(): raise ValueError("Unexpected report directory.")
    report={"backup":source.name,"sha256":digest,"testedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"restoreTestPassed":True,"counts":counts,"financialChecks":finance,"liveRestoreApproved":False}
    with tempfile.NamedTemporaryFile(mode="w",prefix="rehearsal-",suffix=".json",dir=reports,delete=False) as stream:
        json.dump(report,stream,indent=2)
        print("Recovery rehearsal report:",stream.name)
    print("Isolated restoration completed. Live data was not changed.")

if __name__=="__main__":
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive",type=Path)
    args=parser.parse_args()
    try: rehearse(args.archive)
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError,zipfile.BadZipFile) as error:
        sys.exit("Recovery rehearsal failed: "+str(error))
