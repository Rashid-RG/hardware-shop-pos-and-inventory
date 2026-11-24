import React,{useEffect,useRef,useState} from 'react';
import {reportDay} from '../utils/reporting';
type Account={id:string;name:string;kind:string;active:boolean;balance:number};
type RecordRow={id:string;accountId:string;accountName:string;effectiveDate:string;expectedAmount:number;observedAmount:number;variance:number;reference:string;note?:string;recordedBy:string;recordedAt:string};
type Request={requestId:string;accountId:string;effectiveDate:string;observedAmount:number;reference:string;note:string};
const money=(n:number)=>n.toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
const field='w-full rounded-lg border border-slate-300 p-2 text-sm';
const btn='rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50';
export default function FinancialReconciliationPanel({authToken,shopId,owner}:{authToken:string;shopId:string;owner?:string}){
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [rows,setRows]=useState<RecordRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [version,setVersion]=useState(0);
  const [open,setOpen]=useState(false);
  const [accountId,setAccountId]=useState('');
  const [observed,setObserved]=useState('');
  const [reference,setReference]=useState('');
  const [note,setNote]=useState('');
  const [filter,setFilter]=useState('All');
  const [accountFilter,setAccountFilter]=useState('');
  const [pending,setPending]=useState<Request|null>(null);
  const [ready,setReady]=useState(false);
  const lock=useRef(false);
  const key='ars:pending-reconciliation:'+JSON.stringify([owner||'',shopId]);
  const today=reportDay(new Date());
  const headers={Authorization:'Bearer '+authToken,'X-Shop-Id':shopId,'Content-Type':'application/json'};
  useEffect(()=>{
    setReady(false);setPending(null);setOpen(false);setAccountFilter('');setError('');setMessage('');
    if(!owner)return;
    try{const raw=localStorage.getItem(key);setPending(raw?JSON.parse(raw):null);setReady(true);}
    catch{setError('Cannot read saved reconciliation request. Check browser storage.');}
  },[key,owner]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setAccounts([]);setRows([]);
    const load=async(path:string)=>{const r=await fetch(path,{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},cache:'no-store',signal:controller.signal});const data=await r.json();if(!r.ok||!Array.isArray(data))throw Error(data.error||'Unable to load reconciliation data.');return data;};
    Promise.all([load('/api/financial-accounts'),load('/api/financial-reconciliations')]).then(([a,r])=>{if(!controller.signal.aborted){setAccounts(a);setRows(r);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[authToken,shopId,version]);
  const eligible=accounts.filter(a=>a.active&&['Office Cash','Bank','Representative Cash'].includes(a.kind));
  const account=eligible.find(a=>a.id===accountId);
  const amount=Number(observed);
  const valid=observed.trim()!==''&&Number.isFinite(amount)&&Math.abs(amount)<=999999999999.99&&Math.abs(amount*100-Math.round(amount*100))<=0.001&&(account?.kind==='Bank'||amount>=0);
  const variance=account&&valid?Math.round(amount*100-account.balance*100)/100:null;
  const visible=rows.filter(r=>(!accountFilter||r.accountId===accountFilter)&&(filter==='All'||(filter==='Matched'?r.variance===0:filter==='Shortage'?r.variance<0:r.variance>0)));
  function start(){setAccountId('');setObserved('');setReference('');setNote('');setError('');setMessage('');setVersion(v=>v+1);setOpen(true);}
  async function send(request:Request){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setMessage('');
    try{
      const r=await fetch('/api/financial-reconciliations',{method:'POST',headers,body:JSON.stringify(request)});
      const data=await r.json();
      if(!r.ok){
        // Only clear requests rejected by validation before a commit. Ambiguous responses retain the original identifier.
        if(r.status===400||(r.status===409&&['Invalid reconciliation details.','Select an active cash or bank account in this shop.','Counted cash cannot be negative.','Explain the discrepancy before saving.','New reconciliations must use the current business date.'].includes(data.error))){localStorage.removeItem(key);setPending(null);}
        throw Error(data.error||'Unable to confirm reconciliation.');
      }
      localStorage.removeItem(key);setPending(null);setOpen(false);setVersion(v=>v+1);
      setMessage('Reconciliation saved. Recorded difference: Rs. '+money(Number(data.variance))+'. No ledger adjustment made.');
    }catch(e){setError(e instanceof Error?e.message:'Unable to confirm reconciliation. Retry the saved request.');}
    finally{lock.current=false;setBusy(false);}
  }
  async function save(e:React.FormEvent){
    e.preventDefault();if(!ready||pending||busy||lock.current||loading)return;
    if(!account||!valid||!reference.trim()||(variance!==0&&!note.trim()))return setError('Select an account, enter a valid actual balance and reference, and explain any discrepancy.');
    const request={requestId:crypto.randomUUID(),accountId,effectiveDate:today,observedAmount:amount,reference:reference.trim(),note:note.trim()};
    try{localStorage.setItem(key,JSON.stringify(request));}catch{return setError('Cannot safely preserve reconciliation request.');}
    setPending(request);await send(request);
  }
  return <section className="rounded-xl border bg-white p-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-lg font-semibold">Financial reconciliation</h3><p className="text-xs text-slate-500">Compare counted cash or bank balances with recorded funds. No automatic adjustment.</p></div><div className="flex gap-2"><button type="button" className="rounded border px-3 py-2 text-sm" disabled={loading||busy} onClick={()=>setVersion(v=>v+1)}>Refresh</button><button type="button" className={btn} disabled={loading||busy||!ready||!!pending||!eligible.length} onClick={start}>New reconciliation</button></div></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{[{label:'Recorded checks',value:rows.length},{label:'Matched',value:rows.filter(r=>r.variance===0).length},{label:'Shortages',value:rows.filter(r=>r.variance<0).length},{label:'Surpluses',value:rows.filter(r=>r.variance>0).length}].map(x=><div key={x.label} className="rounded-lg border p-3"><span className="block text-xs text-slate-500">{x.label}</span><strong className="text-lg">{x.value}</strong></div>)}</div>
    <p className="text-xs text-slate-500">Counts cover the latest 500 checks, not unresolved balances. Repeated checks may describe the same discrepancy.</p>
    {pending&&<div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm"><strong>Unconfirmed reconciliation</strong><p>{pending.effectiveDate} · {pending.reference} · Rs. {money(pending.observedAmount)}</p><button type="button" className={btn} disabled={busy} onClick={()=>void send(pending)}>Retry exact request</button></div>}
    {message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}{error&&!open&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2"><select aria-label="Filter account" className="rounded border p-2 text-sm" value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}><option value="">All accounts</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><select aria-label="Filter discrepancy" className="rounded border p-2 text-sm" value={filter} onChange={e=>setFilter(e.target.value)}>{['All','Matched','Shortage','Surplus'].map(s=><option key={s}>{s}</option>)}</select></div>
    {loading?<p>Loading reconciliation history…</p>:<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Date / account','Expected (LKR)','Actual (LKR)','Difference (LKR)','Reference / explanation','Recorded by'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{visible.map(r=><tr key={r.id} className="border-t"><td className="p-2">{r.effectiveDate}<div className="font-medium">{r.accountName}</div></td><td className="p-2 tabular-nums">{money(r.expectedAmount)}</td><td className="p-2 tabular-nums">{money(r.observedAmount)}</td><td className={'p-2 font-semibold '+(r.variance===0?'text-emerald-700':'text-red-700')}>{money(r.variance)}</td><td className="p-2 break-words">{r.reference}<div className="text-xs text-slate-600">{r.note}</div></td><td className="p-2">{r.recordedBy}</td></tr>)}</tbody></table>{!visible.length&&<p className="p-3 text-sm text-slate-500">No matching reconciliation records.</p>}</div>}
    {open&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><form role="dialog" aria-modal="true" aria-label="New reconciliation" className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-xl bg-white p-5 space-y-3" onSubmit={save}><h4 className="text-lg font-semibold">New reconciliation</h4><p className="text-sm">Business date: {today}</p><label className="block text-sm">Account<select required className={field} value={accountId} onChange={e=>{setAccountId(e.target.value);setObserved('');}}><option value="">Select account</option>{eligible.map(a=><option key={a.id} value={a.id}>{a.name} · {a.kind}</option>)}</select></label>
    <p className="text-sm">Indicative recorded balance: <strong>{account?'Rs. '+money(account.balance):'—'}</strong></p><label className="block text-sm">{account?.kind==='Bank'?'Verified bank balance (LKR)':'Counted cash (LKR)'}<input required type="number" step="0.01" min={account?.kind==='Bank'?undefined:0} className={field} value={observed} onChange={e=>setObserved(e.target.value)}/></label><p className="text-sm">Estimated difference: <strong>{variance===null?'—':'Rs. '+money(variance)}</strong></p><p className="text-xs text-slate-500">The server calculates the final expected balance at the time of saving. Recorded balances may exclude historical or unallocated collections.</p><label className="block text-sm">Count / statement reference *<input required maxLength={200} className={field} value={reference} onChange={e=>setReference(e.target.value)}/></label><label className="block text-sm">Discrepancy explanation<textarea required={variance!==null&&variance!==0} maxLength={500} className={field} value={note} onChange={e=>setNote(e.target.value)}/></label>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={()=>setOpen(false)}>Close</button><button type="submit" className={btn} disabled={busy||loading||!!pending||!ready}> {busy?'Saving…':'Save comparison'}</button></div></form></div>}
  </section>;
}
