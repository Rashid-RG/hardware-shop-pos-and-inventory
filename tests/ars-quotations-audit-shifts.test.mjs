import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const db=readFileSync(new URL('../backend/db.ts',import.meta.url),'utf8');
const quotes=server.split("app.post('/api/quotations'")[1]?.split('// ── Cash Shift Routes')[0]||'';
const shift=server.split("app.post('/api/shifts/open'")[1]?.split('// ── Reports Route')[0]||'';
const prints=server.split("app.post('/api/transactions/:id/print'")[1]?.split("app.get('/api/transactions/:id/print-logs'")[0]||'';
const shares=server.split("app.post('/api/transactions/:id/share/email'")[1]?.split("app.get('/api/invoice-print-audit'")[0]||'';
const checkout=db.split('export const checkoutTransaction = ')[1]?.split('export const refundTransaction = ')[0]||'';

test('quotation creation and status updates never rewrite other tables',()=>{
  assert.match(quotes,/INSERT INTO quotations/);
  assert.match(quotes,/UPDATE quotations SET status/);
  assert.match(quotes,/DELETE FROM quotations WHERE/);
  assert.doesNotMatch(quotes,/await saveDb\(\)/);
});
test('quote conversion locks accepted quote and commits conversion with checkout stock changes',()=>{
  assert.match(quotes,/await checkoutTransaction\(tx,auth\?\.role\|\|'Cashier',activeShopName,q\.id\)/);
  assert.match(checkout,/FROM quotations WHERE id=\$1 AND shop_id=\$2 FOR UPDATE/);
  assert.match(checkout,/valid_until < \(NOW\(\) AT TIME ZONE 'Asia\/Colombo'\)::date AS is_expired/);
  assert.match(checkout,/saved\.status!=='Accepted'/);
  assert.match(checkout,/UPDATE quotations SET status='Converted'/);
  assert.match(checkout,/await client\.query\('COMMIT'\)/);
  assert.match(checkout,/await client\.query\('ROLLBACK'\)/);
});
test('quotation conversion refuses variants until explicit variant mapping exists',()=>{
  assert.match(quotes,/product\.variants\?\.length/);
  assert.match(quotes,/Select a registered wholesale customer shop/);
});
test('cash drawer shifts use scoped SQL and transaction-level locks',()=>{
  assert.match(shift,/pg_advisory_xact_lock/);
  assert.match(shift,/INSERT INTO cash_shifts/);
  assert.match(shift,/UPDATE cash_shifts SET/);
  assert.match(shift,/FROM sales_transactions/);
  assert.match(shift,/WHERE id=\$1 AND shop_id=\$2 FOR UPDATE/);
  assert.doesNotMatch(shift,/await saveDb\(\)/);
});
test('invoice print logs use row lock to serialize print sequence',()=>{
  assert.match(prints,/SELECT invoice_number FROM sales_transactions WHERE id=\$1 AND shop_id=\$2 FOR UPDATE/);
  assert.match(prints,/MAX\(print_sequence\)/);
  assert.match(prints,/INSERT INTO invoice_print_logs/);
  assert.match(prints,/INSERT INTO activity_logs/);
  assert.doesNotMatch(prints,/await saveDb\(\)/);
});
test('email and WhatsApp share audit no longer rewrite business data',()=>{
  assert.match(shares,/recordInvoiceShareAudit/);
  assert.doesNotMatch(shares,/await saveDb\(\)/);
});
