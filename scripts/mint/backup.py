"""Create and test backup sets for the local ARS Mint installation."""
import argparse
import datetime
import fcntl
import hashlib
import json
from backup_snapshot import exported_snapshot, fingerprints, psql_command
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BACKUPS = ROOT / 'backups'
DATABASE = 'hardware_pos_ars'
COMPOSE = ['docker', 'compose', '-p', 'ars-mint', '--env-file', '.env.local',
           '-f', 'scripts/mint/compose.yaml']
MANAGED = re.compile(r'ars-mint-\d{8}T\d{6}Z-[0-9a-f]{32}-(?:v2-)?(with-uploads|database-only)\.dump')


def db(*args, **kwargs):
    subprocess.run(COMPOSE + ['exec', '-T', 'postgres', *args], cwd=ROOT, check=True, **kwargs)


def verify(dump):
    node = Path.home() / '.local/share/ars-hardware/node'
    subprocess.run([str(node) if node.exists() else 'node', ROOT / 'scripts/verify-backup.mjs', dump], check=True)


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    Path(str(path) + '.sha256').write_text(f'{digest.hexdigest()}  {path.name}\n')


def backup():
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    uploads = ROOT / 'uploads'
    if uploads.is_symlink():
        expected = Path.home() / '.local/share/ars-hardware/runtime/uploads'
        if uploads.resolve(strict=True) != expected.resolve(strict=True) or expected.is_symlink():
            raise ValueError('Unexpected uploads storage link.')
        uploads = expected
    scope = 'with-uploads' if uploads.is_dir() else 'database-only'
    stem = f'ars-mint-{stamp}-{uuid.uuid4().hex}-v2-{scope}'
    with tempfile.TemporaryDirectory(dir=BACKUPS) as tmp:
        folder = Path(tmp)
        dump = folder / (stem + '.dump')
        command = psql_command(COMPOSE + ['exec', '-T', 'postgres'], 'ars', DATABASE)
        with exported_snapshot(command, cwd=ROOT) as snapshot:
            with dump.open('wb') as out:
                db('pg_dump', '-U', 'ars', '-d', DATABASE, '-Fc', '--snapshot', snapshot, stdout=out)
            tables = fingerprints(command, snapshot, cwd=ROOT)
        with dump.open('rb') as source:
            db('pg_restore', '--list', stdin=source, stdout=subprocess.DEVNULL)
        checksum(dump)
        manifest = dump.with_suffix('.manifest.json')
        manifest.write_text(json.dumps({
            'version': 1, 'archive': dump.name,
            'dumpSha256': Path(str(dump) + '.sha256').read_text().split()[0],
            'tables': tables,
        }, sort_keys=True) + '\n')
        checksum(manifest)
        if uploads.is_dir():
            archive = folder / (stem + '-uploads.zip')
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
                for file in [uploads, *uploads.rglob('*')]:
                    if file.is_symlink():
                        raise ValueError('Replace the link in uploads with its actual file before backing up.')
                    bundle.write(file, Path('uploads') / file.relative_to(uploads))
            checksum(archive)
        verify(dump)
        for companion in folder.iterdir():
            if companion != dump:
                companion.rename(BACKUPS / companion.name)
        dump.rename(BACKUPS / dump.name)
    # The cloud runner acquires its lock before this local archive stage.
    # A retained or malformed lock is still evidence: preserve all archives.
    if os.path.lexists(BACKUPS / '.ars-drive-backup.lock'):
        print('Backup retention deferred while encrypted backup is running or interrupted.', file=sys.stderr)
    else:
        completed = sorted((p for p in BACKUPS.glob('ars-mint-*.dump') if MANAGED.fullmatch(p.name)
                            and Path(str(p) + '.sha256').is_file()), reverse=True)
        for old in completed[30:]:
            for suffix in ['.dump', '.dump.sha256', '.manifest.json', '.manifest.json.sha256', '-uploads.zip', '-uploads.zip.sha256']:
                (BACKUPS / (old.stem + suffix)).unlink(missing_ok=True)
    print('ARS_ARCHIVE=' + str(BACKUPS / dump.name))


def restore(dump, confirmation=None):
    verify(dump)
    target = 'ars_restore_test_' + uuid.uuid4().hex
    if (confirmation if confirmation is not None else input(f'Test recovery into new database {target}. Type RESTORE TEST: ')) != 'RESTORE TEST':
        raise ValueError('Restore cancelled.')
    db('createdb', '-U', 'ars', '--template=template0', target)
    print('Isolated recovery database:', target, flush=True)
    with dump.open('rb') as source:
        db('pg_restore', '-U', 'ars', '--single-transaction', '--no-owner', '--no-acl', '-d', target, stdin=source)
    db('psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'ars', '-d', target, '-c',
       'SELECT (SELECT count(*) FROM public.products) AS products, '
       '(SELECT count(*) FROM public.customers) AS customers, '
       '(SELECT count(*) FROM public.sales_transactions) AS sales;')
    archive = dump.with_name(dump.stem + '-uploads.zip')
    if archive.exists():
        dest = Path(tempfile.mkdtemp(prefix='ars-recovery-'))
        with zipfile.ZipFile(archive) as bundle:
            for name in bundle.namelist():
                member = Path(name)
                if member.is_absolute() or '..' in member.parts:
                    raise ValueError('Invalid path in uploaded-file archive.')
            bundle.extractall(dest)
        print('Inspect restored uploads in', dest)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--restore', type=Path)
    parser.add_argument('--confirmation')
    args = parser.parse_args()
    os.umask(0o077)
    # Bind this job to the configuration generated by the Mint installer.
    config = (ROOT / '.env.local').read_text().splitlines()
    password = next((s.partition('=')[2] for s in config if s.startswith('ARS_MINT_DB_PASSWORD=')), '')
    expected = f'DATABASE_URL=postgresql://ars:{password}@127.0.0.1:5434/{DATABASE}'
    if not password or [line for line in config if line.startswith('DATABASE_URL=')] != [expected]:
        raise ValueError('Configured database differs from the Mint installation. Check .env.local.')
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    with (BACKUPS / '.mint-backup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        subprocess.run(COMPOSE + ['up', '-d', '--wait', 'postgres'], cwd=ROOT, check=True)
        if args.restore:
            restore(args.restore.resolve(), args.confirmation)
        else:
            backup()


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        sys.exit(str(error))
