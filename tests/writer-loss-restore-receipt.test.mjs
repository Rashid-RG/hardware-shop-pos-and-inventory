import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesRestoreReceipt} from '../scripts/writer-loss-restore-receipt.mjs';
const b={state:'archive-integrity-matched',incidentDigest:'a'.repeat(64),archiveSha256:'b'.repeat(64),archive:'ars-test-with-uploads.dump',uploadsIncluded:true};
const r={schema:1,incidentDigest:b.incidentDigest,archiveSha256:b.archiveSha256,archive:b.archive,isolation:'separate-postgres-instance',liveVolumeMounted:false,publishedPort:false,restoreReportedPassed:true,startupAllowed:false,testedAt:'2026-01-01T00:00:00Z',uploadArchiveChecked:true,tableCounts:Object.fromEntries(['products','customers','sales_transactions','sales_transaction_items','purchase_orders','purchase_order_items','supplier_payments','customer_credit_payments'].map(k=>[k,0]))};
test('restore receipt must match incident, archive, isolation and all required table checks',()=>{
 assert.equal(matchesRestoreReceipt(r,b),true);
 for(const change of [{incidentDigest:'c'.repeat(64)},{archiveSha256:'c'.repeat(64)},{publishedPort:true},{liveVolumeMounted:true},{uploadArchiveChecked:false},{startupAllowed:true},{tableCounts:{products:0}},{restoreReportedPassed:false}])assert.equal(matchesRestoreReceipt({...r,...change},b),false);
});
