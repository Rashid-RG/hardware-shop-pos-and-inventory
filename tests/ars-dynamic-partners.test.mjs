import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const ledger=readFileSync(new URL('../backend/partnerProfit.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/components/PartnerCapitalView.tsx',import.meta.url),'utf8');

test('ARS partner registration does not enforce a fixed maximum',()=>{
  assert.doesNotMatch(server,/ARS has a maximum of three partners/);
  assert.doesNotMatch(server,/partners.rowCount>=3/);
  assert.doesNotMatch(ledger,/Exactly three registered partners are required/);
  assert.match(ledger,/At least one active partner is required for allocation/);
  assert.match(ledger,/AND is_active=TRUE ORDER BY id FOR UPDATE/);
  assert.match(ui,/Partners \(\{activePartners.length\} active/);
  assert.doesNotMatch(ui,/partners.length<3/);
  assert.doesNotMatch(ui,/partners.length!==3/);
  assert.match(ui,/!allocationReady/);
});

test('additive partner status and ownership audit prevent historical financial loss',()=>{
  assert.match(server,/ALTER TABLE ars_business_partners ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(server,/CREATE TABLE IF NOT EXISTS ars_partner_ownership_audit/);
  assert.match(server,/change_type TEXT NOT NULL CHECK/);
  assert.match(server,/api\/ars\/partners\/\:id\/status',requireRole\(\['Super Admin'\]\)/);
  assert.match(server,/Set this partner ownership to 0% or unassigned before deactivating/);
  assert.match(server,/api\/ars\/partner-ownership-audit',requireRole\(\['Super Admin'\]\)/);
  assert.match(ui,/Ownership and partner status history/);
  assert.match(ui,/Existing capital and approved allocations will remain permanently recorded/);
  assert.doesNotMatch(server,/DELETE FROM ars_business_partners/);
});

test('approved distributions snapshot original percentages and precise amounts',()=>{
  assert.match(ledger,/ownership_basis_points INTEGER NOT NULL/);
  assert.match(ledger,/allocated_lkr NUMERIC\(16,2\) NOT NULL/);
  assert.match(ledger,/if\(basisPoints.reduce\(\(sum,n\)=>sum\+n,0\)!==10000\)/);
  assert.match(ledger,/whole\[ranking\[i\]\.i\]\+\+/);
  assert.match(ledger,/SELECT id FROM ars_partner_profit_allocations WHERE shop_id=\$1 AND period_key=\$2/);
  assert.match(ui,/Historical allocations keep the percentages used at approval time/);
});
