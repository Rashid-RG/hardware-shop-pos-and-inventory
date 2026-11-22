import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pdf=readFileSync(new URL('../src/utils/arsInvoicePdf.ts',import.meta.url),'utf8');

test('every A4 invoice page uses the full configured ARS company and buyer header',()=>{
  const header=pdf.split('const header = (continuation: boolean) => {')[1]?.split('const columns =')[0]||'';
  assert.match(header,/doc\.image\(logo/);
  assert.match(header,/company\?\.companyLegalName/);
  assert.match(header,/contact\?\.address/);
  assert.match(header,/contact\?\.phone/);
  assert.match(header,/section\(LEFT, 124, 248, 85, 'Customer'\)/);
  assert.match(header,/section\(295, 124, 265, 85, 'Invoice Details'\)/);
  assert.match(header,/tx\.invoiceNumber/);
  assert.match(header,/tx\.customerName/);
  assert.match(header,/tx\.paymentMethod/);
  assert.match(header,/CONTINUED/);
  assert.doesNotMatch(header,/if \(continuation\) \{[\s\S]*?return 72;/);
});
test('page footer is repeated and numbered using buffered PDF pages',()=>{
  assert.match(pdf,/const footer = \(pageNumber: number, totalPages: number\)/);
  assert.match(pdf,/Page \$\{pageNumber\} of \$\{totalPages\}/);
  assert.match(pdf,/Generated with RS Nextward Business Systems/);
  assert.match(pdf,/doc\.bufferedPageRange\(\)/);
  assert.match(pdf,/doc\.switchToPage\(range\.start \+ offset\)/);
  assert.match(pdf,/footer\(offset \+ 1, range\.count\)/);
});
test('multipage invoice retains line numbering, with totals and signatures on the last page',()=>{
  assert.match(pdf,/doc\.addPage\(\)/);
  assert.match(pdf,/y = header\(true\)/);
  assert.match(pdf,/String\(i \+ 1\)/);
  assert.match(pdf,/notesAndTotals\(y\)/);
  assert.match(pdf,/\['Prepared By', LEFT\]/);
  assert.match(pdf,/\['Received By', 214\]/);
  assert.match(pdf,/\['Authorized By', 393\]/);
});
