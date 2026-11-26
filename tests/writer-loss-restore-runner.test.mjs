import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptFromReport,runIncidentRestore} from '../scripts/writer-loss-restore-runner.mjs';
const backup={state:'archive-integrity-matched',archive:'ars-test.dump',archiveSha256:'a'.repeat(64),incidentDigest:'b'.repeat(64),uploadsIncluded:false};
const report={backup:backup.archive,sha256:backup.archiveSha256,restoreTestPassed:true,liveRestoreApproved:false,isolation:'separate-postgres-instance',liveVolumeMounted:false,publishedPort:false,testedAt:'2026-01-01T00:00:00Z',counts:Object.fromEntries(['products','customers','sales_transactions','sales_transaction_items','purchase_orders','purchase_order_items','supplier_payments','customer_credit_payments'].map(k=>[k,1])),uploadArchiveChecked:false};
test('runner receipt requires completed isolated restore report',async()=>{
 assert.equal(receiptFromReport(report,backup).startupAllowed,false);
 for(const change of [{sha256:'c'.repeat(64)},{restoreTestPassed:false},{liveVolumeMounted:true},{counts:{}}])assert.throws(()=>receiptFromReport({...report,...change},backup));
 await assert.rejects(runIncidentRestore('/invalid',''),/confirmation required/);
});
