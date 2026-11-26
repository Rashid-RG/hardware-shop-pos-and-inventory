#!/usr/bin/env python3
"""Read-only Mint recovery window; never clears evidence or starts POS."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

STATE=Path.home()/".local/share/ars-hardware"
TITLE="ARS Distributor | RS Nextward Recovery Center"
LABELS={
    "incidentRetained":"Incident evidence retained",
    "evidenceIntegrityMatched":"Evidence integrity",
    "restoreReceiptMatched":"Isolated restore receipt",
    "databaseIdentityMatched":"Database identity",
    "noDatabaseActivityObserved":"Outstanding database activity check",
}

def format_status(data):
    if data.get("startupAllowed") is not False or data.get("recoveryAllowed") is not False:
        raise ValueError("Unexpected authorization.")
    if data.get("state")=="no-incident-record":
        return "No writer-loss incident found. This does not authorize startup."
    if data.get("state") not in ("preflight-matched-review-required","preflight-blocked"):
        return "Diagnostics unavailable. Contact RS Nextward support."
    checks=data.get("checks",{})
    base="\n".join(label+": "+("Matched" if checks.get(key) is True else "Review required") for key,label in LABELS.items())

    sections=data.get("reconciliation",{}).get("sections",{})
    labels={"business":"Invoices and stock integrity","financial":"Cash and customer balances","stockPayables":"Stock and supplier estimates","partnerPayroll":"Partner and payroll links","partner":"Partner capital and drawings","imports":"Import creditor balances","payroll":"Salary, advances, EPF and ETF","inventory":"Variant and Box/Piece valuation"}
    states={"selected-checks-match":"Selected checks match","estimate-review":"Estimate review","no-coverage":"No coverage","review-required":"Review required","unavailable":"Unavailable"}
    lines=[label+": "+states.get(sections.get(key),"Not inspected") for key,label in labels.items()]
    return base+"\n\nBusiness reconciliation (separate read-only snapshots):\n"+"\n".join(lines)+"\n\nExternal evidence and operator approval remain required."

def notice(message):
    subprocess.run(["zenity","--info","--no-markup","--title="+TITLE,"--width=580","--text="+message],check=False)

def main():
    if os.geteuid()==0:
        raise ValueError("Run as desktop user.")
    project=(STATE/"project").resolve(strict=True)
    runtime=STATE/"runtime"
    if runtime.is_symlink() or runtime.resolve(strict=True)!=runtime or not runtime.is_dir():
        raise ValueError("Permanent runtime required.")
    # Never derive expected identity from the database currently being investigated.
    binding=STATE/"database-binding.json"
    if binding.is_symlink() or not binding.is_file() or binding.stat().st_size>8192:
        notice("A previously verified database identity is required. Contact RS Nextward support. No changes made.")
        return
    saved=json.loads(binding.read_text())
    if saved.get("schema")!=1 or saved.get("activationAllowed") is not False or saved.get("database")!="hardware_pos_ars" or not re.fullmatch(r"[0-9]{1,20}",str(saved.get("systemIdentifier",""))) or not re.fullmatch(r"[0-9]{1,10}",str(saved.get("databaseOid",""))):
        raise ValueError("Invalid saved identity.")
    if subprocess.run(["zenity","--question","--no-markup","--title="+TITLE,"--text=Inspect retained incident evidence and local database activity? No recovery or startup will be performed."],check=False).returncode!=0:
        return
    progress=subprocess.Popen(["zenity","--progress","--pulsate","--no-cancel","--title="+TITLE,"--text=Running read-only recovery diagnostics..."],stdin=subprocess.PIPE)
    try:
        result=subprocess.run([str(STATE/"node"),str(project/"scripts/writer-loss-offline-diagnostics.mjs"),str(runtime),saved["database"],str(saved["systemIdentifier"]),str(saved["databaseOid"])],cwd=project,capture_output=True,text=True,timeout=900)
        if len(result.stdout)>65536:
            raise ValueError("Unexpected diagnostic output.")
        message=format_status(json.loads(result.stdout))
    finally:
        if progress.poll() is None: progress.terminate()
        progress.wait()
    notice(message)

if __name__=="__main__":
    try: main()
    except (OSError,ValueError,TypeError,AttributeError,subprocess.SubprocessError):
        notice("Recovery diagnostics unavailable. Contact RS Nextward support. No changes made.")
