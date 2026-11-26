# Writer-loss incident reconciliation

RS Nextward / ARS Distributor

The runtime-local .ars-writer-loss.json marker blocks ordinary startup. The read-only inspection primitive classifies missing, valid and invalid evidence and returns a SHA-256 fingerprint for valid evidence. It never clears the marker or authorizes startup.

Before any future clearance procedure, confirm the previous server and outstanding database sessions are settled, verify the correct database identity and a recoverable backup, and reconcile the last affected invoices, payments, inventory movements and accounting postings against source records. A missing incident file alone is not proof of a safe shutdown. Do not automatically replay transactions or restore the database.

The inspection primitive is not a graphical recovery wizard or an authorization to resume trading. Native acceptance and controlled clearance remain pending.

## Artifact integrity inspection

Retain seven JSON evidence documents in writer-loss-evidence/<incident SHA-256>/<category>.json, where category is databaseIdentity, previousSession, recoverableBackup, invoices, payments, inventory or accounting. Each document must include schema: 1, incidentDigest and category, and its exact bytes must match the operator review fingerprint. The inspector rejects linked, missing, oversized, malformed or mismatched artifacts. Integrity is not proof of accounting correctness, database identity, backup recoverability or operator authority. No startup clearance is granted.

## Incident backup verification

The recoverableBackup artifact must additionally include archive (an ARS .dump basename) and archiveSha256. The inspector checks the matching archive in runtime/backups, rejects linked paths and validates existing backup checksums and applicable companion files. Archive integrity is not an isolated restore test or proof that the archive is the correct recovery point. No restore or startup clearance is granted.

## Isolated restore receipt contract

The incident receipt inspector expects isolated-restore-receipt.json in the incident evidence directory. It matches the incident and actual verified dump SHA-256, requires a separate PostgreSQL instance without a published port or live volume, checks reported counts for eight core tables and requires an upload archive check when applicable. A matching receipt is not independent proof that a restore executed. Existing Mint isolated restore tooling is the basis for a future receipt producer; the older Windows same-cluster restore utility does not qualify. No receipt producer, restore execution or startup clearance is enabled by this inspector.

## Combined recovery preflight

The read-only preflight composes incident inspection, evidence integrity, isolated restore receipt matching and database diagnostics. A matching preflight is not recovery authorization. Expected database identity must come from an independently trusted binding. Independent accounting reconciliation, continuous writer exclusion and operator authorization remain mandatory; no marker is cleared.
