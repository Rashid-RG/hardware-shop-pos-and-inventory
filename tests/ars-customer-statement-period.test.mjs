import test from 'node:test';
import assert from 'node:assert/strict';
import {customerStatementPeriod} from '../src/utils/customerLedger.ts';
test('period balances include every movement and preserve historical differences',()=>{
 const ledger={openingBalance:100,closingBalance:140,recordedChange:40,hasOpeningDifference:true,entries:[{date:'2026-10-31',debit:50,credit:0},{date:'2026-11-01',debit:20,credit:0},{date:'2026-11-30',debit:0,credit:10},{date:'2026-12-01',debit:0,credit:20}]};
 assert.deepEqual(customerStatementPeriod(ledger,'2026-11-01','2026-11-30'),{opening:150,debit:20,credit:10,closing:160,hasOpeningDifference:true});
 assert.equal(customerStatementPeriod(ledger).closing,140);
 assert.equal(customerStatementPeriod(ledger,'2026-09-01','2026-09-30').closing,100);
 assert.throws(()=>customerStatementPeriod(ledger,'2026-11-30','2026-11-01'),/valid statement/);
 assert.throws(()=>customerStatementPeriod(ledger,'2026-02-30'),/valid statement/);
});
