# ARS Hardware POS — Windows opening checklist

This guide applies to the existing **hardware-shop-pos-and-inventory** repository. It does not deploy or alter a production service.

## Fresh checkout setup shortcut

Double-click `Setup-ARS-Distributor.vbs` to prepare dependencies, compile the production build and create the desktop shortcut. This preparation tool intentionally refuses existing configuration, builds and shortcuts. It does not initialize a database or configure credentials. Complete the database configuration below before opening the POS. Existing installations must follow the approved backup and update procedure instead. If setup fails after compilation, inspect the failure before retrying; do not delete operational files.

## Before the first start

Install **Node.js 22**, **Git**, and **Docker Desktop with Linux containers**. Use the existing local project folder and the development branch `codex/shop-opening-pilot` when testing new changes. Never overwrite an existing database or replace an existing `.env.local` with template values.

From Windows PowerShell in the project folder:

```powershell
node --version
npm ci
docker compose config
```

Copy `.env.example` to `.env.local` only when `.env.local` does not already exist. Keep `.env.local` private and out of Git. Set `DATABASE_URL` to the actual database. For this repository's default Docker Compose configuration:

```text
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/hardware_pos
```

**Important:** The example Docker password is only a local development default. Replace it with a strong password before using the system for real business records. If the PostgreSQL volume already exists, changing `POSTGRES_PASSWORD` in Docker Compose alone **does not update the database user's existing password**. Change PostgreSQL credentials deliberately and verify the new connection without removing the volume.

Set a strong `JWT_SECRET` (at least 32 random characters). **Do not put employee passwords in `.env.local`**. The app stores password hashes in PostgreSQL and employee accounts are created in System Administration.

For a **new, empty user database**, open `http://localhost:3000` after startup. The one-time owner setup screen creates the first System Administrator. The setup endpoint is only accessible via localhost and closes once any account exists.

For an **existing local database with user accounts already present**, the setup wizard does not run and no users are overwritten. Sign in with a known administrator account. If you do not know the existing administrator password, first create a PostgreSQL backup, then run this explicit, local-only recovery tool and choose a new administrator password:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/recover-local-admin.ps1
```

It requires confirmation of a backup and updates **only the password hash of an existing Super Admin**. It never creates a user, resets PostgreSQL, or clears business records.

## Start the application

For the daily desktop launcher, prepare the approved release first with `npm ci --include=dev` and `npm run build` (after a verified backup for existing installations). Stop any previous development instance before switching. Double-click **Launch-Hardware-POS.vbs** to start the prepared production build on localhost and open the browser after database readiness is confirmed. The launcher does not download updates or rebuild automatically. A missing build produces an error rather than falling back to development mode.

For developer testing only:

```powershell
npm run local:start
```

The launcher verifies credentials, checks PostgreSQL connectivity, refuses to kill an unrelated process using port 3000, then starts the application. Open `http://localhost:3000` **after** the server reports it is listening. The terminal must remain running.

If Docker is used, the database is exposed on Windows port **5433**, not 5432. Port 5432 is inside the container. If a different database host is configured, make sure it is reachable; do not assume Docker Compose's local database is the intended business database.

## Optional automatic startup

After successful manual startup and backup verification, double-click `Configure-ARS-Startup.vbs` and confirm. This creates a shortcut in the current Windows user's Startup folder. At sign-in, the normal production launcher checks readiness and opens the browser. Run the utility again to disable startup. It refuses to replace or remove a shortcut belonging to a different installation. No database or Windows service settings are changed.

## Verify before entering real sales

- Confirm the login works for each intended role and the role cannot use another shop's records.
- Confirm the ARS company name, address, contact details, tax details (where applicable), and invoice prefix in **Settings**.
- Print a sample **A4** invoice, check every line, totals, signatures, and the **RS Nextward** software footer on the physical printer.
- Enter a test product, make a small non-production sale, verify stock changes, refund it, and confirm stock and reports reconcile.
- Verify that customer credit payments never exceed the outstanding balance and supplier receipts cannot be duplicated.

## Backups and recovery — mandatory for wholesale operation

**Only the Super Admin** sees **Backup & Recovery** in the ARS sidebar. This screen provides verified local procedures, but does not pretend a background backup happened or allow an unsafe live overwrite.

Before taking orders or changing any import, inventory, supplier, customer-credit or partner-capital records:

1. Confirm `.env.local` points to the intended operational database (usually `hardware_pos_ars`). Keep this file private.
2. In Windows PowerShell at the existing project root, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-local-postgres.ps1
```

The script now **reads the active DATABASE_URL**, refuses a mismatched database or Docker port, and creates a PostgreSQL custom-format `.dump` plus `.sha256` checksum under `backups`. Verify both files exist and copy them onto an **encrypted external disk** or suitably protected second location away from the ARS POS PC.

3. Verify the exact archive on the same machine by restoring **into a separate new test database** (replace the filename):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-local-postgres-test.ps1 -BackupFile "backups\ars-hardware_pos_ars-YYYYMMDD-HHMMSS.dump"
```

The restore command requires a matching checksum, validates the archive, refuses an existing database, and creates only a new database named `ars_restore_test_*`. **It never replaces or points the application at your working database.** After the test restore, inspect important counts and representative invoices, stock, credit, imports and partner entries in pgAdmin.

For normal business use, create and safely copy backups **every operating day**; additionally back up before important updates and test restore periodically. Off-site copies, retention and automatic scheduling are still operator responsibilities; this version **does not claim automatic daily backups**.

**If a disaster requires an actual production recovery**, stop new billing, retain and back up the damaged database, verify the archive in isolation, and conduct a separately approved cutover. Do not restore directly over the operational database. Never run `docker compose down -v`, `docker volume rm` or destructive reset commands.


## Opening decision

Do not label the system commercial-ready until physical Windows startup, actual A4 printing, user permissions, backup/restore, and end-to-end sales reconciliation have been checked and signed off. All automated CI tests passing is necessary but not sufficient.
