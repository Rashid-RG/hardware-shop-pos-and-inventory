import DisbursementVoucherActions from './DisbursementVoucherActions';
import React,{useEffect,useRef,useState} from 'react';
import {reportDay} from '../utils/reporting';
type Request={requestId:string;returnId:string;chargeKind:string;payer:string;documentReference:string;accountId:string;amount:string;date:string;evidence:string};
type Availability={returnId:string;minimumDate:string;historicalCharges:string;postedLoss:string;recovered:string;categories:{kind:string;allocatedCharges:string;recovered:string;available:string}[];accounts:{id:string;name:string;kind:string}[]};
type History={id:string;charge_kind:string;payer:string;document_reference:string;amount:string;recovery_date:string;account_name:string;evidence:string};
export default function ImportChargeRecovery({returnId,authToken,shopId,owner,canPost,onClose}:{returnId:string;authToken:string;shopId:string;owner:string;canPost:boolean;onClose:()=>void;key?:string}){
 const key='ars:pending-import-recovery:'+JSON.stringify([owner,shopId]);
 const [saved,setSaved]=useState<Request|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[previewError,setPreviewError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
 const [availability,setAvailability]=useState<Availability|null>(null),[history,setHistory]=useState<History[]>([]);
 const [kind,setKind]=useState('Freight'),[payer,setPayer]=useState(''),[reference,setReference]=useState(''),[account,setAccount]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(reportDay(new Date())),[evidence,setEvidence]=useState('');
 const lock=useRef(false);
 useEffect(()=>{setReady(false);setSaved(null);if(!canPost)return;try{const stored=JSON.parse(localStorage.getItem(key)||'null');if(stored&&(!stored.requestId||!stored.returnId))throw Error('Invalid saved request');setSaved(stored);setReady(true);}catch{setError('Cannot read saved recovery request. Check browser storage.');}},[key,canPost]);
 const activeId=saved?.returnId||returnId;
 useEffect(()=>{const controller=new AbortController();setAvailability(null);setHistory([]);setPreviewError('');setLoading(true);
 const url='/api/ledger/import-charge-recoveries/'+encodeURIComponent(activeId);
 const load=async(path:string)=>{const response=await fetch(path,{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load recovery information.');return data;};
 Promise.allSettled([load(url),load(url+'/availability')]).then(([h,a])=>{if(controller.signal.aborted)return;if(h.status==='fulfilled'&&Array.isArray(h.value))setHistory(h.value);else setError('Unable to load recovery history.');if(a.status==='fulfilled'&&a.value.returnId===activeId&&Array.isArray(a.value.categories)&&Array.isArray(a.value.accounts))setAvailability(a.value);else setPreviewError(a.status==='rejected'&&a.reason instanceof Error?a.reason.message:'Recovery availability unavailable.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
 return()=>controller.abort();},[activeId,authToken,shopId,version]);
 const available=availability?.categories.find(c=>c.kind===kind);
 async function post(request:Request){if(lock.current||!canPost||!ready)return;lock.current=true;setBusy(true);setError('');
 try{const response=await fetch('/api/ledger/import-charge-recoveries',{method:'POST',headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId,'Content-Type':'application/json'},body:JSON.stringify(request)});const result=await response.json();if(!response.ok||result.id!==request.requestId)throw Error(result.error||'Recovery not confirmed.');localStorage.removeItem(key);setSaved(null);setAmount('');setPayer('');setReference('');setEvidence('');setAccount('');setVersion(v=>v+1);}
 catch(e){setError((e instanceof Error?e.message:'Recovery not confirmed.')+' Saved request retained. Retry the same request or reconcile with an administrator.');}finally{lock.current=false;setBusy(false);}}
 async function submit(event:React.FormEvent){event.preventDefault();if(!canPost||!ready||saved||lock.current||loading||!availability||availability.returnId!==activeId)return;
 if(!available||!/^\d{1,12}(\.\d{1,2})?$/.test(amount)||Number(amount)<=0||Number(amount)>Number(available.available)||!availability.accounts.some(a=>a.id===account)||!payer.trim()||!reference.trim()||!evidence.trim()||!date||date<availability.minimumDate||date>reportDay(new Date())){setError('Enter a valid recovery amount, payer, document, date and destination.');return;}
 if(!window.confirm('Confirm that the import charge recovery was actually received into the selected account?'))return;
 const request={requestId:crypto.randomUUID(),returnId:activeId,chargeKind:kind,payer:payer.trim(),documentReference:reference.trim(),accountId:account,amount,date,evidence:evidence.trim()};
 try{localStorage.setItem(key,JSON.stringify(request));}catch{setError('Cannot safely save recovery request. Nothing posted.');return;}setSaved(request);await post(request);}
 const field='block w-full rounded border p-2 text-sm';
 return <section className="rounded-xl border bg-white p-4 space-y-3" aria-label="Import charge recovery">
 <div className="flex justify-between"><div><h3 className="font-semibold">Import charge recovery</h3><p className="text-xs text-slate-600">Purchase return {activeId}</p></div><button type="button" disabled={busy} onClick={onClose} className="text-sm underline">Close</button></div>
 {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 {saved&&canPost&&<div className="rounded border p-3"><p className="text-sm">Saved recovery: {saved.chargeKind} · Rs. {saved.amount} · {saved.requestId}. Retry this exact request only.</p><button type="button" disabled={busy||!ready} onClick={()=>void post(saved)} className="rounded bg-slate-900 text-white px-3 py-2 disabled:opacity-50">Retry saved recovery</button></div>}
 {loading?<p role="status">Loading recovery information…</p>:<>
 {previewError&&<p role="alert" className="text-sm text-amber-800">{previewError}</p>}
 {availability&&<><div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">{[['Historical charges',availability.historicalCharges],['Posted return loss',availability.postedLoss],['Already recovered',availability.recovered]].map(([label,value])=><div key={label} className="rounded border p-2">{label}<p className="font-semibold">Rs. {value}</p></div>)}</div>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">{availability.categories.map(c=><div key={c.kind} className="rounded border p-2 text-xs"><p className="font-semibold">{c.kind}</p><p>Allocated: Rs. {c.allocatedCharges}</p><p>Recovered: Rs. {c.recovered}</p><p className="font-semibold">Available: Rs. {c.available}</p></div>)}</div>
 {canPost&&!saved&&<form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <label className="text-sm">Charge category<select className={field} value={kind} onChange={e=>setKind(e.target.value)}>{availability.categories.map(c=><option key={c.kind} value={c.kind}>{c.kind} — Rs. {c.available}</option>)}</select></label>
 <label className="text-sm">Amount received (LKR)<input className={field} required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
 <label className="text-sm">Payer<input className={field} required maxLength={200} value={payer} onChange={e=>setPayer(e.target.value)}/></label>
 <label className="text-sm">Document reference<input className={field} required maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}/></label>
 <label className="text-sm">Cash or bank destination<select className={field} required value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select account</option>{availability.accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.kind}</option>)}</select></label>
 <label className="text-sm">Received date<input className={field} required type="date" min={availability.minimumDate} max={reportDay(new Date())} value={date} onChange={e=>setDate(e.target.value)}/></label>
 <label className="text-sm sm:col-span-2">Receipt evidence<input className={field} required maxLength={500} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
 <p className="text-xs text-slate-600 sm:col-span-2">Record actual cash or bank receipts only, not expected claims.</p>
 <button disabled={busy||!ready||!availability.accounts.length||!available||Number(available.available)<=0} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Confirm recovery</button></form>}</>}
 <h4 className="font-semibold text-sm">Recovery history</h4>{history.length?history.map(h=><div key={h.id} className="rounded border p-2 text-sm"><p className="font-semibold">{h.charge_kind} · Rs. {h.amount} · {h.recovery_date}</p><p>{h.payer} · {h.document_reference} · {h.account_name}</p><p>{h.evidence}</p><DisbursementVoucherActions kind="import-recovery" id={h.id} authToken={authToken} shopId={shopId}/></div>):<p className="text-xs text-slate-600">No recovery records loaded.</p>}</>}
 </section>;
}
