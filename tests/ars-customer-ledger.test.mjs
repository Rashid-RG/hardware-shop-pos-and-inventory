import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerLedger, filterCustomerLedger } from '../src/utils/customerLedger.ts';

const customer = { id:'c1', shopId:'s1', name:'Shop 1', phone:'', email:'', address:'', loyaltyBalance:0, purchaseCount:2, creditBalance:400 };
const invoice = (id, total, date, other={}) => ({ id, shopId:'s1', customerId:'c1', invoiceNumber:id, date, total, paymentMethod:'Credit Account', status:'Completed', items:[], ...other });
const payment = (id, amount, date) => ({ id, shopId:'s1', customerId:'c1', customerName:'Shop 1', amount, date, paymentMethod:'Cash' });

test('ledger includes credit sales, repayments and dated refund reversals', () => {
  const ledger=buildCustomerLedger(customer, [
    invoice('A',1000,'2026-10-01'),
    invoice('B',300,'2026-10-03',{status:'Refunded',refundedAt:'2026-10-06'}),
    invoice('cash',500,'2026-10-04',{paymentMethod:'Cash'}),
  ],[payment('p1',600,'2026-10-05')]);
  assert.deepEqual(ledger.entries.map(x=>x.kind),['Credit invoice','Credit invoice','Credit repayment','Credit refund']);
  assert.deepEqual(ledger.entries.map(x=>x.balance),[1000,1300,700,400]);
  assert.equal(ledger.closingBalance,400);
  assert.equal(ledger.openingBalance,0);
  assert.equal(ledger.hasOpeningDifference,false);
});

test('unexplained historical opening differences are clearly flagged',()=>{
  const ledger=buildCustomerLedger({...customer,creditBalance:900},[invoice('A',1000,'2026-10-01')],[payment('p1',600,'2026-10-05')]);
  assert.equal(ledger.openingBalance,500);
  assert.equal(ledger.hasOpeningDifference,true);
  assert.equal(ledger.entries.at(-1).balance,900);
});

test('filters keep actual running balance rather than invent filtered closing balance',()=>{
  const ledger=buildCustomerLedger(customer,[invoice('A',1000,'2026-10-01')],[payment('p1',600,'2026-10-05')]);
  const filtered=filterCustomerLedger(ledger,{kind:'Credit repayment',from:'2026-10-02'});
  assert.equal(filtered.entries.length,1);
  assert.equal(filtered.entries[0].balance,400);
  assert.equal(filtered.filteredDebit,0);
  assert.equal(filtered.filteredCredit,600);
  assert.equal(filtered.isFiltered,true);
});

test('cross-shop records cannot enter the credit ledger',()=>{
  const ledger=buildCustomerLedger(customer,[invoice('A',1000,'2026-10-01',{shopId:'another'})],[{...payment('p1',600,'2026-10-05'),shopId:'another'}]);
  assert.equal(ledger.entries.length,0);
  assert.equal(ledger.openingBalance,400);
});

test('undated refunds cannot falsely claim a dated financial history',()=>{
  assert.throws(()=>buildCustomerLedger(customer,[invoice('A',1000,'2026-10-01',{status:'Refunded'})],[]),/Refund date missing/);
});
