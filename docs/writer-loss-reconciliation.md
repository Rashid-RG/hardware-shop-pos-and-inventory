# Writer-loss incident reconciliation

RS Nextward / ARS Distributor

The runtime-local .ars-writer-loss.json marker blocks ordinary startup. The read-only inspection primitive classifies missing, valid and invalid evidence and returns a SHA-256 fingerprint for valid evidence. It never clears the marker or authorizes startup.

Before any future clearance procedure, confirm the previous server and outstanding database sessions are settled, verify the correct database identity and a recoverable backup, and reconcile the last affected invoices, payments, inventory movements and accounting postings against source records. A missing incident file alone is not proof of a safe shutdown. Do not automatically replay transactions or restore the database.

The inspection primitive is not a graphical recovery wizard or an authorization to resume trading. Native acceptance and controlled clearance remain pending.

## Artifact integrity inspection

Retain seven JSON evidence documents in writer-loss-evidence/<incident SHA-256>/<category>.json, where category is databaseIdentity, previousSession, recoverableBackup, invoices, payments, inventory or accounting. Each document must include schema: 1, incidentDigest and category, and its exact bytes must match the operator review fingerprint. The inspector rejects linked, missing, oversized, malformed or mismatched artifacts. Integrity is not proof of accounting correctness, database identity, backup recoverability or operator authority. No startup clearance is granted.
