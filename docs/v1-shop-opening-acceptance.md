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
| Security | First admin setup, unique credentials, role restrictions, password recovery with configured sender | Pending configured test |
| Local recovery | Verified backup and isolated restore, compare records and uploaded files | Pending physical test |
| Encrypted Drive | Owner-authorized remote, successful encrypted upload, download and isolated restore; separately held recovery keys | Pending configured test |
| Opening balances | Owner-approved cutover date, opening stock, customer/supplier balances and capital reconciled before entry | Pending owner approval |
| Live update | Continuous database writer exclusion, controlled startup and failed-start rollback | NOT APPROVED; keep disabled |

## Release gate

Do not deploy, merge for production activation, activate a selected candidate, or import real opening balances based solely on CI. Obtain explicit owner approval after required core gates pass. Automatic live switching may remain disabled for a supervised V1.0 release only if the owner approves that limitation. Retain all original data, backup evidence and recovery records. Never include secrets or personal customer details in acceptance evidence.

Record outstanding issues with severity, reproduction steps, expected result, actual result and exact commit. Fix blockers and repeat affected tests before sign-off.

Owner approval: ____________________

Operator acceptance: ____________________

RS Nextward technical verification: ____________________

Date / exact release commit: ____________________
