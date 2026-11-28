"""Exercise the production Mint backup against an isolated CI Docker cluster."""
import os
from pathlib import Path
import subprocess
import tempfile
import uuid
from zipfile import ZipFile

import backup


if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
    raise SystemExit("A disposable GitHub-hosted runner is required.")


def run(command, **options):
    return subprocess.run(command, check=True, timeout=120, **options)


with tempfile.TemporaryDirectory(prefix="ars-mint-cluster-") as directory:
    root = Path(directory)
    backups = root / "backups"
    backups.mkdir()
    (root / "uploads").mkdir()
    (root / "uploads" / "sample.txt").write_text("disposable fixture\n")
    compose_file = root / "compose.yaml"
    compose_file.write_text("""
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ars
      POSTGRES_DB: hardware_pos_ars
      POSTGRES_HOST_AUTH_METHOD: trust
    network_mode: none
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-h", "127.0.0.1", "-U", "ars", "-d", "hardware_pos_ars"]
      interval: 1s
      timeout: 3s
      retries: 45
""")
    backup.COMPOSE = ["docker", "compose", "-p", "ars-backup-ci-" + uuid.uuid4().hex, "-f", str(compose_file)]
    backup.BACKUPS = backups
    source_project = backup.ROOT
    backup.ROOT = root

    # Retain production archive verification while giving the fixture its own root.
    def verify_archive(dump):
        run(["node", str(source_project / "scripts/verify-backup.mjs"), str(dump)])

    backup.verify = verify_archive
    docker = ["docker", "--host", "unix:///var/run/docker.sock"]
    compose = docker + backup.COMPOSE[1:]
    try:
        run(compose + ["up", "-d", "--wait", "postgres"])
        worker = compose + ["exec", "-T", "postgres"]
        source = backup.psql_command(worker, "ars", backup.DATABASE)
        run(source, input="CREATE TABLE stock (id integer PRIMARY KEY, value numeric); INSERT INTO stock VALUES (1, 125.75);", text=True)
        identity_sql = (
            "SELECT system_identifier::text, (SELECT oid::text FROM pg_database "
            "WHERE datname=current_database()) FROM pg_control_system()"
        )
        system_id, oid = run(source + ["-c", identity_sql], capture_output=True, text=True).stdout.strip().split("|")
        wrong_oid = "1" if oid != "1" else "2"
        try:
            backup.backup(retain_all=True, expected_cluster=(system_id, wrong_oid))
        except ValueError as error:
            assert str(error) == "PostgreSQL cluster identity mismatch."
        else:
            raise AssertionError("Wrong database OID accepted")
        assert not list(backups.iterdir())

        backup.backup(retain_all=True, expected_cluster=(system_id, oid))
        (dump,) = backups.glob("*.dump")
        with ZipFile(dump.with_name(dump.stem + "-uploads.zip")) as uploads:
            assert uploads.read("uploads/sample.txt") == b"disposable fixture\n"
        run(worker + ["createdb", "-U", "ars", "ars_backup_restore_ci"])
        with dump.open("rb") as archive:
            run(worker + ["pg_restore", "-U", "ars", "--exit-on-error", "-d", "ars_backup_restore_ci"], stdin=archive)
        restored = backup.psql_command(worker, "ars", "ars_backup_restore_ci")
        assert backup.fingerprints(restored) == backup.fingerprints(source)
    finally:
        run(compose + ["down", "--volumes"])
