# ARS Distributor — V1.0 shop-opening acceptance

RS Nextward | Internal technical acceptance record

This checklist is an acceptance gate, not evidence that the checks have already passed. Record the exact commit, date, tester, device, result and redacted evidence for every item. Do not mark a check passed until observed. Run destructive or synthetic financial tests only on a disposable test database.

| Gate | Required evidence | Status |
| --- | --- | --- |
| Release identity | Exact commit and successful full CI for that commit | Pending final release |
| Linux Mint | Fresh test installation, desktop shortcut, login, reboot and automatic startup | Pending physical test |
| Windows | Fresh test installation, launcher, login, reboot and local database persistence | Pending physical test |
| Billing | Box/Piece mixed sale, price override, insufficient stock rejection before checkout, quotation conversion, credit sale | Pending operator test |
| A4 printing | Physical single and multipage print, ARS logo, product code, description, U/M, quantities, rate, amount, sales representative, RS Nextward footer | Pending printer test |
| Purchasing | PO, import shipment, receiving, landed costs, supplier payment and reconciliation | Pending operator test |
| Accounts | Customer statements, partial payments, returns, cash shift, partner capital and profit allocation; compare reports to ledger | Pending owner/accountant review |
| Dependency security | Zero reported vulnerabilities in production and full npm audit for the exact release commit | Passed on 9a0e8ad (#2777); recheck release commit |
| Security | First admin setup, unique credentials, role restrictions, password recovery with configured sender | Pending configured test |
| Local recovery | Verified backup and isolated restore, compare records and uploaded files | Pending physical test |
| Encrypted Drive | Owner-authorized remote, successful encrypted upload, download and isolated restore; separately held recovery keys | Pending configured test |
| Opening balances | Owner-approved cutover date, opening stock, customer/supplier balances and capital reconciled before entry | Pending owner approval |
| Live update | Continuous database writer exclusion, controlled startup and failed-start rollback | NOT APPROVED; keep disabled |


## Operator acceptance procedure

Use a separate test installation and synthetic customer, product and supplier records. Do not run this procedure on the live business database.

| Test | Expected result | Observed result / evidence |
| --- | --- | --- |
| Open desktop shortcut after reboot | Login opens; existing test records remain | |
| Product with 12 pieces per box and 15 pieces available | One box and three pieces can be billed; another piece cannot be added | |
| Custom price with required reason | Correct saved price and audit evidence | |
| Quotation conversion | Original quantities and rates preserved; no duplicate invoice | |
| Credit invoice and partial receipt | Customer outstanding and ledger reconcile | |
| A4 single and multipage invoice | Legible columns, correct totals, approved ARS and RS Nextward artwork | |
| PDF and Excel export | Both logos, totals and page/worksheet layout checked in actual viewer | |
| Password recovery | Owner-configured sender delivers usable single-use reset link/code | |
| Backup with uploaded product image | Encrypted Drive copy downloads and restores to isolated database; image and records match | |

### Evidence log

Record one row per attempt. Never include passwords, recovery keys, customer personal details or unredacted environment files.

| Date | Exact commit | Device / OS | Test | Pass / fail | Redacted evidence reference | Tester |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

### Before entering real opening balances

Confirm the owner has approved the cutover date, stock by base unit, receivables, payables, bank and cash balances, and each partner's capital. Reconcile totals with supporting records; retain a verified backup. Do not enter guessed balances.

### Automated evidence baseline

Workflow #2782 at commit `0fd3d2aebc295712fac82f11e54d136973b1d355` passed all seven jobs, including 422 regression tests, four PDF tests and one quotation branding test. This is historical evidence only; rerun CI for the eventual release commit.

## Release gate

Do not deploy, merge for production activation, activate a selected candidate, or import real opening balances based solely on CI. Obtain explicit owner approval after required core gates pass. Automatic live switching may remain disabled for a supervised V1.0 release only if the owner approves that limitation. Retain all original data, backup evidence and recovery records. Never include secrets or personal customer details in acceptance evidence.

Record outstanding issues with severity, reproduction steps, expected result, actual result and exact commit. Fix blockers and repeat affected tests before sign-off.

Owner approval: ____________________

Operator acceptance: ____________________

RS Nextward technical verification: ____________________

Date / exact release commit: ____________________
