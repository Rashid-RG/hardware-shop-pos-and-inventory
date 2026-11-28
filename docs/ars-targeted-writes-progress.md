# ARS targeted business-write migration – progress

The original Windows server persists many unrelated tables by truncating and
re-inserting the entire normalized business state. This can erase receiving
history or duplicate inventory if mixed with targeted purchase receipts.

## Converted on this development branch

- Company profile/settings update: parameterized PostgreSQL upsert of
  `store_settings`, then authoritative cache reload. Branch manager profile
  edits are restricted to their assigned branch; global defaults remain
  administrator-controlled.
- Employee creation/update: targeted, branch-scoped SQL with input validation
  and authoritative cache reload.
- Manual expenses: append-only INSERT plus audit activity in one database
  transaction; reload on commit. Current legacy expense schema is not
  branch-scoped, so expense visibility/isolation must be redesigned separately
  before enabling unrelated tenants.

All three paths fail closed when previous DB writes are unhealthy; if a commit
succeeds but reload fails, further writes are disabled until reconciled.

## Still using legacy whole-state rewrite

- QR code upload and some settings-adjacent features
- Invoice print/share audit logging
- Quotations (create, status, convert, delete)
- Cashier shifts (open and close)
- Explicit destructive admin reset utilities (remain disabled by default)

The database-wide receipt-history safety guard is deliberately retained. These
remaining legacy endpoints may reject writes once warehouse receiving starts.
Do not remove the guard before every affected workflow is migrated to targeted
transactions.

## Release gate

Pass current GitHub Actions checks; run isolated PostgreSQL trials for each
converted endpoint both before and after a partial receipt; verify shop scope
and audit rows. Run the Windows A4 printer and local backup/restore drills.
Do not deploy, merge or use for live ARS operations based only on static checks.
