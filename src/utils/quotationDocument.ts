import type {Quotation,StoreSettings} from '../types';
import {reportBrand,safeReportLogo} from './businessReport';
import {reportDay} from './reporting';
import {roundMoney} from './invoiceTotals';
import {rsNextwardLogoDataUrl,rsNextwardHtmlWidth} from './rsNextwardPrintLogo';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(n:number)=>{if(!Number.isFinite(n)||n<0)throw Error('Invalid saved quotation amount.');return n.toFixed(2);};
export function buildQuotationHtml(q:Quotation,settings:StoreSettings,logo:string){
 if(!settings.activeShopId||q.shopId!==settings.activeShopId||!q.quoteNumber||!q.items.length)throw Error('A saved quotation from the active shop is required.');
 const b=reportBrand(settings);
 const rows=q.items.map((i,n)=>{
 if(!Number.isFinite(i.quantity)||i.quantity<=0||!Number.isFinite(i.discount)||i.discount<0||i.discount>100||!Number.isFinite(i.discountAmount??0)||(i.discountAmount??0)<0)throw Error('Invalid saved quotation line.');
 const line=roundMoney(Math.max(0,i.sellingPrice*i.quantity*(1-i.discount/100)-(i.discountAmount??0)));
 return '<tr><td>'+(n+1)+'</td><td>'+esc(i.productName)+'</td><td>'+esc(i.sellingUnitLabel||'Not recorded')+'</td><td class="num">'+esc(i.quantity)+'</td><td class="num">'+money(i.sellingPrice)+'</td><td class="num">'+esc(i.discount)+'% / '+money(i.discountAmount??0)+'</td><td class="num">'+money(line)+'</td></tr>';
 }).join('');
 return '<!doctype html><html><head><meta charset="utf-8"><title>Quotation '+esc(q.quoteNumber)+'</title><style>@page{size:A4 portrait;margin:12mm}body{font:12px Arial,sans-serif;color:#000}header{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #000;padding-bottom:8px}header img{width:20mm;height:auto}h1{font-size:20px;margin:0}h2{font-size:18px;margin:0}p{margin:5px 0;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border-bottom:1px solid #000;padding:6px;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}thead th{border-top:1px solid #000}tr,section,footer{break-inside:avoid}.num{text-align:right}.totals{text-align:right}.sign{display:flex;gap:24px;margin-top:36px}.sign span{flex:1;border-top:1px solid #000;text-align:center;padding-top:5px}footer{border-top:1px solid #000;margin-top:18px;padding-top:6px;text-align:right;font-size:10px}button{background:white;border:1px solid #000;padding:8px;cursor:pointer}@media print{button{display:none}}</style></head><body><button id="print">Print / Save PDF</button><header><div>'+(logo?'<img src="'+esc(logo)+'" alt="Company logo">':'')+'<h1>'+esc(b.name)+'</h1><p>'+esc([b.address,b.phone].filter(Boolean).join(' | '))+'</p></div><div><h2>QUOTATION</h2><p>'+esc(q.quoteNumber)+'</p><p>Date: '+esc(reportDay(q.date))+'</p><p>Valid until: '+esc(q.validUntil||'Not specified')+'</p><p>Status: '+esc(q.status)+'</p></div></header><p>Prepared for: '+esc(q.customerName)+' '+esc(q.customerPhone||'')+'</p><table><thead><tr><th>#</th><th>Product</th><th>U/M</th><th>Qty</th><th>Rate (Rs.)</th><th>Disc % / Rs.</th><th>Amount (Rs.)</th></tr></thead><tbody>'+rows+'</tbody></table><section class="totals"><p>Subtotal: Rs. '+money(q.subtotal)+'</p><p>Discount: Rs. '+money(q.discountAmount)+'</p><p>Tax: Rs. '+money(q.tax)+'</p><h2>Total: Rs. '+money(q.total)+'</h2></section><section><p>Notes: '+esc(q.notes||'None')+'</p><p>This is a quotation only, not a tax invoice or proof of payment.</p><div class="sign"><span>Prepared by</span><span>Authorized by</span></div></section><footer>Powered by RS Nextward<br><img alt="RS Nextward logo" src="'+rsNextwardLogoDataUrl+'" style="width:'+rsNextwardHtmlWidth+';height:auto"></footer></body></html>';
}
export function printQuotation(q:Quotation,settings:StoreSettings){
 const html=buildQuotationHtml(q,settings,safeReportLogo(reportBrand(settings).logo));
 const win=window.open('','_blank','width=800,height=800');if(!win)throw Error('Allow the quotation print popup in your browser.');
 win.opener=null;win.document.open();win.document.write(html);win.document.close();
 win.document.getElementById('print')?.addEventListener('click',()=>win.print());
}
