"""Executed only inside a private native rehearsal namespace."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.request
import uuid

PG="/usr/lib/postgresql/16/bin/"
DB="postgresql://restore_admin@127.0.0.1:5432/ars_update_test"
ENV={"PATH":"/usr/bin:/bin","HOME":"/tmp","LANG":"C","LC_ALL":"C","PGHOST":"127.0.0.1","PGPORT":"5432","PGUSER":"restore_admin","PGDATABASE":"ars_update_test"}
def run(*args,env=ENV,**kwargs):
    return subprocess.run(args,env=env,check=True,timeout=180,**kwargs)
def sql(command):
    return run(PG+"psql","-X","-v","ON_ERROR_STOP=1","-Atc",command,capture_output=True,text=True).stdout.strip()
def fingerprints():
    tables=sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
    result={}
    import re
    for table in tables:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*",table):
            raise ValueError("Unsupported historical table.")
        data=run(PG+"psql","-X","-v","ON_ERROR_STOP=1","-Atc",'SELECT row_to_json(q)::text FROM public."'+table+'" q ORDER BY row_to_json(q)::text COLLATE "C"',stdout=subprocess.PIPE).stdout
        result[table]=hashlib.sha256(data).hexdigest()
    if not result:
        raise ValueError("Missing restored tables.")
    return result

def main():
    if os.geteuid()==0 or Path("/app/.env.local").exists():
        raise RuntimeError("Invalid sandbox.")
    run(PG+"initdb","-D","/tmp/pg","-U","restore_admin","-A","trust","--no-locale","-E","UTF8",stdout=subprocess.DEVNULL)
    run(PG+"pg_ctl","-D","/tmp/pg","-l","/tmp/postgres.log","-o","-h 127.0.0.1 -p 5432 -k /tmp","-w","start",stdout=subprocess.DEVNULL)
    app=None
    try:
        run(PG+"createdb","ars_update_test")
        run(PG+"pg_restore","--single-transaction","--exit-on-error","--no-owner","--no-acl","-d","ars_update_test","/recovery.dump")
        email="native-test-"+uuid.uuid4().hex+"@example.invalid"
        uid="native-test-"+uuid.uuid4().hex
        password=secrets.token_hex(32)
        hashed=run("/native-node","-e","console.log(require('bcryptjs').hashSync(process.argv[1],10))",password,cwd="/app",capture_output=True,text=True).stdout.strip()
        import re
        if not re.fullmatch(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}",hashed):
            raise ValueError("Invalid synthetic user hash.")
        sql("INSERT INTO users(id,email,name,role,password_hash) VALUES ('"+uid+"','"+email+"','Native Test Admin','Super Admin','"+hashed+"')")
        before=fingerprints()
        env={**ENV,"NODE_ENV":"production","DATABASE_URL":DB,"PORT":"3000","ARS_LISTEN_HOST":"127.0.0.1","JWT_SECRET":secrets.token_hex(48),"ARS_TEST_EMAIL":email,"ARS_TEST_PASSWORD":password,"ARS_TEST_SHOP":"shop-main"}
        def start():
            child=subprocess.Popen(["/native-node","dist/server.cjs"],cwd="/app",env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                for _ in range(90):
                    if child.poll() is not None:
                        raise RuntimeError("Native server exited.")
                    try:
                        with urllib.request.urlopen("http://127.0.0.1:3000/api/ready",timeout=1) as response:
                            data=json.load(response)
                        if data.get("ok") is True and data.get("status")=="ready" and data.get("database")=="reachable" and data.get("sourceOfTruth")=="normalized":
                            return child
                    except (OSError,ValueError):
                        pass
                    time.sleep(1)
                raise RuntimeError("Native readiness timeout.")
            except BaseException:
                stop(child)
                raise
        def stop(child):
            if child.poll() is None:
                child.terminate()
                try:child.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
        app=start()
        run("/native-node","/read-probe.mjs",cwd="/app",env=env)
        stop(app)
        app=None
        sql("DELETE FROM auth_sessions WHERE user_id='"+uid+"'")
        if fingerprints()!=before:
            raise RuntimeError("Historical records changed.")
        app=start()
        run("/native-node","/write-probe.mjs",cwd="/app",env={**env,"ARS_TEST_ALLOW_WRITES":"isolated-disposable"})
        stop(app)
        app=None
        print("ARS_NATIVE_REHEARSAL_PASSED")
    finally:
        if app is not None:
            app.kill()
            app.wait()
        run(PG+"pg_ctl","-D","/tmp/pg","-m","fast","-w","stop",stdout=subprocess.DEVNULL)

if __name__=="__main__":
    main()
