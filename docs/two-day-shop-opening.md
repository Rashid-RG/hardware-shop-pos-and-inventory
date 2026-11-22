# Hardware POS opening plan for November 23–24, 2026

Target a supervised first shift on one Windows till. The shop owner decides whether to open after the rehearsal. Use a separate rehearsal database and the same launcher, printer, paper, scanner and user roles planned for the shop.

| When | Work | Acceptance |
|---|---|---|
| Nov 23 morning | Count the first products to sell. Record each unit, size, barcode, cost and selling price. Enter supplier balances, customer credit and opening cash only after the owner confirms the figures. | Check a sample against physical stock and the price list. Confirm whether any items sell in fractional metres or kilograms and rehearse those before using them. |
| Nov 23 afternoon | Rehearse purchase receiving, checkout, discount, refund, customer credit and shift closing. Check both sizes of a product and retry receiving the same order. Compare a quote and a cash invoice with the same prices and discounts. | Cash, change, credit balance, variant counts and sales reports match the expected figures. Verify the chosen pricing tier for wholesale sales before using it. |
| Nov 24 before opening | Use the shop PC. Print a real receipt, scan a real barcode, restart Windows, sign in again and check yesterday’s records. Back up the intended shop database and restore into a separate database. Compare invoice count, latest invoice, stock quantities and account balances. | Owner can complete the sequence unaided. Confirm the backup targets the real database. The supplied Windows backup command targets the Docker container hardware-pos-postgres and database hardware_pos. |
| First shift | Start with one cashier on one till. Keep the existing billing method available. Record the opening float and reconcile cash, refunds and credit at closing. | Owner signs off on physical cash and the day’s totals. If totals, printing, saved records or recovery fail, continue with existing billing while the fault is corrected. |

## Development priorities

1. Complete first-shift controls on the Windows entry point in server.ts. First changes cover receiving by variant and quotation/register totals. For old orders without a variant, a multi-size product needs a replacement order with the correct size. An already-received order can be acknowledged again without adding stock.
2. Verify cashier and manager permissions, drawer opening and closing, credit collection, pricing tiers and quotation conversion for variant products. Qualify fractional units against database quantity types if required by the shop.
3. Test concurrent writes and recovery after a failed save before adding tills. The Windows server keeps state in memory and rewrites normalized tables on save. Verify concurrent checkout and interrupted writes separately.
4. After the first shift reconciles, schedule remaining reports, convenience features and visual improvements with the owner.

The pilot retains checkout’s existing calculation order. Line discounts reduce the taxable subtotal and the invoice-wide discount reduces the final amount. Confirm the company’s accounting policy and configured tax rate during setup.
