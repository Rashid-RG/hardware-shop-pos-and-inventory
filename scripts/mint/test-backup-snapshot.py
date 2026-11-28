"""Exercise snapshot consistency against the PostgreSQL service created by CI."""
import subprocess
import sys
import tempfile
from backup_snapshot import exported_snapshot, fingerprints, psql_command

prefix = ["docker", "exec", "-i", sys.argv[1]]
source = psql_command(prefix, "postgres", "ars_snapshot_ci")
restored = psql_command(prefix, "postgres", "ars_restored_ci")
for database in ("ars_snapshot_ci", "ars_restored_ci"):
    subprocess.run([*prefix, "createdb", "-U", "postgres", database], check=True)

def execute(command, sql):
    subprocess.run(command, input=sql, text=True, check=True)

execute(source, "CREATE TABLE stock (id integer, value numeric); INSERT INTO stock VALUES (1, 125.75);")
with tempfile.TemporaryFile() as archive:
    with exported_snapshot(source) as snapshot:
        execute(source, "UPDATE stock SET value=99;")
        subprocess.run([*prefix, "pg_dump", "-U", "postgres", "-Fc", "--snapshot", snapshot,
                        "ars_snapshot_ci"], stdout=archive, check=True)
        original = fingerprints(source, snapshot)
    archive.seek(0)
    subprocess.run([*prefix, "pg_restore", "-U", "postgres", "--exit-on-error",
                    "-d", "ars_restored_ci"], stdin=archive, check=True)

assert original["stock"]["rows"] == 1
assert fingerprints(restored) == original
assert fingerprints(source) != original
execute(restored, "UPDATE stock SET value=0;")
assert fingerprints(restored) != original
