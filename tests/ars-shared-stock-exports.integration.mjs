import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReportCsv} from '../src/utils/businessReport.ts';
import {buildBusinessWorkbook} from '../src/utils/reportWorkbook.ts';

const report={title:'Product performance report',filename:'ars-ci-products',period:'CI',headers:['Product','U/M','Qty Sold','Base Qty','Revenue (LKR)','Profit (LKR)'],rows:[['Door Lock','Box',2,24,10800,3600],['Door Lock','Piece',4,4,2000,800],['Legacy Item','Not recorded',3,'Not recorded',150,30]],moneyColumns:[4,5]};
test('mixed-unit report CSV preserves labels and numeric quantities',async()=>{
 const csv=await buildReportCsv(report).text();
 assert.match(csv,/"Product","U\/M","Qty Sold","Base Qty","Revenue \(LKR\)","Profit \(LKR\)"/);
 assert.ok(csv.includes('"Door Lock","Box","2","24","10800","3600"'));
 assert.ok(csv.includes('"Door Lock","Piece","4","4","2000","800"'));
 assert.ok(csv.includes('"Legacy Item","Not recorded","3","Not recorded","150","30"'));
});
test('mixed-unit workbook preserves numeric cells and unknown legacy quantities',async()=>{
 const blob=await buildBusinessWorkbook(report,{storeName:'CI Export Shop'});
 const buffer=Buffer.from(await blob.arrayBuffer());
 assert.equal(buffer.readUInt32LE(0),0x04034b50);
 const entries=new Map();
 for(let pos=0;pos+30<=buffer.length&&buffer.readUInt32LE(pos)===0x04034b50;){
  const size=buffer.readUInt32LE(pos+18),nameLength=buffer.readUInt16LE(pos+26),extra=buffer.readUInt16LE(pos+28);
  const start=pos+30+nameLength+extra;
  entries.set(buffer.toString('utf8',pos+30,pos+30+nameLength),buffer.toString('utf8',start,start+size));pos=start+size;
 }
 const sheet=entries.get('xl/worksheets/sheet2.xml');
 assert.ok(sheet);
 assert.match(sheet,/<c r="B5"[^>]*t="inlineStr"[^>]*>.*?<t[^>]*>Box<\/t>/);
 assert.match(sheet,/<c r="C5"[^>]*><v>2<\/v><\/c>/);
 assert.match(sheet,/<c r="D5"[^>]*><v>24<\/v><\/c>/);
 assert.match(sheet,/<c r="E5"[^>]*><v>10800<\/v><\/c>/);
 assert.match(sheet,/<c r="D6"[^>]*><v>4<\/v><\/c>/);
 assert.match(sheet,/<c r="D7"[^>]*t="inlineStr"[^>]*>.*?<t[^>]*>Not recorded<\/t>/);
});
