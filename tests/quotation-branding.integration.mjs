import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQuotationHtml} from '../src/utils/quotationDocument.ts';
import {reportBrand,safeReportLogo} from '../src/utils/businessReport.ts';
import {arsPrintLogoUrl} from '../src/utils/arsPrintLogo.ts';
import {rsNextwardLogoDataUrl,rsNextwardHtmlWidth} from '../src/utils/rsNextwardPrintLogo.ts';

const settings={activeShopId:'ci-shop',storeName:'ARS Distributor'};
const quotation={shopId:'ci-shop',quoteNumber:'CI-Q-001',date:'2026-11-24T08:00:00Z',status:'Draft',customerName:'CI Trade & Hardware',subtotal:1200,discountAmount:0,tax:0,total:1200,items:[
 {productName:'Door lock <sample>',sellingUnitLabel:'Box',quantity:1,sellingPrice:1000,discount:0},
 {productName:'Door lock',sellingUnitLabel:'Piece',quantity:2,sellingPrice:100,discount:0}
]};
test('saved quotation contains official ARS and RS Nextward artwork, A4 and mixed units',()=>{
 const logo=safeReportLogo(reportBrand(settings).logo);
 assert.equal(logo,arsPrintLogoUrl);
 const html=buildQuotationHtml(quotation,settings,logo);
 assert.ok(html.includes('src="'+arsPrintLogoUrl+'"'));
 assert.ok(html.includes('src="'+rsNextwardLogoDataUrl+'"'));
 assert.ok(html.includes('width:'+rsNextwardHtmlWidth));
 assert.ok(html.includes('Powered by RS Nextward'));
 assert.match(html,/@page\{size:A4 portrait/);
 assert.match(html,/<td>Box<\/td>/);
 assert.match(html,/<td>Piece<\/td>/);
 assert.ok(html.includes('CI Trade &amp; Hardware'));
 assert.ok(html.includes('Door lock &lt;sample&gt;'));
 assert.match(html,/Total: Rs\. 1200\.00/);
 assert.ok(html.includes('not a tax invoice or proof of payment'));
 assert.throws(()=>buildQuotationHtml({...quotation,shopId:'other'},settings,logo),/active shop/);
});
