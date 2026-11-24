import React,{useState} from 'react';
import {Download} from 'lucide-react';
import type {StoreSettings} from '../types';
import {BusinessReport,saveReportCsv,printBusinessReport,downloadReport} from '../utils/businessReport';
export function ReportExportMenu({report,settings}:{report:()=>BusinessReport | Promise<BusinessReport>;settings:StoreSettings}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(format:string) {
   setError('');
   setBusy(true);
   let preview: Window | null = null;
   try {
     if (format === 'print') {
       preview = window.open('', '_blank', 'width=1100,height=800');
       if (!preview) throw new Error('Allow the report popup in your browser.');
       preview.opener = null;
     }
     const data = await report();
     if (format === 'csv') saveReportCsv(data, settings);
     else if (preview) printBusinessReport(data, settings, preview);
     else if (format === 'pdf') {
       const session = JSON.parse(sessionStorage.getItem('hardware_shop_session') || 'null');
       if (!session?.token) throw new Error('Sign in again to download the PDF.');
       const headers = new Headers({Authorization:'Bearer '+session.token,'Content-Type':'application/json'});
       if (settings.activeShopId) headers.set('X-Shop-Id',settings.activeShopId);
       const response = await fetch('/api/reports/render-pdf',{method:'POST',headers,body:JSON.stringify(data)});
       if (!response.ok) {
         const result = await response.json().catch(()=>({}));
         throw new Error(result.error || 'PDF export failed.');
       }
       if (!response.headers.get('Content-Type')?.includes('application/pdf')) throw new Error('Unexpected PDF response.');
       downloadReport(await response.blob(),data.filename+'.pdf');
     } else {
       const {exportBusinessWorkbook} = await import('../utils/reportWorkbook');
       await exportBusinessWorkbook(data,settings);
     }
   } catch (error) {
     preview?.close();
     setError(error instanceof Error ? error.message : 'Export failed.');
   } finally {
     setBusy(false);
   }
 }
 return <div className="flex flex-wrap items-center gap-2"><Download className="h-4 w-4 text-slate-500"/><button type="button" disabled={busy} onClick={()=>run('xlsx')} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-slate-900 disabled:opacity-50">{busy?'Preparing…':'Advanced Excel'}</button><button type="button" disabled={busy} onClick={()=>run('pdf')} className="rounded-lg bg-slate-900 text-white px-3 py-2 text-xs font-semibold disabled:opacity-50">Download PDF</button><button type="button" disabled={busy} onClick={()=>run('print')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">Print preview</button><button type="button" disabled={busy} onClick={()=>run('csv')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">CSV</button>{error&&<span role="alert" className="text-xs text-rose-700">{error}</span>}</div>;
}
