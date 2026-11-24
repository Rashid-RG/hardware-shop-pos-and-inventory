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

test('payment receipts print one A4 page with original collection balance and ARS branding',async()=>{
 const {renderArsPaymentReceiptPdf}=await import('../src/utils/arsPaymentReceiptPdf.ts');
 const dir=await mkdtemp(join(tmpdir(),'ars-payment-ci-'));
 try{
  const payment={id:'cpay-ci-0001',customerId:'ci-customer',customerName:'North Road Hardware',invoiceId:'ci-invoice',amount:20000,date:'2026-11-24',paymentMethod:'Cash',createdBy:'CI Manager',receiptSnapshot:{invoiceNumber:'ARS-INV-0001',invoiceTotal:50000,previousPayments:0,balanceAfter:30000}};
  for(const [name,record] of [['linked',payment],['historical',{...payment,receiptSnapshot:undefined}]]){
   const pdf=await renderArsPaymentReceiptPdf(record,'ARS Distributor',null,{address:'CI address',phone:'0700000000'});
   assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
   const file=join(dir,name+'.pdf');await writeFile(file,pdf);
   assert.match(execFileSync('pdfinfo',[file],{encoding:'utf8'}),/Pages:\s+1\b/);
   const body=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
   for(const label of ['ARS Distributor','PAYMENT RECEIPT','North Road Hardware','20,000.00','Powered by RS Nextward','cpay-ci-0001'])assert.ok(body.includes(label),label);
   if(name==='linked'){assert.match(body,/ARS-INV-0001/);assert.match(body,/50,000\.00/);assert.match(body,/30,000\.00/);}
   else{assert.match(body,/Historical balance at collection was not recorded/);assert.doesNotMatch(body,/30,000\.00/);}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
