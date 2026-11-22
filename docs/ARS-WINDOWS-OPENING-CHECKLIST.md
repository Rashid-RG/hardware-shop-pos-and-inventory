# ARS Hardware POS — Windows opening checklist

This guide applies to the existing **hardware-shop-pos-and-inventory** repository. It does not deploy or alter a production service.

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

```powershell
npm run local:start
```

The launcher verifies credentials, checks PostgreSQL connectivity, refuses to kill an unrelated process using port 3000, then starts the application. Open `http://localhost:3000` **after** the server reports it is listening. The terminal must remain running.

If Docker is used, the database is exposed on Windows port **5433**, not 5432. Port 5432 is inside the container. If a different database host is configured, make sure it is reachable; do not assume Docker Compose's local database is the intended business database.

## Verify before entering real sales

- Confirm the login works for each intended role and the role cannot use another shop's records.
- Confirm the ARS company name, address, contact details, tax details (where applicable), and invoice prefix in **Settings**.
- Print a sample **A4** invoice, check every line, totals, signatures, and the **RS Nextward** software footer on the physical printer.
- Enter a test product, make a small non-production sale, verify stock changes, refund it, and confirm stock and reports reconcile.
- Verify that customer credit payments never exceed the outstanding balance and supplier receipts cannot be duplicated.

## Backups and recovery

To save a local PostgreSQL backup on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-local-postgres.ps1
```

The script saves a `.dump` archive and its SHA-256 checksum under `backups`. Copy encrypted backup copies to storage **outside the POS computer**. The GitHub CI workflow restores an isolated test database and verifies records, but that does not replace a real restore drill on the ARS PC. **Do not restore into the operational ARS database to test a backup.** Use a separate test database and qualified operator.

Never run `docker compose down -v`, `docker volume rm`, or destructive reset/database migration tools against ARS business data.

## Opening decision

Do not label the system commercial-ready until physical Windows startup, actual A4 printing, user permissions, backup/restore, and end-to-end sales reconciliation have been checked and signed off. All automated CI tests passing is necessary but not sufficient.
