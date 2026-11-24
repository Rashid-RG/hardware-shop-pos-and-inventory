"""Read-only fingerprints; caller supplies a PostgreSQL command for the intended database."""
import hashlib
import json
import re
import subprocess

def fingerprints(command,snapshot=None):
    if snapshot is not None and not re.fullmatch(r"[0-9A-Fa-f-]+",snapshot):
        raise ValueError("Invalid exported snapshot identifier.")
    prefix="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
    if snapshot:
        prefix+="SET TRANSACTION SNAPSHOT '"+snapshot+"';\n"
    prefix+="SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex';\n"
    def query(sql):
        return subprocess.run(command,input=prefix+sql+";\nCOMMIT;\n",text=True,capture_output=True,check=True,timeout=300).stdout.strip()
    tables=json.loads(query("SELECT COALESCE(json_agg(tablename ORDER BY tablename COLLATE \"C\"),'[]'::json) FROM pg_tables WHERE schemaname='public'"))
    result={}
    for table in tables:
        quoted='"'+table.replace('"','""')+'"'
        sql="SELECT row_to_json(t)::text FROM public."+quoted+' t ORDER BY row_to_json(t)::text COLLATE "C"'
        digest=hashlib.sha256()
        count=0
        with subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE) as proc:
            proc.stdin.write((prefix+sql+";\nCOMMIT;\n").encode())
            proc.stdin.close()
            for row in proc.stdout:
                digest.update(row)
                count+=1
            if proc.wait()!=0:
                raise RuntimeError("Snapshot fingerprint query failed.")
        result[table]={"rows":count,"sha256":digest.hexdigest()}
    return result
