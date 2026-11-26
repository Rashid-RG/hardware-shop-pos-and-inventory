import React,{useEffect,useState} from 'react';
import {reportDay} from '../utils/reporting';
type Props={authToken:string;shopId:string;partners:{id:string;name:string;is_active:boolean}[]};
type Statement={partner:{id:string;name:string};fromDate:string;toDate:string;total:number;opening:string;contributions:string;drawings:string;closing:string;posted:number;historical:number;review:number;basis:string;rows:{id:string;day:string;entry_type:string;amount:string;running_balance:string;reference:string;posting_status:string;financial_account_name:string|null;latest_review:string|null;journal_id:string|null}[]};
const money=(v:string)=>Number(v).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
const field='w-full rounded-lg border border-slate-200 p-2 text-sm';
export default function PartnerStatementPanel({authToken,shopId,partners}:Props){
 const today=reportDay(new Date());
 const [partner,setPartner]=useState(''),[from,setFrom]=useState(today.slice(0,7)+'-01'),[to,setTo]=useState(today);
 const [offset,setOffset]=useState(0),[revision,setRevision]=useState(0),[data,setData]=useState<Statement|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const limit=50;
 useEffect(()=>{
  setData(null);setError('');setBusy(false);
  if(!partner||!from||!to||from>to||to>today)return;
  const c=new AbortController();setBusy(true);
  const query=new URLSearchParams({fromDate:from,toDate:to,offset:String(offset),limit:String(limit)});
  fetch('/api/ars/partners/'+encodeURIComponent(partner)+'/capital-statement?'+query,{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},cache:'no-store',signal:c.signal}).then(async r=>{
    const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to load partner statement.');
    if(d.partner?.id!==partner||d.fromDate!==from||d.toDate!==to||!Array.isArray(d.rows)||!Number.isSafeInteger(d.total))throw Error('Statement response could not be verified.');
    if(!c.signal.aborted)setData(d);
  }).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
  return()=>c.abort();
 },[authToken,shopId,partner,from,to,offset,revision]);
 return <section aria-label="Individual partner statement" className="rounded-xl border bg-white p-3 space-y-3">
  <header className="flex justify-between items-center"><div><h3 className="font-bold">Partner capital statement</h3><p className="text-xs text-slate-500">Confidential · recorded capital, not reconciled equity or profit entitlement.</p></div><button type="button" className="rounded border px-3 py-2 text-xs" disabled={busy||!partner} onClick={()=>setRevision(v=>v+1)}>Refresh</button></header>
  <div className="grid gap-2 sm:grid-cols-3"><label className="text-xs font-semibold">Partner<select className={field} value={partner} onChange={e=>{setPartner(e.target.value);setOffset(0);}}><option value="">Choose partner</option>{partners.map(p=><option key={p.id} value={p.id}>{p.name}{p.is_active?'':' (inactive)'}</option>)}</select></label>
  <label className="text-xs font-semibold">From<input className={field} type="date" max={to} value={from} onChange={e=>{setFrom(e.target.value);setOffset(0);}}/></label><label className="text-xs font-semibold">To<input className={field} type="date" min={from} max={today} value={to} onChange={e=>{setTo(e.target.value);setOffset(0);}}/></label></div>
  {(!from||!to||from>to||to>today)&&<p role="alert" className="text-xs text-rose-700">Choose a valid date range ending no later than today.</p>}
  {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}{busy&&<p role="status" className="text-sm">Loading statement…</p>}
  {data&&<><div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{[['Opening recorded capital',data.opening],['Contributions',data.contributions],['Drawings',data.drawings],['Closing recorded capital',data.closing]].map(([label,value])=><div key={label} className="rounded-lg border bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="font-bold text-sm">Rs. {money(value)}</p></div>)}</div>
  <p className="text-xs text-slate-600">{data.posted} posted · {data.historical} historical · {data.review} require review. Counts cover the selected period, not just this page.</p>
  <div className="max-h-[52dvh] overflow-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{['Date','Type','Amount (LKR)','Running balance','Status','Account / journal','Reference'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{data.rows.map(r=><tr key={r.id} className="border-b"><td className="p-2 whitespace-nowrap">{r.day}</td><td>{r.entry_type}</td><td>{r.entry_type==='Drawing'?'-':'+'}{money(r.amount)}</td><td>{money(r.running_balance)}</td><td>{r.posting_status}{r.latest_review&&<p className="text-slate-500">{r.latest_review}</p>}</td><td>{r.financial_account_name||'—'}<p className="break-all text-slate-500">{r.journal_id||'—'}</p></td><td>{r.reference}</td></tr>)}</tbody></table>{!data.rows.length&&<p className="p-3 text-xs text-slate-500">No entries in this period.</p>}</div>
  <div className="flex items-center gap-2 text-xs"><span>{data.total?offset+1:0}–{Math.min(offset+data.rows.length,data.total)} of {data.total}</span><button type="button" className="rounded border p-2 disabled:opacity-50" disabled={busy||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-limit))}>Previous</button><button type="button" className="rounded border p-2 disabled:opacity-50" disabled={busy||offset+limit>=data.total} onClick={()=>setOffset(v=>v+limit)}>Next</button></div><p className="text-xs text-slate-500">{data.basis}</p></>}
 </section>;
}
