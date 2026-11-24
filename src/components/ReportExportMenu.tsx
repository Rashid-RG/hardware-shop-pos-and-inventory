import React,{useState} from 'react';
import {Download} from 'lucide-react';
import type {StoreSettings} from '../types';
import {BusinessReport,saveReportCsv,printBusinessReport} from '../utils/businessReport';
export function ReportExportMenu({report,settings}:{report:()=>BusinessReport;settings:StoreSettings}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(format:string){setError('');try{const data=report();if(format==='csv')saveReportCsv(data);else if(format==='pdf')printBusinessReport(data,settings);else{setBusy(true);const {exportBusinessWorkbook}=await import('../utils/reportWorkbook');await exportBusinessWorkbook(data,settings);}}catch(e){setError(e instanceof Error?e.message:'Export failed.');}finally{setBusy(false);}}
 return <div className="flex flex-wrap items-center gap-2"><Download className="h-4 w-4 text-slate-500"/><button type="button" disabled={busy} onClick={()=>run('xlsx')} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-slate-900 disabled:opacity-50">{busy?'Preparing…':'Advanced Excel'}</button><button type="button" onClick={()=>run('pdf')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">Print / PDF</button><button type="button" onClick={()=>run('csv')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">CSV</button>{error&&<span role="alert" className="text-xs text-rose-700">{error}</span>}</div>;
}
