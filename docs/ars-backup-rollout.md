# ARS Windows backup rollout (development branch)

The PostgreSQL database runs as Docker container `hardware-pos-postgres` with database `hardware_pos`.
The backup command **only reads** the database. It neither restores nor migrates anything.

## Trial backup (test database only)

1. Start Docker Desktop and confirm the ARS PostgreSQL container is healthy.
2. From the project folder, run `node scripts/backup-local.mjs`.
3. Look for `"status":"verified"` in the output and a new `backups/ars_*.dump` file.
4. Copy the backup to a separate encrypted disk; the local backup directory is not enough protection against disk failure.

The command writes a temporary `.partial` file, waits for `pg_dump` success, checks PostgreSQL custom archive metadata using `pg_restore --list`, then publishes the completed `.dump` file. Only after success does it retain the newest 30 archives by default (minimum 7). `ARS_BACKUP_DIR` and `ARS_BACKUP_KEEP` are optional environment settings.

## Daily automatic backup (optional)

Once the trial works, in Windows PowerShell run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1 -Time 18:00
```

This registers a Windows Scheduled Task named `ARS Daily PostgreSQL Backup` for the current user. It only works while Windows and Docker are running. Review its history and check backup output regularly. To disable, use Windows Task Scheduler (disable the task).

## Restore drill (not automated)

**Never restore into the actual ARS business database for a test.** Create a separate disposable PostgreSQL database/container and restore there using `pg_restore`. Confirm sample customer, invoice, shipment, product, stock, and partner records, and run integrity checks before accepting recovery. A successful archive-list check alone does not prove restorability.

The backup currently covers **PostgreSQL data only**. Uploaded company logos and product images in `uploads/` must be backed up separately. Do not treat this as a complete disaster recovery solution until off-device copies, upload backups, restore drills, and scheduled-task execution have been verified on the real Windows laptop.

## Development status

- Backup command: code added; not yet exercised against the laptop's Docker database.
- Windows scheduling: installer added; not yet installed or executed on laptop.
- Shipment partial receiving and partner profit distributions: still pending separate development and integration testing.
- No deployment or live-database changes were made.
