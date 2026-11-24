import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/utils/arsPaymentReceiptPdf.ts',import.meta.url),'utf8');
test('receipt uses the approved ARS vector logo in black and recorded historical amounts',()=>{
 assert.match(source,/arsPrintLogoPath/);
 assert.match(source,/\.path\(arsPrintLogoPath\)\.fill\('#000000','even-odd'\)/);
 assert.match(source,/snapshot\.previousPayments/);
 assert.match(source,/snapshot\.balanceAfter/);
 assert.match(source,/invoiceFooter\.credit/);
 assert.match(source,/Historical balance at collection was not recorded/);
});
