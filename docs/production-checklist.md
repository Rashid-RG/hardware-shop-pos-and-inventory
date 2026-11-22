# Hardware Shop POS Production Checklist

## Phase 1: Security and Access Control
- [x] Implement server-side login and JWT sessions.
- [x] Enforce role-based authorization on API routes.
- [x] Remove UI-only permission checks as the source of truth.
- [x] Add login rate-limiting and temporary lockout controls.
- [x] Add baseline HTTP hardening headers and disable `x-powered-by`.
- [x] Add password rotation flow and admin user management.
- [x] Add explicit CORS policy and CSP for the final deployment topology.

## Phase 2: Data Layer and Reliability
- [x] Replace JSON file persistence with PostgreSQL-backed state.
- [x] Add SQL migration file for state table creation.
- [x] Split JSON state into normalized relational tables.
- [x] Add transaction-safe stock movement ledger tables.
- [ ] Add scheduled backups and restore drill process.

## Phase 3: POS and Inventory Integrity
- [x] Block checkout when stock is insufficient.
- [x] Use centralized settings for tax and invoice prefix.
- [x] Add return/refund workflow with stock restoration and audit logs.
- [ ] Add exchange workflow and partial-item refund support.
- [ ] Add inventory cycle count with approval workflow.
- [ ] Add purchase receiving discrepancy handling.

## Phase 4: Accounting and Reporting
- [x] Persist store settings and manual expenses in backend.
- [ ] Add export endpoints (CSV/PDF) for financial reports.
- [ ] Add daily closing report and cashier shift reconciliation.
- [ ] Add tax summary by period and payment method.

## Phase 5: Quality, Deploy, and Operate
- [ ] Add unit tests for tax, totals, and stock logic.
- [ ] Add integration tests for core API flows.
- [ ] Add CI pipeline for lint/test/build gates.
- [ ] Add structured logging and error monitoring.
- [x] Add health/readiness endpoints with DB checks.
- [x] Return JSON for unknown API routes and add graceful shutdown handling.

## Suggested Immediate Next Sprint
1. Add secure user management with admin-controlled user CRUD and password rotation.
2. Add unit and integration tests, then wire them into CI.
3. Build export/reporting workflows for tax, sales, and cashier closeout.
4. Add structured logging, backup automation, and deployment-specific CORS/CSP.
