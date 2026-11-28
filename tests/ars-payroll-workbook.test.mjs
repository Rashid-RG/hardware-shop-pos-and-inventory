import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Read the actual uncompressed OpenXML package, not a mocked workbook.
function parts(b){
 const result=new Map();let p=0;
 while(p+30<=b.length&&b.readUInt32LE(p)===0x04034b50){
  assert.equal(b.readUInt16LE(p+8),0);
  const size=b.readUInt32LE(p+18),n=b.readUInt16LE(p+26),extra=b.readUInt16LE(p+28);
  const name=b.subarray(p+30,p+30+n).toString(),start=p+30+n+extra;
  assert.ok(start+size<=b.length);assert.ok(!result.has(name));
  result.set(name,b.subarray(start,start+size));p=start+size;
 }
 assert.equal(b.readUInt32LE(p),0x02014b50);return result;
}
test('advanced payroll workbook embeds compact branding on both sheets and preserves exception records',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.payroll-workbook-test-'));
 try{
 const out=join(dir,'workbook.mjs');
 await build({entryPoints:['src/utils/reportWorkbook.ts'],outfile:out,bundle:true,platform:'node',format:'esm',packages:'external'});
 const {buildBusinessWorkbook}=await import(pathToFileURL(out).href);
 const settings={storeName:'ARS Distributor',address:'Galgamuwa',phone:'0770000000'};
 const report={title:'Monthly payroll - confidential',filename:'ars-payroll-test',period:'2026-11 | Posted cohort; payments to date',headers:['Employee ID','Employee','Status','Net salary (LKR)','Paid (LKR)','Outstanding (LKR)','Exception'],rows:[['staff-1','Test & Co','Detailed',50000.01,20000.02,29999.99,''],['staff-2','Review employee','Review required','Not verified','Not verified','Not verified','Missing journal'],['staff-3','=HYPERLINK("unsafe")','Base salary only','9999999999999999.99',0,'9999999999999999.99','']],moneyColumns:[3,4,5],summary:[{label:'Coverage',value:'PARTIAL - exceptions excluded'},{label:'Exceptions',value:1},{label:'Net salary (verified LKR)',value:'1000000000049999.99'}]};
 const workbook=await buildBusinessWorkbook(report,settings);
 assert.equal(workbook.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 const zip=parts(Buffer.from(await workbook.arrayBuffer())),xml=p=>{assert.ok(zip.has(p),p);return zip.get(p).toString();};
 assert.match(xml('xl/workbook.xml'),/name="Overview"/);assert.match(xml('xl/workbook.xml'),/name="Detailed records"/);
 assert.match(xml('xl/worksheets/sheet1.xml'),/PARTIAL - exceptions excluded/);
 assert.match(xml('xl/worksheets/sheet1.xml'),/1000000000049999\.99/);
 const detail=xml('xl/worksheets/sheet2.xml');
 assert.match(detail,/ySplit="4"/);assert.match(detail,/autoFilter ref="A4:G7"/);
 for(const v of ['50000.01','20000.02','29999.99','Not verified','Missing journal','9999999999999999.99','Test &amp; Co'])assert.ok(detail.includes(v),v);
 assert.match(detail,/<c r="D5"[^>]*><v>50000\.01<\/v>/);
 assert.match(detail,/<c r="D7"[^>]*t="inlineStr"/);
 assert.doesNotMatch(detail,/<f(?:\s|>)/);assert.match(detail,/=HYPERLINK/);
 const logo=zip.get('xl/media/rs-nextward.png');assert.ok(logo);assert.equal(logo.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 for(const n of [1,2]){
  assert.match(xml('xl/worksheets/sheet'+n+'.xml'),/<drawing r:id="rId1"/);
  assert.match(xml('xl/worksheets/_rels/sheet'+n+'.xml.rels'),new RegExp('drawing'+n+'\\.xml'));
  assert.match(xml('xl/drawings/drawing'+n+'.xml'),/name="RS Nextward logo"/);
  assert.match(xml('xl/drawings/drawing'+n+'.xml'),/cx="900000" cy="185143"/);
  assert.match(xml('xl/drawings/_rels/drawing'+n+'.xml.rels'),/rs-nextward\.png/);
 }
 assert.match(xml('xl/charts/chart1.xml'),/Records by Status/);
 assert.match(xml('[Content_Types].xml'),/drawing2\.xml/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
