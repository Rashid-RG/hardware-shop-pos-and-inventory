import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const center=read('src/components/NotificationCenter.tsx');
const bus=read('src/utils/notifications.ts');
const app=read('src/App.tsx');
test('ARS central notifications are accessible, nonblocking and dismissible',()=>{
  assert.match(center,/pointer-events-none fixed right-3 top-3/);
  assert.match(center,/role=\{notice.level === 'error' \? 'alert' : 'status'\}/);
  assert.match(center,/setNotices\(current => current.filter\(item => item.id !== notice.id\)\)/);
  assert.match(center,/notice.level !== 'error'/);
  assert.match(bus,/subscribeNotifications/);
  assert.match(bus,/notify.success/);
  assert.match(bus,/notify.error/);
  assert.match(app,/<NotificationCenter \/>/);
});
test('primary ARS workflows use shared notifications instead of blocking alert',()=>{
  for(const path of ['POSView','CustomerEmployeeView','InventoryView','SupplierPurchaseView','ProductManagementView','QuotationView','CashDrawerView','AccountingSettingsView']){
    const source=read('src/components/'+path+'.tsx');
    assert.match(source,/import \{ notify \} from '\.\.\/utils\/notifications';/);
    assert.doesNotMatch(source,/\balert\(/);
  }
});
test('ARS checkout emphasizes workflow steps and real saved-invoice success',()=>{
  const source=read('src/components/POSView.tsx');
  assert.match(source,/1 · Customer shop/);
  assert.match(source,/2 · Sales Representative/);
  assert.match(source,/Save Invoice & Print A4/);
  assert.match(source,/notify.success\(`Invoice \$\{completedTx.invoiceNumber\} saved/);
});
