import type {StoreSettings} from '../types';
import type {BusinessReport,ReportCell} from '../utils/businessReport';
import {downloadReport} from '../utils/businessReport';
import React,{useEffect,useRef,useState} from 'react';
import {reportDay} from '../utils/reporting';
const metrics=['baseSalary','overtime','bonus','allowances','grossSalary','advanceRecovery','otherDeductions','employeeEpf','employerEpf','employerEtf','totalDeductions','netSalary','employerCost','paid','outstanding'] as const;
type Metric=typeof metrics[number];
type Amounts=Record<Metric,string>;
type Entry={id:string;employeeId:string;employeeName:string;postingDate:string;journalId:string;statutoryBound:boolean;amounts:Amounts|null;issue:string|null};
type Report={company:{name:string;address:string;phone:string};period:string;scope:string;rows:Entry[];recordCount:number;exceptionCount:number;baseSalaryOnlyCount:number;verifiedTotals:Amounts;totalsComplete:boolean;postingEnabled:false};
const button='rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50';
const field='rounded-lg border border-slate-300 p-2 text-sm w-full';
const money=(v:string)=>{const [w,f='']=v.split('.');return w.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+f.padEnd(2,'0');};
const amounts=(v:unknown):v is Amounts=>!!v&&typeof v==='object'&&metrics.every(k=>typeof (v as Amounts)[k]==='string'&&/^\d+(\.\d{1,2})?$/.test((v as Amounts)[k]));
const labels:Record<Metric,string>={baseSalary:'Basic salary',overtime:'Overtime',bonus:'Bonus',allowances:'Allowances',grossSalary:'Gross salary',advanceRecovery:'Advance recovery',otherDeductions:'Other deductions (incl. unpaid leave)',employeeEpf:'Employee EPF',employerEpf:'Employer EPF',employerEtf:'Employer ETF',totalDeductions:'Total deductions',netSalary:'Net salary',employerCost:'Employer cost',paid:'Recorded payments',outstanding:'Outstanding salary'};
export default function MonthlyPayrollReportPanel({shopId,authToken}:{shopId:string;authToken:string}){
 const [period,setPeriod]=useState(reportDay(new Date()).slice(0,7)),[revision,setRevision]=useState(0),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(0),[selected,setSelected]=useState<string|null>(null);
 const [loaded,setLoaded]=useState<{key:string;data:Report}|null>(null),[failure,setFailure]=useState<{key:string;message:string}|null>(null);
 const [exporting,setExporting]=useState(false),[exportFailure,setExportFailure]=useState<{key:string;message:string}|null>(null);
 const exportLock=useRef(false),activeExport=useRef<AbortController|null>(null);
 const key=JSON.stringify([shopId,authToken,period,revision]),report=loaded?.key===key?loaded.data:null,error=failure?.key===key?failure.message:'';
 useEffect(()=>()=>activeExport.current?.abort(),[key]);
 useEffect(()=>{const c=new AbortController();setPage(0);setSelected(null);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)){setFailure({key,message:'Select a valid payroll month.'});return()=>c.abort();}
 fetch('/api/ars/payroll/monthly-report?'+new URLSearchParams({period}),{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},cache:'no-store',signal:c.signal}).then(async r=>{
 const d=await r.json();if(!r.ok)throw Error(typeof d?.error==='string'?d.error:'Payroll report unavailable.');
 if(!d||!d.company||![d.company.name,d.company.address,d.company.phone].every(v=>typeof v==='string')||!d.company.name.trim()||d.period!==period||d.postingEnabled!==false||!amounts(d.verifiedTotals)||!Array.isArray(d.rows)||d.rows.some((x:Entry)=>!x||![x.id,x.employeeId,x.employeeName,x.postingDate,x.journalId].every(v=>typeof v==='string')||typeof x.statutoryBound!=='boolean'||(x.issue===null?!amounts(x.amounts):typeof x.issue!=='string'||x.amounts!==null))||d.recordCount!==d.rows.length||d.exceptionCount!==d.rows.filter((x:Entry)=>x.issue!==null).length||d.baseSalaryOnlyCount!==d.rows.filter((x:Entry)=>!x.statutoryBound).length||d.totalsComplete!==(d.exceptionCount===0))throw Error('Payroll report response could not be verified.');
 if(!c.signal.aborted)setLoaded({key,data:d});
 }).catch(e=>{if(!c.signal.aborted)setFailure({key,message:e.message});});return()=>c.abort();},[key,shopId,authToken,period]);
 const rows=(report?.rows||[]).filter(r=>(r.employeeName+' '+r.employeeId).toLowerCase().includes(search.trim().toLowerCase())&&(filter==='all'||(filter==='exceptions'?r.issue!==null:filter==='base'?!r.statutoryBound:r.issue===null&&!!r.amounts&&BigInt(r.amounts.outstanding.replace('.',''))>0n)));
 const detail=report?.rows.find(r=>r.id===selected);
 async function exportExcel(){
  if(!report||exportLock.current)return;
  const c=new AbortController();activeExport.current=c;exportLock.current=true;setExporting(true);setExportFailure(null);
  try{
   const {buildBusinessWorkbook}=await import('../utils/reportWorkbook');
   // Excel stores at most 15 significant decimal digits; preserve larger exact values as text.
   const cell=(v:string):ReportCell=>{const [w,f='']=v.split('.');const cents=BigInt(w)*100n+BigInt(f.padEnd(2,'0'));return cents<=999999999999999n?Number(cents)/100:v;};
   const data:BusinessReport={title:'Monthly payroll — confidential',filename:'ars-payroll-'+report.period,period:report.period+' | Posted cohort; payments to date',headers:['Employee ID','Employee','Posting date','Status',...metrics.map(k=>labels[k]+' (LKR)'),'Exception','Journal reference'],rows:report.rows.map(r=>[r.employeeId,r.employeeName,r.postingDate,r.issue?'Review required':r.statutoryBound?'Detailed':'Base salary only',...metrics.map(k=>r.amounts?cell(r.amounts[k]):'Not verified'),r.issue||'',r.journalId]),summary:[{label:'Coverage',value:report.totalsComplete?'No record exceptions detected':'PARTIAL — exceptions excluded'},{label:'Records',value:report.recordCount},{label:'Exceptions',value:report.exceptionCount},{label:'Base-only records (no statutory breakdown)',value:report.baseSalaryOnlyCount},...metrics.map(k=>({label:labels[k]+' (verified LKR)',value:cell(report.verifiedTotals[k])}))],moneyColumns:metrics.map((_,i)=>i+4)};
   const settings={storeName:report.company.name,address:report.company.address,phone:report.company.phone} as StoreSettings;
   const blob=await buildBusinessWorkbook(data,settings);
   if(!c.signal.aborted)downloadReport(blob,data.filename+'.xlsx');
  }catch(e){if(!c.signal.aborted)setExportFailure({key,message:e instanceof Error?e.message:'Unable to export payroll workbook.'});}
  finally{exportLock.current=false;setExporting(false);}
 }

 return <section className="rounded-xl border bg-white p-3 space-y-3" aria-label="Monthly payroll reports">
 <header className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Payroll reports</h3><p className="text-xs text-slate-500">Posted payroll only · confidential · LKR</p></div><div className="flex gap-2 flex-wrap"><button className={button} onClick={()=>setRevision(v=>v+1)}>Refresh</button><button className={button+' bg-slate-900 text-white'} disabled={!report||exporting} onClick={()=>void exportExcel()}>{exporting?'Preparing…':'Advanced Excel'}</button></div></header>
 <div className="grid gap-2 sm:grid-cols-3"><label className="text-xs font-semibold">Payroll month<input type="month" className={field} value={period} onChange={e=>setPeriod(e.target.value)}/></label><label className="text-xs font-semibold">Employee<input className={field} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label><label className="text-xs font-semibold">Filter<select className={field} value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="all">All records</option><option value="exceptions">Requires review</option><option value="base">Base salary only</option><option value="outstanding">Outstanding salary</option></select></label></div>
 {exportFailure?.key===key&&<p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs">{exportFailure.message}</p>}
 {report&&<p className="text-xs text-slate-500">Excel exports the entire selected payroll month, including exception records; search filters affect the screen only.</p>}
 {error?<p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{error}</p>:!report?<p role="status" className="text-xs">Loading posted payroll report…</p>:<>
 <p className="text-xs text-slate-600">Selected payroll month; recorded payments to date, not calendar-month cash flow. {report.recordCount} records · {report.exceptionCount} exceptions.</p>
 {!report.totalsComplete&&<p role="alert" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Partial verified totals only. {report.exceptionCount} records excluded pending reconciliation.</p>}
 {!!report.baseSalaryOnlyCount&&<p className="text-xs text-amber-900">{report.baseSalaryOnlyCount} base-salary-only records have no statutory breakdown; zero contributions are not evidence of exemption.</p>}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{(['grossSalary','employerCost','netSalary','outstanding'] as Metric[]).map(k=><div key={k} className="rounded-lg border bg-slate-50 p-2"><p className="text-xs text-slate-500">{labels[k]}</p><strong className="text-lg tabular-nums">Rs. {money(report.verifiedTotals[k])}</strong></div>)}</div>
 <details className="rounded-lg border p-2"><summary className="text-xs font-semibold cursor-pointer">Earnings, deductions and statutory breakdown</summary><div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">{metrics.map(k=><div key={k}><p className="text-xs text-slate-500">{labels[k]}</p><strong className="text-xs tabular-nums">{money(report.verifiedTotals[k])}</strong></div>)}</div></details>
 <div className="max-h-[42dvh] overflow-auto rounded-lg border"><table className="w-full min-w-[730px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{['Employee','Gross','Deductions','Net','Paid','Outstanding','Status','Action'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(page*12,page*12+12).map(r=><tr key={r.id} className="border-b"><td className="p-2">{r.employeeName}</td>{(['grossSalary','totalDeductions','netSalary','paid','outstanding'] as Metric[]).map(k=><td key={k}>{r.amounts?money(r.amounts[k]):'—'}</td>)}<td>{r.issue?'Review required':r.statutoryBound?'Detailed':'Base only'}</td><td><button className={button} onClick={()=>setSelected(r.id)}>Details</button></td></tr>)}</tbody></table>{!rows.length&&<p className="p-3 text-xs">No matching posted payroll records.</p>}</div>
 <div className="flex items-center gap-2 text-xs"><span>{rows.length} records</span><button className={button} disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><button className={button} disabled={(page+1)*12>=rows.length} onClick={()=>setPage(p=>p+1)}>Next</button></div>
 </>}
 {detail&&<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3"><section role="dialog" aria-modal="true" aria-label="Employee payroll breakdown" className="bg-white rounded-xl p-4 w-full max-w-xl max-h-[85dvh] overflow-auto space-y-3"><header className="flex justify-between"><strong>{detail.employeeName}</strong><button className={button} onClick={()=>setSelected(null)}>Close</button></header><p className="text-xs break-all">Journal: {detail.journalId} · {detail.postingDate}</p>{detail.issue?<p role="alert" className="text-xs text-amber-900">{detail.issue}</p>:<div className="grid grid-cols-2 gap-2">{metrics.map(k=><div key={k}><p className="text-xs text-slate-500">{labels[k]}</p><strong className="text-sm">{money(detail.amounts![k])}</strong></div>)}</div>}</section></div>}
 </section>;
}
