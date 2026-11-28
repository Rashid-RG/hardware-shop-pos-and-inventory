#!/usr/bin/env python3
"""Register an existing healthy local database identity, never during incident recovery."""
import os
import json
import re
import fcntl
import subprocess
from pathlib import Path
from datetime import datetime, timezone

STATE=Path.home()/".local/share/ars-hardware"
def run(*args):
    return subprocess.run(args,check=True,capture_output=True,text=True,timeout=15).stdout.strip()
def inspect():
    if os.environ.get("DOCKER_HOST") or os.environ.get("DOCKER_CONTEXT"):
        raise ValueError("Docker endpoint override not allowed.")
    context=run("docker","context","show")
    if run("docker","context","inspect",context,"--format","{{.Endpoints.docker.Host}}")!="unix:///var/run/docker.sock":
        raise ValueError("Local Docker socket required.")
    ids=run("docker","ps","--filter","label=com.docker.compose.project=ars-mint","--filter","label=com.docker.compose.service=postgres","--format","{{.ID}}").splitlines()
    if len(ids)!=1 or not re.fullmatch(r"[a-f0-9]{12,64}",ids[0]):
        raise ValueError("Exactly one running Mint database required.")
    c=json.loads(run("docker","inspect",ids[0]))[0]
    mounts=[m for m in c["Mounts"] if m["Destination"]=="/var/lib/postgresql/data"]
    if len(mounts)!=1 or mounts[0]["Type"]!="volume" or mounts[0]["Name"]!="ars-mint_data":
        raise ValueError("Unexpected database volume.")
    v=json.loads(run("docker","volume","inspect","ars-mint_data"))[0]
    if v["Driver"]!="local" or (v.get("Labels") or {}).get("com.docker.compose.project")!="ars-mint" or (v.get("Labels") or {}).get("com.docker.compose.volume")!="data":
        raise ValueError("Unexpected volume ownership.")
    ports=c["NetworkSettings"]["Ports"].get("5432/tcp")
    if ports!=[{"HostIp":"127.0.0.1","HostPort":"5434"}]:
        raise ValueError("Unexpected database port.")
    runtime=STATE/"runtime"
    config=runtime/".env.local"
    if runtime.resolve(strict=True)!=runtime or config.resolve(strict=True)!=config or not config.is_file() or config.stat().st_size>65536:
        raise ValueError("Invalid runtime configuration.")
    project=(STATE/"project").resolve(strict=True)
    sql="SELECT system_identifier::text || ':' || (SELECT oid::text FROM pg_database WHERE datname=current_database()) FROM pg_control_system()"
    inside=run("docker","exec",c["Id"],"psql","-X","-U","ars","-d","hardware_pos_ars","-v","ON_ERROR_STOP=1","-Atc",sql)
    outside=run(str(STATE/"node"),str(project/"scripts/mint-database-identity-probe.mjs"),str(config))
    if inside!=outside or not re.fullmatch(r"[0-9]{1,20}:[0-9]{1,10}",inside):
        raise ValueError("Database identity mismatch.")
    sid,oid=inside.split(":")
    return {"schema":1,"database":"hardware_pos_ars","systemIdentifier":sid,"databaseOid":oid,"volume":"ars-mint_data","port":5434,"containerId":c["Id"],"startedAt":c["State"]["StartedAt"],"activationAllowed":False}

def guard():
    for p in [STATE/"maintenance-hold.json",STATE/"handoff-pending.json",STATE/"runtime"/".ars-writer-loss.json",STATE/"database-binding.json"]:
        if p.exists() or p.is_symlink(): raise ValueError("Existing maintenance, incident or binding evidence blocks registration.")

def main():
    if os.geteuid()==0 or STATE.resolve(strict=True)!=STATE:
        raise ValueError("Trusted desktop state required.")
    with (STATE/"update.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        guard()
        first=inspect()
        answer=subprocess.run(["zenity","--question","--no-markup","--title=ARS Distributor | RS Nextward","--text=Register the existing local ARS database identity for future recovery? Only confirm if this is the known healthy business database."],check=False)
        if answer.returncode!=0:return
        guard()
        if inspect()!=first:raise ValueError("Database changed during registration.")
        first["createdAt"]=datetime.now(timezone.utc).isoformat()
        with os.fdopen(os.open(STATE/"database-binding.json",os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as stream:
            json.dump(first,stream)
            stream.flush()
            os.fsync(stream.fileno())
        fd=os.open(STATE,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
    subprocess.run(["zenity","--info","--no-markup","--text=Database identity retained. No activation authorized."],check=False)
if __name__=="__main__":
    try:main()
    except (OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError):
        subprocess.run(["zenity","--error","--no-markup","--text=Database registration blocked. Contact RS Nextward support."],check=False)
