import React,{useEffect,useRef,useState} from 'react';
import {reportDay} from '../utils/reporting';
type Props={shopId:string;authToken:string};
type Balance={id:string;employee_id:string;employee_name:string;period_key:string;posting_date:string;net_salary:string;paid:string;outstanding:string;reconciliation_required:boolean};
type Payment={id:string;accrual_id:string;employee_id:string;employee_name:string;period_key:string;financial_account_id:string;amount:string;posting_date:string;journal_id:string;evidence:string;recorded_by:string;recorded_at:string;reconciliation_required:boolean};
const field='w-full rounded-lg border border-slate-300 p-2 text-sm';
const button='rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50';
const money=(v:number|string)=>Number(v).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
const validMoney=(v:unknown)=>typeof v==='string'&&/^\d+(\.\d{1,2})?$/.test(v)&&Number.isFinite(Number(v));
const status=(b:Balance)=>b.reconciliation_required?'Reconciliation required':Number(b.outstanding)===0?'Settled':Number(b.paid)>0?'Partially paid':'Unpaid';
export default function SalaryPaymentPanel({shopId,authToken}:Props){
 const [rows,setRows]=useState<Balance[]|null>(null),[version,setVersion]=useState(0),[period,setPeriod]=useState(reportDay(new Date()).slice(0,7)),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(0);
 const [selected,setSelected]=useState<Balance|null>(null),[history,setHistory]=useState<Payment[]|null>(null),[historyPage,setHistoryPage]=useState(0),[detail,setDetail]=useState<Payment|null>(null),[error,setError]=useState(''),[historyError,setHistoryError]=useState('');
 const base='/api/ars/payroll/salary-payments',headers={Authorization:'Bearer '+authToken,'X-Shop-Id':shopId};
 const [exporting,setExporting]=useState<string|null>(null),[exportError,setExportError]=useState('');
 const exportLock=useRef(false),exportController=useRef<AbortController|null>(null);
 useEffect(()=>()=>exportController.current?.abort(),[shopId,authToken]);
 async function downloadPayslip(b:Balance){
  if(exportLock.current||b.reconciliation_required)return;
  exportLock.current=true;setExporting(b.id);setExportError('');
  const c=new AbortController();exportController.current=c;
  try{
   const response=await fetch('/api/ars/payroll/payslips/'+encodeURIComponent(b.id)+'/pdf',{headers,cache:'no-store',signal:c.signal});
   if(!response.ok){const d=await response.json().catch(()=>null);throw Error(typeof d?.error==='string'?d.error:'Unable to download verified payslip.');}
   if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf'))throw Error('Invalid payslip response.');
   const pdf=await response.blob();if(pdf.size<5||await pdf.slice(0,5).text()!=='%PDF-')throw Error('Invalid payslip document.');
   if(c.signal.aborted)return;
   const url=URL.createObjectURL(pdf);
   try{const link=document.createElement('a');link.href=url;link.download='payslip-'+b.period_key+'-'+b.employee_id.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,60)+'.pdf';document.body.appendChild(link);link.click();link.remove();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
  }catch(e){if(!c.signal.aborted)setExportError(e instanceof Error?e.message:'Unable to download payslip.');}
  finally{exportLock.current=false;if(!c.signal.aborted)setExporting(null);}
 }

 useEffect(()=>{const c=new AbortController();setRows(null);setError('');setPage(0);setSelected(null);setDetail(null);
 fetch(base+'/balances',{headers,cache:'no-store',signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok||!Array.isArray(d)||d.some(b=>!b||typeof b.id!=='string'||typeof b.employee_name!=='string'||typeof b.period_key!=='string'||typeof b.reconciliation_required!=='boolean'||![b.net_salary,b.paid,b.outstanding].every(validMoney)))throw Error(d.error||'Salary balances could not be verified.');if(!c.signal.aborted)setRows(d);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[shopId,authToken,version]);
 useEffect(()=>{setHistory(null);setHistoryError('');setHistoryPage(0);setDetail(null);if(!selected)return;const c=new AbortController();
 fetch(base+'?'+new URLSearchParams({accrualId:selected.id}),{headers,cache:'no-store',signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok||!Array.isArray(d)||d.some(p=>!p||p.accrual_id!==selected.id||p.employee_id!==selected.employee_id||!validMoney(p.amount)))throw Error(d.error||'Payment history could not be verified.');if(!c.signal.aborted)setHistory(d);}).catch(e=>{if(!c.signal.aborted)setHistoryError(e.message);});return()=>c.abort();},[selected,shopId,authToken]);
 const monthly=(rows||[]).filter(b=>!period||b.period_key===period),verified=monthly.filter(b=>!b.reconciliation_required),reviewCount=monthly.length-verified.length;
 const filtered=monthly.filter(b=>b.employee_name.toLowerCase().includes(search.trim().toLowerCase())&&(filter==='all'||status(b)===filter));
 const total=(k:'net_salary'|'paid'|'outstanding')=>verified.reduce((n,b)=>n+Number(b[k]),0);
 const cards=[['Net salary','Rs. '+money(total('net_salary'))],['Paid','Rs. '+money(total('paid'))],['Outstanding','Rs. '+money(total('outstanding'))],['Unsettled payrolls',String(verified.filter(b=>Number(b.outstanding)>0).length)]];
 return <section aria-label="Salary payments" className="rounded-xl border bg-white p-3 space-y-3">
  <header className="flex flex-wrap justify-between items-center gap-2"><div><h3 className="font-bold">Salary payments</h3><p className="text-xs text-slate-500">Accrued payroll balances and settlements · confidential</p></div><button className={button} onClick={()=>setVersion(v=>v+1)}>Refresh</button></header>
  <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Read-only register. New salary payments remain locked pending accounting verification. Approved but unposted payroll does not appear here.</p>
  {exportError&&<p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{exportError}</p>}
  {error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}
  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{cards.map(([label,value])=><div key={label} className="rounded-lg border bg-slate-50 p-2"><p className="text-xs text-slate-500">{label}</p><strong className="text-sm">{rows?value:'—'}</strong></div>)}</div>
  {reviewCount>0&&<p role="alert" className="text-xs text-amber-800">{reviewCount} payroll record(s) require reconciliation and are excluded from the summary totals.</p>}
  <div className="grid gap-2 sm:grid-cols-3"><label className="text-xs font-semibold">Payroll month<input className={field} type="month" value={period} onChange={e=>{setPeriod(e.target.value);setPage(0);}}/></label><label className="text-xs font-semibold">Employee search<input className={field} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label><label className="text-xs font-semibold">Status<select className={field} value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}>{['all','Unpaid','Partially paid','Settled','Reconciliation required'].map(v=><option key={v} value={v}>{v==='all'?'All statuses':v}</option>)}</select></label></div>
  {!rows?<p className="text-xs text-slate-500">Salary balances not yet confirmed.</p>:<><div className="max-h-[46dvh] overflow-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{['Employee','Month','Net salary (LKR)','Paid','Outstanding','Status','Action'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{filtered.slice(page*15,page*15+15).map(b=><tr key={b.id} className="border-b"><td className="p-2">{b.employee_name}</td><td>{b.period_key}</td><td>{money(b.net_salary)}</td><td>{money(b.paid)}</td><td className="font-semibold">{money(b.outstanding)}</td><td className={b.reconciliation_required?'text-amber-800':''}>{status(b)}</td><td><div className="flex flex-wrap gap-1"><button className={button} onClick={()=>setSelected(b)}>History</button><button className={button} disabled={!!exporting||b.reconciliation_required} onClick={()=>downloadPayslip(b)}>{exporting===b.id?'Preparing…':'Payslip PDF'}</button></div></td></tr>)}</tbody></table>{!filtered.length&&<p className="p-3 text-xs">No matching accrued payroll records.</p>}</div><div className="flex gap-2 items-center text-xs"><span>{filtered.length} records</span><button className={button} disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><button className={button} disabled={(page+1)*15>=filtered.length} onClick={()=>setPage(p=>p+1)}>Next</button></div></>}
  {selected&&<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3"><section role="dialog" aria-modal="true" aria-label="Salary payment history" className="w-full max-w-2xl max-h-[85dvh] overflow-auto rounded-xl bg-white p-4 space-y-3"><header className="flex items-center justify-between gap-2"><div><h3 className="font-bold">{selected.employee_name} · {selected.period_key}</h3><p className="text-xs text-slate-500">Salary payment history</p></div><button className={button} onClick={()=>setSelected(null)}>Close</button></header>
   {selected.reconciliation_required&&<p className="text-xs text-amber-800">Recorded amounts require reconciliation before use.</p>}
   <div className="grid grid-cols-3 gap-2">{[['Net salary',selected.net_salary],['Paid',selected.paid],['Outstanding',selected.outstanding]].map(([label,v])=><div key={label} className="rounded-lg bg-slate-50 p-2"><p className="text-xs">{label}</p><strong className="text-sm">Rs. {money(v)}</strong></div>)}</div>
   {historyError&&<p role="alert" className="text-xs text-rose-700">{historyError}</p>}
   {history===null?<p className="text-xs">Payment history not yet confirmed.</p>:<><div className="max-h-[34dvh] overflow-auto"><table className="w-full min-w-[400px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{['Date','Amount','Status','Action'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{history.slice(historyPage*10,historyPage*10+10).map(p=><tr key={p.id} className="border-b"><td className="p-2">{p.posting_date}</td><td>{money(p.amount)}</td><td>{p.reconciliation_required?'Review required':'Recorded'}</td><td><button className={button} onClick={()=>setDetail(p)}>Details</button></td></tr>)}</tbody></table>{!history.length&&<p className="p-2 text-xs">No recorded payments.</p>}</div><div className="flex gap-2 items-center text-xs"><span>{history.length} payments</span><button className={button} disabled={!historyPage} onClick={()=>{setDetail(null);setHistoryPage(p=>p-1);}}>Previous</button><button className={button} disabled={(historyPage+1)*10>=history.length} onClick={()=>{setDetail(null);setHistoryPage(p=>p+1);}}>Next</button></div></>}
   {detail&&<div className="rounded-lg border p-2 text-xs space-y-1 break-words"><div className="flex justify-between"><strong>Payment evidence</strong><button className={button} onClick={()=>setDetail(null)}>Hide</button></div><p>Account: {detail.financial_account_id}</p><p>Journal: {detail.journal_id}</p><p>Recorded by: {detail.recorded_by}</p><p>Evidence: {detail.evidence}</p></div>}
  </section></div>}
 </section>;
}
