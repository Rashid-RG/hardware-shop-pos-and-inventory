import { arsPrintLogoUrl, isArsPrintBrand, arsDisplayName } from './arsPrintLogo';
import type { StoreSettings } from '../types';
import { invoiceFooter } from './invoiceFooter';

export type ReportCell = string | number;
export interface BusinessReport {
  title: string;
  filename: string;
  period: string;
  headers: string[];
  rows: ReportCell[][];
  summary?: {label:string; value:ReportCell}[];
  moneyColumns?: number[];
  csvPreamble?: ReportCell[][];
}
export function reportBrand(settings:StoreSettings) {
  const shop=settings.shopProfiles?.find(s=>s.id===settings.activeShopId);
  return {name:arsDisplayName(shop?.name || settings.storeName || 'ARS Distributor'), address:shop?.address || settings.address || '', phone:shop?.phone || settings.phone || '', logo:isArsPrintBrand(shop?.name || settings.storeName || 'ARS Distributor') ? arsPrintLogoUrl : shop?.logoUrl || settings.logoUrl || ''};
}
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function saveReportCsv(report:BusinessReport) {
  const cell=(value:ReportCell)=>'"'+(typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(value)?"'"+value:String(value??'')).replace(/"/g,'""')+'"';
  downloadReport(new Blob(['\uFEFF'+[...(report.csvPreamble || []),report.headers,...report.rows].map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),report.filename+'.csv');
}
export function downloadReport(blob:Blob,filename:string) {
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function safeReportLogo(value:string) {
  if(value===arsPrintLogoUrl)return value;
  if(!value)return '';
  try { const url=new URL(value,window.location.origin); return url.origin===window.location.origin&&/^https?:$/.test(url.protocol)?url.href:/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)?value:''; } catch{return '';}
}
export function printBusinessReport(report:BusinessReport,settings:StoreSettings,existingWindow?:Window) {
  const brand=reportBrand(settings),logo=safeReportLogo(brand.logo);
  const popup=existingWindow || window.open('','_blank','width=1100,height=800');
  if(!popup)throw new Error('Allow the report popup in your browser.');
  popup.opener=null;
  const fmt=(v:ReportCell,i:number)=>typeof v==='number'?v.toLocaleString('en-LK',{minimumFractionDigits:report.moneyColumns?.includes(i)?2:0,maximumFractionDigits:2}):v;
  popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+escapeHtml(report.title)+'</title><style>@page{size:A4 landscape;margin:13mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#182b45;margin:0}header{display:flex;gap:20px;align-items:center;border-bottom:4px solid #d6a62c;padding:12px 0}header img{width:76px;height:64px;object-fit:contain}h1{font-size:24px;margin:0}h2{font-size:19px;margin:22px 0 5px}p{margin:5px 0;color:#475569}.cards{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.metric{border:1px solid #d8e0eb;border-left:4px solid #d6a62c;padding:12px;min-width:130px;flex:1}.metric b{display:block;font-size:17px;margin-top:6px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{background:#152945;color:white;text-align:left;font-size:9px}td,th{padding:7px;border-bottom:1px solid #d8e0eb;overflow-wrap:anywhere}td.num{text-align:right;font-variant-numeric:tabular-nums}tr{break-inside:avoid}tbody tr:nth-child(even){background:#f0f4f8}footer{margin-top:20px;border-top:2px solid #d6a62c;padding-top:10px;display:flex;justify-content:space-between}button{padding:10px 20px;background:#152945;color:white;border:0;cursor:pointer}@media screen{body{padding:25px}}@media print{button{display:none}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><button id="print">Print / Save PDF</button><header>'+(logo?'<img alt="Company logo" src="'+escapeHtml(logo)+'">':'')+'<div><h1>'+escapeHtml(brand.name)+'</h1><p>'+escapeHtml(brand.address)+'</p><p>'+escapeHtml(brand.phone)+'</p></div></header><h2>'+escapeHtml(report.title)+'</h2><p>'+escapeHtml(report.period)+' | Generated '+escapeHtml(new Date().toLocaleString())+' | Confidential</p><div class="cards">'+(report.summary||[]).map(m=>'<div class="metric">'+escapeHtml(m.label)+'<b>'+escapeHtml(typeof m.value==='number'?m.value.toLocaleString('en-LK',{maximumFractionDigits:2}):m.value)+'</b></div>').join('')+'</div><table><thead><tr>'+report.headers.map(h=>'<th>'+escapeHtml(h)+'</th>').join('')+'</tr></thead><tbody>'+report.rows.map(row=>'<tr>'+row.map((v,i)=>'<td class="'+(typeof v==='number'?'num':'')+'">'+escapeHtml(fmt(v,i))+'</td>').join('')+'</tr>').join('')+'</tbody></table><footer><span>'+escapeHtml(brand.name)+' • '+report.rows.length+' records</span><strong>'+escapeHtml(invoiceFooter.credit)+'</strong></footer></body></html>');
  popup.document.close();popup.document.getElementById('print')?.addEventListener('click',()=>popup.print());
}
