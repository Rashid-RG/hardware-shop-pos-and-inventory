import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { renderArsInvoicePdf } from '../src/utils/arsInvoicePdf.ts';

// PDFKit uses standard Helvetica fonts and hexadecimal text runs for this invoice.
function pageTexts(pdf) {
  return Array.from(pdf.toString('latin1').matchAll(/\bstream\r?\n([\s\S]*?)\r?\nendstream/g), stream => {
    let instructions; try { instructions = inflateSync(Buffer.from(stream[1], 'latin1')).toString('latin1'); } catch { return null; }
    if(!/\bBT\b/.test(instructions)||! /\bTJ\b/.test(instructions))return null;
    return Array.from(instructions.matchAll(/\[([^\]]*)\]\s*TJ/g), row =>
      Array.from(row[1].matchAll(/<([\da-f]+)>/gi), run => Buffer.from(run[1], 'hex').toString('latin1')).join('')
    ).join(' ');
  }).filter(v=>v!==null);
}

for (const count of [4, 48]) {
  test('portrait invoice preserves layout and all saved rows for ' + count + ' items', async () => {
    const items = Array.from({ length: count }, (_, i) => ({
      productId: 'internal-id-' + (i + 100), variantSku: 'SKU-' + (i + 100), productName: 'Steel bolts',
      invoiceDescription: i % 2 ? 'Original box with the full saved description' : undefined,
      quantity: 1, sellingPrice: 100,
    }));
    const pdf = await renderArsInvoicePdf({
      items, invoiceNumber: 'ARS-TEST', date: '2026-11-24T08:00:00Z', customerName: 'Test buyer',
      salesRepName: 'Sales rep', paymentMethod: 'Cash', subtotal: count*100, total: count*100, cashReceived: count*100+500, changeDue: 500,
    }, 'ARS Hardware', { watermarkText:'SHOP STAMP / PAID / AUTHORIZED' }, null);
    assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
    const pages = pageTexts(pdf);
    if (count === 4) assert.equal(pages.length, 1);
    else assert.ok(pages.length > 1);
    pages.forEach((page, i) => {
      for (const label of ['ARS Distributor', 'CUSTOMER INVOICE', 'ARS-TEST', 'Test buyer', 'Sales rep',
        'Powered by RS Nextward', 'Page ' + (i+1) + ' of ' + pages.length]) assert.ok(page.includes(label), label);
      for (const label of ['Prepared By', 'Received By', 'Authorized By']) {
        assert.equal(page.includes(label), i === pages.length-1, label);
      }
      assert.doesNotMatch(page, /SHOP STAMP|Cash Received|Change Due|Amount Paid|Balance Due/);
    });
    const printed = pages.join(' ').replace(/\s+/g, ' ');
    assert.deepEqual(printed.match(/SKU-\d+/g), items.map(item => item.variantSku));
    assert.equal(printed.match(/Original box with the full saved description/g)?.length, count / 2);
    assert.doesNotMatch(printed, /internal-id-/);
  });
}

test('four saved packaging units print beside quantity on one portrait page', async () => {
  const items = [
    { productName: 'Floor tiles · Box of 4 tiles', invoiceDescription: '' },
    { productName: 'Door hinges', invoiceDescription: 'Pair' },
    { productName: 'Cutting discs', invoiceDescription: 'Pack of 10' },
    { productName: 'Bolts', invoiceDescription: 'Pack of 10', variantUnit: 'Case' },
  ].map((item, i) => ({ ...item, productId: String(i), sellingPrice: 10, quantity: 1 }));
  const pdf = await renderArsInvoicePdf({
    items, invoiceNumber: 'UNIT-TEST', date: '2026-11-24', subtotal: 40, total: 40,
  }, 'ARS Hardware', {}, null);
  const pages = pageTexts(pdf);
  assert.equal(pages.length, 1);
  assert.match(pages[0], /U\/M Qty/);
  for (const unit of ['Box', 'Pair', 'Pack', 'Case']) assert.ok(pages[0].includes(unit + ' 1 Rs.'));
});

for (const count of [4,48]) {
  test('agreed credit due date prints on every A4 page without adding pages', async () => {
    const tx={invoiceNumber:'TERMS-TEST',date:'2026-11-24T08:00:00Z',customerName:'Test buyer',paymentMethod:'Credit Account',subtotal:count*100,total:count*100,items:Array.from({length:count},(_,i)=>({productId:'SKU-'+i,productName:'Steel bolts',quantity:1,sellingPrice:100}))};
    const meta={copyType:'Reprinted Invoice',printSequence:2,watermarkText:'REPRINTED'};
    const plain=pageTexts(await renderArsInvoicePdf(tx,'ARS Distributor',meta,null));
    const agreed=pageTexts(await renderArsInvoicePdf({...tx,creditDueDate:'2026-12-25'},'ARS Distributor',meta,null));
    assert.equal(agreed.length,plain.length);
    for(const page of agreed){assert.match(page,/Due Date/);assert.match(page,/25\/12\/2026/);}
    for(const page of plain)assert.doesNotMatch(page,/Due Date/);
    const paid=pageTexts(await renderArsInvoicePdf({...tx,paymentMethod:'Cash',creditDueDate:'2026-12-25'},'ARS Distributor',meta,null));
    for(const page of paid)assert.doesNotMatch(page,/Due Date/);
  });
}

test('23 short hardware lines fit one A4 page with readable contact numbers and saved SKU codes', async()=>{
 const items=Array.from({length:23},(_,i)=>({productId:'internal-'+i,variantSku:'HW-'+(1000+i),productName:'Hardware item '+(i+1),invoiceDescription:'Standard hardware',sellingUnitLabel:i%2?'Box':'Piece',quantity:1,sellingPrice:100}));
 const pages=pageTexts(await renderArsInvoicePdf({items,invoiceNumber:'ARS-INV-26-10010',date:'2026-11-25T08:00:00Z',customerName:'Trade customer',salesRepName:'Sales rep',paymentMethod:'Credit Account',subtotal:2300,total:2300},'ARS Distributors',{},null,undefined,{address:'5/4, Behind the Court, Galgamuwa',phone:'0777 373316, 0777 721284, 0770 271439'}));
 assert.equal(pages.length,1);
 const body=pages.join(' ').replace(/\s+/g,' ');
 assert.deepEqual(body.match(/HW-\d+/g),items.map(i=>i.variantSku));
 for(const label of ['0777 373316','0777 721284','0770 271439','ARS-INV-26-10010','Balance Due','Prepared By','Received By','Authorized By'])assert.ok(body.includes(label),label);
 assert.doesNotMatch(body,/internal-/);
});

for(const count of [21,48]){
 test('240 x 270 mm continuous form preserves all rows and complete footer for '+count+' items',async()=>{
  const items=Array.from({length:count},(_,i)=>({productId:'internal-'+i,variantSku:'CF-'+(1000+i),productName:'Hardware item '+(i+1),invoiceDescription:'Standard hardware',sellingUnitLabel:i%2?'Box':'Piece',quantity:1,sellingPrice:100}));
  const pdf=await renderArsInvoicePdf({items,invoiceNumber:'CF-TEST',date:'2026-11-25T08:00:00Z',customerName:'Trade customer',salesRepName:'Sales rep',paymentMethod:'Credit Account',subtotal:count*100,total:count*100},'ARS Distributors',{},null,undefined,{address:'Galgamuwa',phone:'0777 373316, 0777 721284, 0770 271439'},'ARS-240x270');
  const media=Array.from(pdf.toString('latin1').matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g));
  const pages=pageTexts(pdf);
  assert.equal(media.length,pages.length);
  assert.match(pdf.toString('latin1'),/\/Subtype \/Image/);
  assert.doesNotMatch(pages.join(' '),/Smart systems for business/);
  for(const box of media){
   assert.ok(Math.abs(Number(box[1])-240*72/25.4)<0.01);
   assert.ok(Math.abs(Number(box[2])-270*72/25.4)<0.01);
  }
  if(count===21)assert.equal(pages.length,1);else assert.ok(pages.length>1);
  assert.deepEqual(pages.join(' ').match(/CF-\d+/g),items.map(i=>i.variantSku));
  pages.forEach((page,i)=>{
   for(const label of ['Powered by RS Nextward','Page '+(i+1)+' of '+pages.length])assert.ok(page.includes(label),label);
   assert.equal(page.includes('Prepared By'),i===pages.length-1);
  });
 });
}
