# Warehouse receiving rollout – ARS

The warehouse receiving screen now opens a Goods Received Note (GRN) quantity dialog per shipment. Staff enter only inspected and accepted units. The panel loads ordered, previously received, and remaining quantities, plus receipt batch history.

All stock writes use the targeted `POST /api/ars/purchases/:id/receipts` endpoint with a request key. This key is preserved on failed HTTP/network responses so retrying cannot silently double count the same batch. Receipts are immutable; inventory adjustments and discrepancy processing need a separately audited workflow.

The historical purchase-status action and historical shipment all-at-once receiving endpoint no longer post stock. The purchase order screen directs staff to Warehouse Receiving.

## Mandatory checks before Windows production use

- Compile with `npm run lint` and `npm run build`, fix any type/build errors.
- Run against a disposable test PostgreSQL database only. Verify PO creation, shipment registration, 20/100 receipt, 30/100 receipt, 50/100 final receipt, repeat request-key and over-receipt rejection.
- Verify product variants, multiple PO lines, duplicate PO lines, empty or negative quantity, and concurrent requests.
- Confirm no other action fails unexpectedly after a partial GRN due to the legacy full-state rewrite safeguard.
- Migrate legacy snapshot writers to targeted transactions. The safety guard intentionally blocks whole-state rewrites after a GRN exists.
- Test separately scoped branch access, permissions, purchasing dashboard status, printer delivery documentation, and receipt history on Windows.
- Test complete restore of database plus uploaded logo/images in an isolated environment, including stock-to-GRN reconciliation.
- Add a formal damaged/missing goods discrepancy workflow and shipping expense allocation before signing off.

This feature is **committed but not validated on Windows or PostgreSQL**. No deployment, installation, production migration, or real business data change has been made.
