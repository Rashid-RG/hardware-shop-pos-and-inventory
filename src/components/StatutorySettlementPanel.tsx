import React,{useEffect,useState} from 'react';
import {reportDay} from '../utils/reporting';
type Fund='EPF'|'ETF';
type Summary={fund:Fund;employee_count:number;exception_count:number;employee_contribution:string|null;employer_contribution:string|null;liability:string|null;settled:string|null;outstanding:string|null};
type Allocation={accrualId:string;employeeName:string;period:string;fund:Fund;employeeContribution:string;employerContribution:string;liability:string;settled:string;outstanding:string|null;reconciliationRequired:boolean};
type Payment={id:string;employee_name:string;period_key:string;fund:Fund;bank_name:string|null;financial_account_id:string;amount:string;posting_date:string;receipt_reference:string;evidence:string;journal_id:string;recorded_by:string;reconciliation_required:boolean};
type Register={period:string;summary:Summary[];allocations:Allocation[];postingEnabled:false};
const button='rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50';
const field='w-full rounded-lg border border-slate-300 p-2 text-sm';
const money=(v:string|null)=>v===null?'—':v.replace(/\B(?=(\d{3})+(?!\d))/g,',');
const validAmount=(v:unknown)=>typeof v==='string'&&/^\d+(\.\d{1,2})?$/.test(v);
const fund=(v:unknown)=>v==='EPF'||v==='ETF';
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export default function StatutorySettlementPanel({shopId,authToken}:{shopId:string;authToken:string}){
 const [period,setPeriod]=useState(reportDay(new Date()).slice(0,7)),[version,setVersion]=useState(0),[view,setView]=useState<'balances'|'history'>('balances');
 const [filter,setFilter]=useState<'all'|Fund>('all'),[search,setSearch]=useState(''),[reviewOnly,setReviewOnly]=useState(false),[page,setPage]=useState(0);
 const [loaded,setLoaded]=useState<{key:string;register:Register;history:Payment[]}|null>(null),[failure,setFailure]=useState<{key:string;message:string}|null>(null),[detail,setDetail]=useState<Payment|null>(null);
 const key=JSON.stringify([shopId,authToken,period,version]);
 const current=loaded?.key===key?loaded:null,error=failure?.key===key?failure.message:'';
 useEffect(()=>{const c=new AbortController();setPage(0);setDetail(null);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)){setFailure({key,message:'Select a valid payroll month.'});return()=>c.abort();}
  const base='/api/ars/payroll/statutory-settlements',query='?'+new URLSearchParams({period}),headers={Authorization:'Bearer '+authToken,'X-Shop-Id':shopId};
  const read=async(path:string)=>{const r=await fetch(path,{headers,cache:'no-store',signal:c.signal});const d=await r.json();if(!r.ok)throw Error(typeof d?.error==='string'?d.error:'Unable to load statutory register.');return d;};
  Promise.all([read(base+'/balances'+query),read(base+query)]).then(([r,h])=>{
   if(!r||r.period!==period||r.postingEnabled!==false||!Array.isArray(r.summary)||r.summary.length!==2||new Set(r.summary.map((s:Summary)=>s?.fund)).size!==2||r.summary.some((s:Summary)=>!s||!fund(s.fund)||!count(s.employee_count)||!count(s.exception_count)||![s.employee_contribution,s.employer_contribution,s.liability,s.settled,s.outstanding].every(v=>s.exception_count>0?v===null:validAmount(v)))||!Array.isArray(r.allocations)||r.allocations.some((a:Allocation)=>!a||a.period!==period||!fund(a.fund)||typeof a.accrualId!=='string'||typeof a.employeeName!=='string'||typeof a.reconciliationRequired!=='boolean'||(a.reconciliationRequired?a.outstanding!==null:![a.employeeContribution,a.employerContribution,a.liability,a.settled,a.outstanding].every(validAmount)))||!Array.isArray(h)||h.some((p:Payment)=>!p||p.period_key!==period||!fund(p.fund)||typeof p.id!=='string'||typeof p.employee_name!=='string'||typeof p.receipt_reference!=='string'||typeof p.reconciliation_required!=='boolean'||!validAmount(p.amount)))throw Error('Statutory register response could not be verified.');
   if(!c.signal.aborted)setLoaded({key,register:r,history:h});
  }).catch(e=>{if(!c.signal.aborted)setFailure({key,message:e.message});});
  return()=>c.abort();
 },[key,period,shopId,authToken]);
 const matches=(name:string,f:Fund,review:boolean,reference='')=>(filter==='all'||f===filter)&&(!reviewOnly||review)&&(name+' '+reference).toLowerCase().includes(search.trim().toLowerCase());
 const rows=(current?.register.allocations||[]).filter(a=>matches(a.employeeName,a.fund,a.reconciliationRequired));
 const history=(current?.history||[]).filter(p=>matches(p.employee_name,p.fund,p.reconciliation_required,p.receipt_reference));
 const total=view==='balances'?rows.length:history.length;
 const selected=detail&&current?.history.some(p=>p.id===detail.id)?detail:null;
 const cell=(v:string|null,review:boolean)=>review?'Review required':money(v);
 return <section aria-label="Statutory settlements" className="rounded-xl border bg-white p-3 space-y-3">
  <header className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">EPF / ETF settlements</h3><p className="text-xs text-slate-500">Monthly posted liabilities · confidential · LKR</p></div><button className={button} onClick={()=>setVersion(v=>v+1)}>Refresh</button></header>
  <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Read-only until accounting acceptance. Unposted payroll is not included. No payment can be submitted here.</p>
  <div className="flex flex-wrap items-end gap-2"><label className="text-xs font-semibold">Payroll month<input className={field} type="month" value={period} onChange={e=>{setPeriod(e.target.value);setPage(0);setDetail(null);}}/></label><button className={button} disabled title="Posting is locked pending verification">Record remittance (locked)</button></div>
  {error?<p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</p>:!current?<p role="status" className="text-xs text-slate-500">Loading statutory register…</p>:<>
   <div className="grid gap-2 md:grid-cols-2">{current.register.summary.map(s=><article key={s.fund} className="rounded-xl border bg-slate-50 p-3 space-y-2"><div className="flex justify-between items-center"><strong>{s.fund}</strong><span className="text-xs text-slate-600">{s.employee_count} payroll records</span></div>
    {s.exception_count>0?<p role="alert" className="text-xs text-amber-900">{s.exception_count} records require reconciliation. Verified totals withheld.</p>:<><p className="text-xs text-slate-500">Outstanding</p><p className="text-xl font-bold tabular-nums">Rs. {money(s.outstanding)}</p><div className="grid grid-cols-2 gap-2 text-xs">{[['Total liability',s.liability],['Settled',s.settled],['Employee',s.employee_contribution],['Employer',s.employer_contribution]].map(([label,value])=><div key={label}><p className="text-slate-500">{label}</p><strong>{money(value)}</strong></div>)}</div></>}
   </article>)}</div>
   <nav aria-label="Statutory register views" className="flex gap-2">{(['balances','history'] as const).map(v=><button key={v} aria-pressed={view===v} className={button+' '+(view===v?'bg-slate-900 text-white':'')} onClick={()=>{setView(v);setPage(0);setDetail(null);}}>{v==='balances'?'Employee contributions':'Settlement history'}</button>)}</nav>
   <div className="grid gap-2 sm:grid-cols-3"><label className="text-xs font-semibold">Search<input className={field} value={search} placeholder={view==='history'?'Employee or receipt':'Employee name'} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label><label className="text-xs font-semibold">Fund<select className={field} value={filter} onChange={e=>{setFilter(e.target.value as 'all'|Fund);setPage(0);}}><option value="all">All funds</option><option>EPF</option><option>ETF</option></select></label><label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" checked={reviewOnly} onChange={e=>{setReviewOnly(e.target.checked);setPage(0);}}/>Needs reconciliation only</label></div>
   <div className="max-h-[42dvh] overflow-auto rounded-lg border"><table className="w-full min-w-[700px] text-xs text-left"><thead className="sticky top-0 bg-slate-100"><tr>{(view==='balances'?['Employee','Fund','Employee share','Employer share','Liability','Settled','Outstanding']:['Employee','Fund','Date','Receipt','Bank','Amount','Status','Action']).map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{view==='balances'?rows.slice(page*12,page*12+12).map(a=><tr className="border-b" key={a.accrualId+':'+a.fund}><td className="p-2">{a.employeeName}</td><td>{a.fund}</td><td>{cell(a.employeeContribution,a.reconciliationRequired)}</td><td>{cell(a.employerContribution,a.reconciliationRequired)}</td><td>{cell(a.liability,a.reconciliationRequired)}</td><td>{cell(a.settled,a.reconciliationRequired)}</td><td className="font-semibold">{cell(a.outstanding,a.reconciliationRequired)}</td></tr>):history.slice(page*12,page*12+12).map(p=><tr className="border-b" key={p.id}><td className="p-2">{p.employee_name}</td><td>{p.fund}</td><td>{p.posting_date}</td><td>{p.receipt_reference}</td><td>{p.bank_name||p.financial_account_id}</td><td>{money(p.amount)}</td><td>{p.reconciliation_required?'Review required':'Recorded'}</td><td><button className={button} onClick={()=>setDetail(p)}>Details</button></td></tr>)}</tbody></table>{!total&&<p className="p-3 text-xs text-slate-600">No matching posted records for this month.</p>}</div>
   <div className="flex items-center gap-2 text-xs"><span>{total} records</span><button className={button} disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><button className={button} disabled={(page+1)*12>=total} onClick={()=>setPage(p=>p+1)}>Next</button></div>
  </>}
  {selected&&<div className="rounded-lg border bg-slate-50 p-3 space-y-1 text-xs break-words"><div className="flex items-center justify-between"><strong>Settlement evidence · {selected.receipt_reference}</strong><button className={button} onClick={()=>setDetail(null)}>Close</button></div><p>Journal: {selected.journal_id}</p><p>Recorded by: {selected.recorded_by}</p><p>Bank account: {selected.financial_account_id}</p><p>Evidence: {selected.evidence}</p></div>}
 </section>;
}
