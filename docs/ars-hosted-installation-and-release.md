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

## Prepared single-container hosting image (not deployed)

The repository now includes a portable `Dockerfile` and a fail-closed startup preflight.
These files **do not create a server, database, storage volume, or backup**.

Build only after choosing the host and approving an isolated staging setup:

```bash
docker build -t ars-hardware-pos:approved-staging .
```

The container expects the following **host-managed** runtime configuration:

- `NODE_ENV=production` and `PORT=3000` (or the approved hosting port).
- `DATABASE_URL` pointing to the **isolated staging PostgreSQL** database, never to a live or CI database.
- `JWT_SECRET` unique, strong, and provided through the host's secret management.
- `ARS_RELEASE_ID` identifying the exact approved Git commit.
- `ARS_DISABLE_HTTP_FIRST_ADMIN_SETUP=true` (default in Dockerfile and checked before startup): disables both HTTP first-admin endpoints, including when requests appear loopback via a reverse proxy.
- `ARS_UPLOADS_MOUNT_REQUIRED=true`. The `/app/uploads` directory must be a **dedicated, writable, persistent Linux mount** (network disk or managed persistent disk). The startup preflight checks the mount and refuses an ephemeral container directory.

**Do not start the image without the actual mounted storage, backup schedule and database access controls.** This is a single-instance application. Explicitly disable horizontal autoscaling and overlapping deployments. The container's `/api/ready` healthcheck proves database readiness, not that automatic backup or physical Windows printing is set up.

**Hosted-container first-admin protection:** the image sets `ARS_DISABLE_HTTP_FIRST_ADMIN_SETUP=true` and its startup preflight requires it. Thus `GET /api/auth/setup-status` and `POST /api/auth/setup-admin` are disabled even through a local reverse proxy. Use the console-only provisioning procedure below. Direct-local non-container development retains the separate loopback-only setup path.

## Automated deployment-package smoke verification (CI only)

GitHub Actions now builds the same production image and runs
`scripts/verify-hosted-container-ci.sh` **only in GitHub Actions**, against
its own disposable `hardware_pos_hosted_smoke_ci` PostgreSQL database and a
temporary Docker uploads volume. It checks that:

- The container starts, holds a single-writer lease, and reports `/api/ready`.
- HTTP first-admin status and account creation are both forbidden on hosted Docker.
- An uploaded test file remains available after stopping and replacing the container.
- A second test archive containing both a shop logo fixture and a product-image fixture is restored into a **separate disposable volume**, then verified against the originals with SHA-256 checksums. The live CI uploads volume is not overwritten.
- No example administrator account is silently created.

The test refuses to drop a database that existed before it started and refuses to reuse existing Docker uploads volumes. CI
verification is **not** a substitute for checking the selected staging host's
storage persistence, backups, printing, networking, costs, and recovery.

## Production backup and restoration requirement (still pending)

The CI drill proves that uploaded files *can* be archived and restored correctly.
It does **not** configure automatic backups at the future hosting provider.
Before live use, the approved staging installation needs:

1. Scheduled, encrypted PostgreSQL backups with tested retention.
2. Scheduled, encrypted backups of the persistent `/app/uploads` volume, including company logos and product images. Perform a consistent snapshot or stop writes while archiving.
3. Off-host storage under restricted access, with a tested recovery into an **isolated** environment. Never overwrite business data as part of a test.
4. Restore checks that confirm invoice/customer/stock values **and** image files, plus documented recovery responsibility and frequency.
5. Explicit owner approval before any business-database or uploads restore.

**Passing CI does not mean backups are running for your father's business.**

## First administrator: important safety rule

For the **local non-container app**, the first Super Admin is created only from the server's loopback connection. For the **hosted Docker image**, HTTP setup is entirely disabled to prevent reverse-proxy address confusion. Use the console procedure in the next section.

1. For a **local non-container installation only**, provision a fresh empty database without real business data.
2. Access `http://127.0.0.1:<PORT>` on the local host only. **Do not use a reverse proxy or public tunnel** for HTTP bootstrap; use the console procedure for hosted Docker.
3. Open the first-time admin setup, use a unique name/email and strong password, then sign in.
4. Confirm subsequent setup attempts are refused. Create cashier/inventory accounts from the authenticated admin interface.
5. Never expose the setup endpoint publicly or bypass its loopback check to make hosting easier.

For hosted Docker, do not attempt the HTTP setup procedure: its routes are disabled. Use the approved console-only provisioning command below.

## Alternative: one-time server-console administrator provisioning

For a container platform that cannot offer reliable loopback browser access, ARS
now includes a **console-only**, one-time first-admin command. It is not a
public HTTP endpoint and cannot overwrite an existing account.

1. Start the approved staging server on an empty, isolated database so the
   application can create its schema. Confirm the database is otherwise empty.
2. From the **trusted host administrator terminal**, open an interactive console
   in the already-running ARS container, using the provider's equivalent of:

   ```bash
   docker exec -it -e ARS_ALLOW_FIRST_ADMIN_BOOTSTRAP=true <ars-container> node scripts/provision-first-admin.mjs
   ```

   This is an **example command**, not a command already executed. The flag is
   applied only to this console invocation; never leave it enabled for the
   permanently running application.
3. Enter the first administrator's name, email, and password interactively.
   The tool hides password input, refuses non-interactive secrets, checks for
   existing users, and creates a bcrypt-hashed Super Admin inside a
   serialized PostgreSQL transaction.
4. **Restart the single ARS application instance** after successful console
   provisioning, because the existing login layer loads its user snapshot at
   startup. Do not start a second simultaneous instance against the same DB.
5. Sign in through HTTPS using the new administrator account and verify
   a second attempt to bootstrap is refused. Create additional staff users
   from authenticated system administration.

Never place passwords in a command line, shell history, GitHub repository or
CI secret output. Only perform this procedure on a new, approved staging
database or with explicit owner authorization for a new business environment.

**Do not deploy with an uninitialized login flow.** The administrator must be created and verified using the approved console-only procedure on hosted Docker before employees access ARS.

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

## Rehearse an interrupted writer’s restore from signed release tools

Run these commands from a known-good tools installation kept outside the release
under review. Use an independently provisioned `release-signing-public.pem` in
the ARS per-user state directory. The selected release must retain its signed
manifest, signature and archive. Use a release that includes the incident
restore command.

- Windows PowerShell

  ```powershell
  & "$env:LOCALAPPDATA\RS Nextward\ARS Distributor\update-tools\run-windows-trusted-incident-restore.ps1" -Project '<absolute signed release path>' -Runtime '<absolute operational data path>' -Confirmation 'RUN ISOLATED INCIDENT RESTORE'
  ```

- Linux Mint

  ```bash
  /usr/bin/python3 -E -s -B "$HOME/.local/share/ars-hardware/update-tools/run-trusted-incident-restore.py" '<absolute signed release path>' --confirmation 'RUN ISOLATED INCIDENT RESTORE'
  ```

The command verifies the publisher signature and archive checksum, then runs the
restore worker from a private extraction. It requires an incident-bound backup and
a local Docker engine with the PostgreSQL image already installed. A successful
test writes an isolated-restore receipt. Operational recovery and POS startup
remain separate approvals.


On Linux Mint, the installed service and Update Center retry an offline switch
interrupted before post-switch validation. The first update can recover using
the tools saved by the original setup wizard. A previous release from the update
feed requires its signed manifest, signature and archive. Recovery checks the
journal, maintenance hold and release identity before returning the project
pointer to the previous release. Billing stays stopped until an operator
finalizes the rollback and resumes the POS. A fully selected offline candidate
requires an explicit rollback decision.

## Production update feed

The dedicated Render static site publishes the `feed` directory from the
`ars-production-update-feed` branch with manual deployments. Its base URL is
`https://ars-distributors-updates.onrender.com/`. It serves public release
files only. Keep the signing private key, credentials, and business data on
their owner-controlled computers.

On an owner-controlled Linux release workstation, create the signing key
in a new private directory outside the source checkout. OpenSSL prompts for
the key's encryption passphrase.

```bash
umask 077
mkdir -m 700 "$HOME/ars-release-signing" &&
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -aes-256-cbc \
  -out "$HOME/ars-release-signing/private.pem" &&
openssl pkey -in "$HOME/ars-release-signing/private.pem" -pubout \
  -out "$HOME/ars-release-signing/release-signing-public.pem"
```

Run these commands once for a new key. Keep an encrypted offline recovery copy,
and verify the public key independently before installing it on shop computers.
After owner approval, use `scripts/prepare-update-feed.py` on that workstation to
build the signed Windows and Mint bundles from the approved commit.
Prepare a publication commit after approval. This command verifies both signed
manifests against the approved application commit and writes one Git commit
containing the signed downloads and the new site status.

```bash
git fetch origin ars-production-update-feed
python3 scripts/prepare-update-publication.py \
  --feed /path/to/signed-bundles \
  --approved-commit APPROVED_APPLICATION_COMMIT \
  --feed-base "$(git rev-parse FETCH_HEAD)" \
  --public-key /path/to/release-signing-public.pem
```

Review the returned `publicationCommit` with `git show --stat`, then push it
to the feed branch with a normal fast-forward push and deploy the site in
Render. If the feed branch changed during preparation, fetch the new head,
review the changes, and prepare the commit again.

```bash
git push origin PUBLICATION_COMMIT:refs/heads/ars-production-update-feed
```

Check both published archives with only the public key before provisioning the
feed URL on shop computers.

```bash
node scripts/verify-published-update-feed.mjs \
  https://ars-distributors-updates.onrender.com/ APPROVED_VERSION \
  /path/to/release-signing-public.pem APPROVED_APPLICATION_COMMIT
```
