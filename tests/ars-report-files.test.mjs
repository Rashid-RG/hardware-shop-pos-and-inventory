import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('generated ARS workbook and PDF contain valid report data and branding',()=>{
 const script = `
 import assert from 'node:assert/strict';
 import {buildBusinessWorkbook} from './src/utils/reportWorkbook.ts';
 import {buildReportChart} from './src/utils/reportChart.ts';
 import {renderBusinessReportPdf} from './src/utils/businessReportPdf.ts';
 async function main(){
 const settings={storeName:'ARS Hardware',taxRate:0,currency:'LKR',invoicePrefix:'ARS'};
 const report={title:'Product performance',filename:'ars-test',period:'2026-11',headers:['Product','Revenue (LKR)'],rows:[['=UNTRUSTED',1250.5],['Bolts & nuts',400]],moneyColumns:[1],summary:[{label:'Revenue (LKR)',value:1650.5}]};
 const chart=buildReportChart(report);
 assert.equal(chart.points[0].value,1250.5);
 const bytes=Buffer.from(await (await buildBusinessWorkbook(report,settings)).arrayBuffer());
 const entries=new Map();
 let offset=0;
 while(bytes.readUInt32LE(offset)===0x04034b50){
  const size=bytes.readUInt32LE(offset+18),n=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
  const name=bytes.toString('utf8',offset+30,offset+30+n),start=offset+30+n+extra;
  entries.set(name,bytes.toString('utf8',start,start+size));offset=start+size;
 }
 assert.equal(bytes.readUInt32LE(offset),0x02014b50);
 assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);
 assert.ok(entries.get('xl/workbook.xml').includes('Detailed records'));
 assert.ok(entries.get('xl/worksheets/sheet2.xml').includes('1250.5</v>'));
 assert.ok(entries.get('xl/worksheets/sheet2.xml').includes('=UNTRUSTED</t>'));
 assert.ok(!entries.get('xl/worksheets/sheet2.xml').includes('<f>'));
 assert.ok(entries.get('xl/worksheets/sheet2.xml').includes('Bolts &amp; nuts'));
 assert.ok(entries.get('xl/charts/chart1.xml').includes('1250.5'));
 assert.ok(entries.get('xl/drawings/_rels/drawing1.xml.rels').includes('../charts/chart1.xml'));
 assert.ok(entries.get('xl/worksheets/sheet1.xml').includes('RS Nextward'));
 const pdf=await renderBusinessReportPdf({...report,rows:Array.from({length:120},(_,i)=>['Product '+i,i*100])},{name:'ARS Hardware',address:'Test address',phone:'Test phone'},null);
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 assert.ok((pdf.toString('latin1').match(/\\/Type \\/Page\\b/g)||[]).length>1);
 assert.ok(pdf.toString('latin1').includes('%%EOF'));
 }
 main().catch(e=>{console.error(e);process.exitCode=1;});
 `;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
});
