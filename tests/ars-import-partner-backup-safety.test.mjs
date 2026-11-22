import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const backup=readFileSync(new URL('../scripts/backup-local-postgres.ps1',import.meta.url),'utf8');
const restore=readFileSync(new URL('../scripts/restore-local-postgres-test.ps1',import.meta.url),'utf8');
const sidebar=readFileSync(new URL('../src/components/Sidebar.tsx',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');

test('backup uses the active configured database, not a default demo database',()=>{
  assert.match(backup,/DATABASE_URL/);
  assert.match(backup,/\$Database = \$configuredDb/);
  assert.match(backup,/\$Database -cne \$configuredDb/);
  assert.match(backup,/pg_dump -U \$DbUser -d \$Database -Fc/);
  assert.match(backup,/pg_restore --list/);
  assert.match(backup,/SHA256/);
  assert.match(backup,/docker port \$Container/);
});
test('restore refuses operational database and validates archive integrity',()=>{
  assert.match(restore,/\$TargetDatabase -eq \$activeDb/);
  assert.match(restore,/ars_restore_test_/);
  assert.match(restore,/Target database already exists/);
  assert.match(restore,/Get-FileHash/);
  assert.match(restore,/Checksum mismatch/);
  assert.match(restore,/pg_restore -U \$DbUser --no-owner --no-acl --exit-on-error/);
  assert.doesNotMatch(restore,/DROP DATABASE|dropdb|--clean|--create/);
});
test('backup recovery and company profile are separate restricted business workspaces',()=>{
  assert.match(sidebar,/id: 'backup-recovery', label: 'Backup & Recovery'.*Super Admin/);
  assert.match(sidebar,/id: 'company-profile', label: 'Company Profile'/);
  assert.match(app,/<BackupRecoveryView/);
  assert.match(app,/<PartnerCapitalView/);
  assert.match(app,/<ImportShipmentView/);
});
test('partner and import modules use isolated PostgreSQL tables, not whole-db overwrite',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS ars_import_shipments/);
  assert.match(server,/CREATE TABLE IF NOT EXISTS ars_business_partners/);
  assert.match(server,/CREATE TABLE IF NOT EXISTS ars_partner_capital_entries/);
  assert.match(server,/api\/ars\/import-shipments\/\:id\/receive/);
  assert.match(server,/receivePurchaseOrder\(shipment.rows\[0\].purchase_order_id/);
  assert.match(server,/api\/ars\/partner-capital',requireRole\(\['Super Admin'\]\)/);
});
