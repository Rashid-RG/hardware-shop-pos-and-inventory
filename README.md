# ARS Distributor POS | RS Nextward

Wholesale distribution and inventory management, release 1.0.0 (shop-opening pilot).

**Release status:** automated validation passed at workflow #2777 (commit `9a0e8ad`), including zero reported npm audit findings for production and full dependencies. Physical shop acceptance and owner authorization remain required. This is not a production deployment approval.

## Application

The current implementation uses React, Vite, Express, TypeScript and PostgreSQL. The supported runtime is Node.js 22. The original development blueprint is preserved in `docs/original-development-blueprint.md` for historical reference; its proposed Next.js/Prisma migration and optional modules are not the V1.0 release scope.

## Automated validation

The CI workflow checks Windows scripts and real PostgreSQL billing, Mint scripts and recovery primitives, TypeScript and regression tests, generated A4 mixed-unit invoices, purchasing-to-customer-account and quotation-to-invoice lifecycles, accounting, first-administrator setup, authentication, partner profit allocation, backup/restore and hosted container smoke tests. These checks use isolated fixtures and do not constitute physical shop acceptance.

## Local setup

Use a separate test installation before onboarding real business data. Never commit environment files, database credentials, recovery keys or customer data. Do not use demo credentials on a live installation.

- Windows: use the existing `Launch-Hardware-POS.vbs` / `Start-Hardware-POS.bat` launchers and `Stop-Hardware-POS.bat` for shutdown.
- Linux Mint Cinnamon: provision Node.js 22, npm, Docker Engine and Compose v2, Python 3, Zenity and desktop utilities. As the shop desktop user, run `bash scripts/mint/install.sh` **only for a fresh installation**. Open **ARS Distributor POS** from the desktop. The installer rejects registered installations; do not rerun it to update an existing shop.
- For development with a dedicated test database: configure a private local environment, run `npm ci`, then `npm run dev`. For a production build use `npm run build` and `npm start` with the correct private configuration.

## Maintenance and backups

Business configuration, uploads and backups belong in permanent runtime storage. Keep PostgreSQL volumes and existing backups intact. Never delete volumes, reset the database, overwrite an existing runtime or restore a backup over production as part of a software update.

The RS Nextward Update Center supports protected backup preparation, isolated recovery and compatibility tests, offline release selection and rollback. **Live candidate startup and automatic live rollback are not approved.** Offline selection stops short of activating a new version. If a switch is unresolved, use the recovery controls and retain the maintenance hold. Do not manually remove blocking evidence.

Google Drive encryption and scheduled backup require setup on the actual machine, verification of a successful upload, and an isolated restore drill. Keep the encryption recovery credentials separately and securely.

### Windows Docker recovery rehearsal

On a dedicated Windows test machine, start Docker Desktop in Linux-container mode and run `npm ci` from the test checkout. From Windows PowerShell, run:

```powershell
.\scripts\rehearse-windows-docker-maintenance-recovery.ps1
```

The rehearsal builds a temporary maintenance supervisor and tests both supported database names with disposable sample data. It needs the managed Docker container names to be free and fails if either name is in use. A successful run prints a backup-and-restore result for each database.

## Shop-opening acceptance

Complete the [V1.0 acceptance checklist](docs/v1-shop-opening-acceptance.md) with the owner and operator before real data entry or release approval.

RS Nextward — ARS Distributor
