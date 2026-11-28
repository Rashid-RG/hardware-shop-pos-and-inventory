# ARS customer accounts — Windows staff on-screen acceptance

**Target:** existing local/staging ARS test database only. Never use live customer records for this checklist. Do not deploy from this document.

## Setup
- Sign in as Store Manager using a test-only account.
- Confirm the correct ARS shop is selected. Create two sample customer shops (Shop A and Shop B).
- Register test hardware products and check the A4 invoice profile.
- Record the expected start and end credit balances on paper.

## Guided steps (record pass/fail, screenshot, and staff feedback)

| # | Staff action | Expected behavior |
|---|---|---|
| 1 | Open **Customers** from the sidebar | Dedicated customer directory opens, separate from Staff |
| 2 | Search Shop A by name, phone, ID, email and address; use Outstanding filter | All matching records appear, not only the first page |
| 3 | Open Shop A's file | Contact details, outstanding balance, invoices and payments appear |
| 4 | Open **Customer credit account statement** | Opening difference, debits, credits, running balance and stored outstanding are clearly labeled |
| 5 | Create a **credit account** invoice for Rs. 1,000 for Shop A | Debt increases by Rs. 1,000; invoice line appears as debit |
| 6 | Create a **cash** invoice for Rs. 500 for Shop A | Invoice appears in sales history; debt does **not** increase |
| 7 | Record a Rs. 300 **credit repayment** against Shop A | Debt decreases by Rs. 300; repayment appears as credit |
| 8 | Filter credit statement by date, record type, and reference | Every matching movement remains visible; running balances remain from full history |
| 9 | Export filtered account statement to CSV and open in Excel | All matching records, debit, credit, full-ledger running balances, and any opening difference are displayed |
| 10 | Open **Customer reports**, filter by date and activity | Complete matching shops are visible; dated sales/repayments separate from today's outstanding |
| 11 | Export customer report to CSV | Export rows match visible filters; refund totals are not included in net sales |
| 12 | From the customer history, select a saved invoice | Complete item list, descriptions, discounts, tax, and total appear |
| 13 | Open Shop B and repeat key filters | Shop A's activity never appears under Shop B |
| 14 | Sign in as Cashier | Customer-contact editing is not available; manager-only actions remain protected |
| 15 | Test an allowed credit invoice refund while the full amount is still outstanding | The original debit remains and a dated refund credit appears; balance decreases |
| 16 | Test missing historical records / imported data | Unexplained opening differences are explicitly flagged; not disguised as zero |
| 17 | Try the customer screen at 1366×768 and a narrower laptop window | Labels remain readable; filters and close buttons reachable without overlay issues |

## Acceptance record
- Staff member: ___________
- Device/browser: ___________
- Date/time: ___________
- Steps passed: ____ / 17
- Issues/screenshots: ___________
- Manager sign-off: ___________

## Important accounting boundaries
- Current outstanding is the authoritative stored credit balance; report date filters do not make it a historical as-of-date balance.
- Credit statement displays known credit invoices, dated repayments, and dated credit refunds. A nonzero opening difference means the available transaction history alone cannot justify today's balance.
- A customer account is not financially verified merely because the page loads or the calculated closing balance matches after inserting an opening difference.
- Staff should not treat this as an audited accounting ledger until the complete live-history and refund/credit-payment workflows have been verified.
