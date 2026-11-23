# ARS Hardware POS — Hosted installation and controlled maintenance

**Status:** Deployment preparation only. These instructions do not represent a completed deployment. The owner must approve the target host and every business release.

## Why hosted ARS for a slow Windows PC?

On the employee PC, only a current Microsoft Edge or Chrome browser and working A4 printer are needed. The application server performs database operations and hosts ARS. The browser needs an internet connection to save invoices. **Offline billing and automatic sync are not currently supported; do not assume invoices save during an outage.**

## Hosted architecture requirements

- **One application instance only.** ARS currently uses a database-wide PostgreSQL advisory lock and some legacy in-memory state. Do not enable multiple instances, autoscaling, zero-downtime overlap, or concurrent deployments sharing the same database. New instances cannot start until the existing one releases the lock.
- PostgreSQL 16 or a compatible managed PostgreSQL service. Configure `DATABASE_URL` using secrets, never commit its credentials. Verify TLS settings and network protections supported by the provider.
- A persistent file volume at `<app working directory>/uploads` for uploaded product/company images. **An ephemeral container filesystem would lose files after restart/deploy.** Database backups alone do not back up uploaded files.
- A long, unique `JWT_SECRET`, stored in the host's secret store. Do not change casually: replacing it invalidates existing sessions.
- HTTPS for all staff and customers accessing ARS. Set `NODE_ENV=production`, `PORT` according to the host, and `CORS_ALLOWED_ORIGINS` if cross-origin access is required. Use a non-sensitive `ARS_RELEASE_ID` such as a short Git commit ID for support checks.
- A stable process with `npm ci`, `npm run build`, and `npm start`. Health checks: `GET /api/health`; readiness: `GET /api/ready` (returns HTTP 503 if data writes need recovery).
- Independent automatic PostgreSQL backups **and** uploads backups with retention, encryption, access controls and regularly verified restore. Never run a restore against production without separate, explicit authorization.
- Restrict administrative access, database inbound traffic and server logs. Run a tested, modest single-instance plan rather than a free service that sleeps during billing.

## First administrator: important safety rule

The first Super Admin can only be created through the server's **loopback** connection. The public hosted URL cannot create the first administrator. This prevents anonymous remote takeover of a fresh installation.

1. Provision **a fresh, empty staging database** without real business data.
2. Access `http://127.0.0.1:<PORT>` **on the host itself or through a trusted SSH local tunnel** to the running service. Choose a hosting provider that supports this securely, or arrange an approved one-time provisioning method first.
3. Open the first-time admin setup, use a unique name/email and strong password, then sign in.
4. Confirm subsequent setup attempts are refused. Create cashier/inventory accounts from the authenticated admin interface.
5. Never expose the setup endpoint publicly or bypass its loopback check to make hosting easier.

If the chosen hosting provider cannot offer this secure initial access, **do not deploy with an uninitialized login flow**. Select a compatible host or implement and test a separate secure one-time provisioning command before deployment.

## Approval-controlled release sequence (no automatic production deploy)

1. Develop on `codex/shop-opening-pilot`. Validate TypeScript, regression, PostgreSQL integration and build in GitHub Actions.
2. Test the candidate against a **separate staging PostgreSQL database**, including A4 print and uploads.
3. Owner reviews the change list and gives **explicit release approval**.
4. Before promotion, take a verified production PostgreSQL backup and uploaded-files backup; confirm restore instructions.
5. Schedule after-hours maintenance. Temporarily stop new checkout activity. Gracefully stop the existing app instance **before** starting the replacement (single-writer lock).
6. Deploy the exact approved commit using one instance. Preserve volumes and database. Never run destructive reset/seed scripts against existing data.
7. Confirm `/api/ready` returns ready; sign in; verify a saved historical invoice, product stock, customer account and image uploads. Test print from Windows.
8. If release checks fail, stop writes, restore the last working application commit using **the existing database unchanged when schema-compatible**. Database restore is a separate high-risk operation requiring approval.

**No automatic merges or business production deployments are configured by this document.** In the future a deployment job can be restricted to manually-approved environments.

## Windows PC — first-time and daily workflow

After the server is live and approved:

1. In Edge, open the company's verified `https://` ARS URL; confirm its certificate.
2. Optionally download the project script `scripts/install-hosted-shortcut.ps1` from the verified source and run in PowerShell, replacing the URL with the actual approved address:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-hosted-shortcut.ps1 -Url https://YOUR-APP-URL`
   The script creates a Desktop URL shortcut only; it never installs PostgreSQL, Node.js, Docker, or background software.
3. Install the printer driver, set A4 paper, print a sample invoice and confirm layout.
4. Every morning: power on PC, connect internet, double-click **ARS Hardware POS**, sign in, and start invoices.
5. At closing: finish shift/credit checks, confirm saved invoices, sign out, and shut down Windows. The hosted database stays on the server.
6. On failures: stop creating invoices if save confirmation is missing; avoid repeated checkout clicks. Managers can visit **Company Profile → System Health & Support** and copy a safe support summary for an authorized technician. **Never put customer phone numbers, passwords, tokens or invoice contents in the support description.**

## Current release gates

- [x] Existing application has production build and GitHub Actions verification.
- [x] Read-only authenticated system diagnostics for managers.
- [x] Windows HTTPS shortcut creation helper.
- [ ] Hosting provider and separate staging database selected.
- [ ] Safe first-administrator loopback setup proven on target host.
- [ ] Persistent uploads, scheduled backups and restore drill proven.
- [ ] Controlled one-instance deployment verified.
- [ ] Actual A4 invoice printing and slow-PC staff acceptance.
- [ ] Explicit owner approval for business release.
