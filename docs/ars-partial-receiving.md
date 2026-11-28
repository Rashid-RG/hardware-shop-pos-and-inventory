# ARS partial warehouse receiving (development)

**Status:** API implementation committed, not yet tested against a disposable PostgreSQL database or the Windows laptop.

## Receiving workflow

1. Create an ordinary purchase order with product lines.
2. Optionally attach an ARS China import shipment record.
3. Read `GET /api/ars/purchases/:id/receipts` using an authorized shop session. Each line includes `purchaseOrderItemId`, `ordered`, `received`, and `remaining`.
4. Receive some or all lines using `POST /api/ars/purchases/:id/receipts`:

```json
{
  "requestKey": "unique-key-for-this-warehouse-receipt",
  "note": "Container unloading batch one",
  "items": [
    { "purchaseOrderItemId": 123, "quantity": 20 }
  ]
}
```

The `requestKey` must be reused on retries of **the same receipt**. A new delivery needs a different key. The backend locks the purchase order, validates remaining quantities, updates stock and variant stock where applicable, logs each movement, stores an immutable receipt batch and sets the order to `Partially Received` or `Received` in one transaction. Repeated keys return the previous receipt without adding stock again.

Only Super Admin, Store Manager and Inventory Staff may post receipts. Shop scope is enforced on the order and product reads.

## Safety restrictions

- Never receive more than the ordered quantity.
- No receipt edits or deletes; inventory corrections need a distinct audited adjustment workflow.
- Once partially received, an order cannot be cancelled or passed through the legacy full-order receipt.
- The legacy full-state rewrite path is intentionally blocked once a receipt batch exists, because that path truncates purchase-order tables with cascading deletes. Its other features must be migrated to targeted SQL before live ARS use.
- This API does not yet provide the final shipment unloading UI, discrepancy/shortage workflow, landed-cost allocation, or actual physical warehouse-location movements.

## Required verification before release

- Run application build and type checks.
- Test first partial receipt, second receipt, exact completion, over-receipt rejection, duplicate request-key retry, rollback on failure and tenant isolation against a disposable PostgreSQL database.
- Verify legacy full-receive and status endpoints cannot duplicate inventory after a partial receipt.
- Test normal POS and settings operations after a receipt to find legacy full-state writers and migrate them off the destructive path.
- Test full backup and restoration and reconcile stock quantities against receipt batches.

**No production deployment, live database migration or installation is authorized by this document.**
