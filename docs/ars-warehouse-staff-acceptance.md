# ARS warehouse receiving — Windows staff acceptance checklist

**Environment:** existing ARS development/staging sample database only. Never create test receipts in production.

1. Sign in as Inventory Staff and open **Warehouse Receiving**. Confirm there is a dedicated module, separate from shipments and supplier purchasing.
2. Search shipment references, PO numbers, suppliers and container numbers. Every matching shipment must appear, not just the first 12.
3. Filter by status **All statuses, including received**. Previously received shipments must remain readable but must not have a new **Receive quantities** action.
4. Test ETA from/to filters, no matches and **Clear filters**.
5. Open a pending shipment's **Receive quantities** window. Check product names, ordered, received and remaining quantities.
6. Search a product by name or ID. Confirm all matching PO items are shown.
7. Select **Remaining only** and verify completed lines are hidden without deleting or altering their values.
8. Enter a partial quantity for one line and submit only after checking the confirmation dialog. Verify the remaining quantity and stock ledger were updated once.
9. Use **Fill all outstanding quantities** only on a controlled test delivery. Confirm it fills a draft, never posts without explicit confirmation; verify **Clear quantities** resets the draft.
10. Test a quantity greater than remaining, a negative number and a decimal number. They must be rejected, and no stock should post.
11. Simulate a failed network response or retry with the same receipt request key; the system must not double-post inventory.
12. Review complete previous receiving batches, responsible staff and notes. Record discrepancies in the receiving note.
13. Resize to a 1366×768 Windows laptop display; verify form, search, confirmation and close controls remain reachable.
14. Confirm permissions: cashier cannot post warehouse stock; authorized inventory staff can.
15. Cross-shop isolation: no receipts or shipment history from another shop may appear.

Staff name: __________  Date: __________  Pass count: ___ / 15
Screenshots/issues: ___________________________________
Manager sign-off: _____________________________________

**Release gate:** CI tests alone do not verify actual Windows usability, printer setup, or physical goods handling. Complete staff acceptance before entering real shipment receipts.
