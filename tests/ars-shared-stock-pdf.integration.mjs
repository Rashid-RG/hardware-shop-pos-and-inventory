import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {renderArsInvoicePdf} from '../src/utils/arsInvoicePdf.ts';

test('A4 invoice preserves saved packaging labels, quantities and historical rates',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ars-invoice-ci-'));
 try{
  const tx={id:'ci-invoice',invoiceNumber:'CI-UM-001',date:'2026-11-24T08:00:00Z',customerName:'CI Trade Customer',cashierName:'CI Cashier',paymentMethod:'Cash',paymentStatus:'PAID',cashReceived:12800,subtotal:12800,total:12800,tax:0,discountAmount:0,items:[
   {productId:'LOCK-01',productName:'Door Lock',sellingUnitId:'box',sellingUnitLabel:'Box',variantUnit:'Piece',baseUnitsPerSaleUnit:12,quantity:2,sellingPrice:5400,costPrice:3600,discount:0},
   {productId:'LOCK-01',productName:'Door Lock',sellingUnitId:'piece',sellingUnitLabel:'Piece',baseUnitsPerSaleUnit:1,quantity:4,sellingPrice:500,costPrice:300,discount:0}
  ]};
  const pdf=await renderArsInvoicePdf(tx,'ARS Distributor',{copyType:'Original',printSequence:1,watermarkText:''},null);
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const file=join(dir,'invoice.pdf');await writeFile(file,pdf);
  const info=execFileSync('pdfinfo',[file],{encoding:'utf8'});
  assert.match(info,/Pages:\s+1\b/);
  assert.match(info,/Page size:\s+595(?:\.\d+)? x 841(?:\.\d+)? pts \(A4\)/);
  const content=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
  assert.match(content,/CI-UM-001/);
  assert.match(content,/U\/M/);
  assert.match(content,/Box\s+2\s+Rs\.\s*5,400\.00/);
  assert.match(content,/Piece\s+4\s+Rs\.\s*500\.00/);
  assert.match(content,/12,800\.00/);
  assert.doesNotMatch(content,/CI Cashier|Sales By/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
