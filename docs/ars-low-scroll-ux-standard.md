# ARS interface standard — desktop-first, low-scroll workflows

This applies to every new ARS screen and future redesign.

## Design rules

1. **Primary action visible:** On typical Windows laptop resolutions (1366×768 and 1920×1080), keep the most important Save, Receive, Confirm, or Print action reachable without scrolling the entire application. For long editors, use a bounded modal/drawer with a fixed title and action row.
2. **Primary inputs first:** Show the registered customer shop and selected Sales Representative immediately on billing. Never bury the required selections behind expandable sections. A sale cannot proceed without both.
3. **Disclose secondary information:** Put read-only contact details, historical transactions, optional delivery notes, additional settings, and explanations inside meaningful expandable sections. Keep validation errors and credit warnings visible.
4. **One scroll area per workspace:** Prefer a single bounded content region. Avoid deeply nested independently scrolling panels; lengthy item tables may use their own scroll region if the totals and confirmation remain visible.
5. **Responsive layout:** Use a two-column desktop sales workspace with product search and checkout side by side. On small screens show a clear Product / Cart switch, preserving the required billing fields.
6. **Accessible controls:** Text labels, keyboard focus, native disclosure controls and searchable selection where appropriate. Do not solve density by making text unreadably small or reducing target sizes.
7. **No hidden consequences:** Security confirmations, draft vs final status, payment amount, credit-risk warnings and irreversible stock changes must remain understandable without opening optional sections.
8. **Protect operating data:** Interface work must not change pricing, stock calculations, invoice snapshots or accounting access controls.

## Implemented in first pass

- ARS New Sales: compact customer and rep selection, optional customer details/credit history, independent desktop cart area and prominent checkout controls.
- Optional wholesale dispatch fields: expandable instead of permanently filling the checkout screen.
- Quotation creation: bounded modal, independently scrollable form, persistent save/cancel area and visible total.

## Verification still required

- Real Chrome and Edge screenshots at 1366×768 / 1920×1080 and Windows display scaling 125–150%.
- Verify keyboard tab order and that the selected customer, representative and checkout action remain readable.
- Confirm mobile layouts do not cut off dialogs; test with long product names and at least 30 cart items.
- Review purchasing, warehouse receiving, partners, reports and settings with the same rules; they have not all been redesigned.
- Run real Windows printing with two or more A4 invoice pages.

No deployment or production database changes are authorized by this document.
