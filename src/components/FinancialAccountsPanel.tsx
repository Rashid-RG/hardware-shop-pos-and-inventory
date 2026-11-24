import React, { useEffect, useState, useRef } from 'react';
import { reportDay } from '../utils/reporting';

const kinds = ['Office Cash', 'Bank', 'Representative Cash', 'Settlement'] as const;
type TransferRequest = {requestId:string;fromAccountId:string;toAccountId:string;amount:number;effectiveDate:string;note:string;handover?:boolean};
type Account = {id:string;name:string;kind:typeof kinds[number];active:boolean;balance:number};
const money = (n:number) => n.toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
const field = 'w-full rounded-lg border border-slate-300 p-2 text-sm';
const button = 'rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';

export default function FinancialAccountsPanel({authToken,shopId,owner}:{authToken:string;shopId:string;owner?:string}){
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [mode,setMode]=useState<'create'|'opening'|'transfer'|'handover'|null>(null);
  const [name,setName]=useState('');
  const [kind,setKind]=useState<typeof kinds[number]>('Office Cash');
  const [accountId,setAccountId]=useState('');
  const [amount,setAmount]=useState('');
  const [date,setDate]=useState(reportDay(new Date()));
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const [toAccountId,setToAccountId]=useState('');
  const transferKey='ars:pending-transfer:'+JSON.stringify([owner||'',shopId]);
  const [pendingTransfer,setPendingTransfer]=useState<TransferRequest|null>(null);
  const [storageReady,setStorageReady]=useState(false);
  const transferLock=useRef(false);
  useEffect(()=>{
    setMode(null);setPendingTransfer(null);setStorageReady(false);
    if(!owner)return;
    try{setPendingTransfer(JSON.parse(localStorage.getItem(transferKey)||'null'));setStorageReady(true);}
    catch{setError('Cannot read saved transfer requests. Check browser storage.');}
  },[transferKey,owner]);
  const eligible=accounts.filter(a=>a.active&&a.kind!=='Settlement');
  const handoverSources=eligible.filter(a=>a.kind==='Representative Cash');
  const handoverTargets=eligible.filter(a=>a.kind==='Office Cash');
  const isHandover=mode==='handover';
  const isTransfer=mode==='transfer'||isHandover;
  async function submitTransfer(request:TransferRequest){
    if(transferLock.current)return;
    transferLock.current=true;setBusy(true);setError('');setMessage('');
    try{
      const r=await fetch('/api/financial-transfers',{method:'POST',headers,body:JSON.stringify(request)});
      const data=await r.json();
      if(!r.ok)throw Error(data.error||'Unable to confirm transfer.');
      localStorage.removeItem(transferKey);setPendingTransfer(null);setMode(null);
      setMessage('Transfer confirmed.');setRevision(x=>x+1);
    }catch(e){setError((e instanceof Error?e.message:'Unable to confirm transfer.')+' Review the saved request before retrying.');}
    finally{transferLock.current=false;setBusy(false);}
  }
  const headers={'Authorization':'Bearer '+authToken,'X-Shop-Id':shopId,'Content-Type':'application/json'};
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setAccounts([]);
    fetch('/api/financial-accounts',{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},signal:controller.signal,cache:'no-store'})
      .then(async r=>{const data=await r.json();if(!r.ok||!Array.isArray(data))throw Error(data.error||'Unable to load accounts.');return data as Account[];})
      .then(data=>{if(!controller.signal.aborted)setAccounts(data);})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message||'Unable to load accounts.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[authToken,shopId,revision]);
  function open(next:'create'|'opening'|'transfer'|'handover',id=''){
    setError('');setMessage('');setName('');setKind('Office Cash');setAccountId(id);setAmount('');setNote('');setDate(reportDay(new Date()));setToAccountId('');setMode(next);
  }
  async function save(e:React.FormEvent){
    e.preventDefault();if(busy||!mode)return;
    if(isTransfer){
      if(!storageReady||pendingTransfer||transferLock.current)return;
      const source=eligible.find(a=>a.id===accountId);
      const target=eligible.find(a=>a.id===toAccountId);
      const value=Number(amount);
      if(!source||!target||source.id===target.id||!Number.isFinite(value)||value<=0||value>source.balance){setError('Select two different accounts and an amount within the recorded source balance.');return;}
      if(isHandover&&(source.kind!=='Representative Cash'||target.kind!=='Office Cash'||!note.trim()||note.trim().length>460)){setError('Select representative cash and office cash accounts, and enter a handover reference.');return;}
      const request={handover:isHandover,requestId:crypto.randomUUID(),fromAccountId:source.id,toAccountId:target.id,amount:value,effectiveDate:reportDay(new Date()),note};
      try{localStorage.setItem(transferKey,JSON.stringify(request));}catch{setError('Cannot safely preserve transfer request.');return;}
      setPendingTransfer(request);
      await submitTransfer(request);return;
    }
    const opening=mode==='opening';
    if(opening&&(!accountId||!amount.trim()||!Number.isFinite(Number(amount))||Number(amount)===0)){setError('Enter a nonzero opening amount.');return;}
    setBusy(true);setError('');setMessage('');
    try{
      const url='/api/financial-accounts'+(opening?'/'+encodeURIComponent(accountId)+'/opening-balance':'');
      const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(opening?{amount:Number(amount),effectiveDate:date,note}:{name:name.trim(),kind})});
      const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to save.');
      setMode(null);setMessage(opening?'Opening balance registered.':'Financial account created.');setRevision(x=>x+1);
    }catch(e){setError(e instanceof Error?e.message:'Unable to save. Refresh accounts before retrying.');}
    finally{setBusy(false);}
  }
  return <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Financial accounts</h3><p className="text-xs text-slate-500">Recorded ledger balances only. Historical and unallocated collections may not be included.</p></div><div className="flex gap-2"><button type="button" className="rounded-lg border px-3 py-2 text-sm" disabled={loading||busy} onClick={()=>setRevision(x=>x+1)}>Refresh</button><button type="button" className={button} disabled={loading||busy} onClick={()=>open('create')}>New account</button><button type="button" className={button} disabled={loading||busy||!storageReady||!!pendingTransfer||eligible.length<2} onClick={()=>open('transfer')}>Transfer funds</button><button type="button" className={button} disabled={loading||busy||!storageReady||!!pendingTransfer||!handoverSources.length||!handoverTargets.length} onClick={()=>open('handover')}>Confirm cash handover</button></div></div>
    {pendingTransfer&&<div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm"><strong>Saved transfer awaiting confirmation</strong><p>Rs. {money(pendingTransfer.amount)} · {pendingTransfer.effectiveDate}</p><p>From: {accounts.find(a=>a.id===pendingTransfer.fromAccountId)?.name||pendingTransfer.fromAccountId} · To: {accounts.find(a=>a.id===pendingTransfer.toAccountId)?.name||pendingTransfer.toAccountId}</p><button type="button" disabled={busy} className={button} onClick={()=>void submitTransfer(pendingTransfer)}>Retry exact transfer</button></div>}
    {message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
    {error&&!mode&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {loading?<p className="text-sm">Loading financial accounts…</p>:<div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-slate-50"><tr><th className="p-2">Account</th><th className="p-2">Type</th><th className="p-2 text-right">Ledger balance (Rs.)</th><th className="p-2">Status</th><th className="p-2">Action</th></tr></thead><tbody>{accounts.map(a=><tr key={a.id} className="border-t"><td className="p-2 font-medium">{a.name}</td><td className="p-2">{a.kind}</td><td className="p-2 text-right tabular-nums">{money(a.balance)}</td><td className="p-2">{a.active?'Active':'Inactive'}</td><td className="p-2">{a.active&&a.balance===0&&<button type="button" className="rounded border px-2 py-1" disabled={busy} onClick={()=>open('opening',a.id)}>Opening balance</button>}</td></tr>)}</tbody></table>{!accounts.length&&!error&&<p className="p-4 text-sm text-slate-500">No accounts yet. Create an office cash or bank account to begin.</p>}</div>}
    {mode&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><form role="dialog" aria-modal="true" aria-label={mode==='create'?'New financial account':isHandover?'Confirm representative cash handover':isTransfer?'Transfer funds':'Register opening balance'} onSubmit={save} className="w-full max-w-md max-h-[90vh] overflow-auto rounded-xl bg-white p-5 space-y-4 shadow-xl">
      <h4 className="text-lg font-semibold">{mode==='create'?'New financial account':isHandover?'Confirm representative cash handover':isTransfer?'Transfer funds':'Register opening balance'}</h4>
      {isTransfer?<><label className="block text-sm">From account<select required className={field} value={accountId} onChange={e=>{setAccountId(e.target.value);setToAccountId('');}}><option value="">Select source</option>{(isHandover?handoverSources:eligible).map(a=><option key={a.id} value={a.id}>{a.name} · Rs. {money(a.balance)}</option>)}</select></label><label className="block text-sm">To account<select required className={field} value={toAccountId} onChange={e=>setToAccountId(e.target.value)}><option value="">Select destination</option>{(isHandover?handoverTargets:eligible).filter(a=>a.id!==accountId).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label className="block text-sm">Amount (LKR)<input required type="number" min="0.01" step="0.01" className={field} value={amount} onChange={e=>setAmount(e.target.value)}/></label><label className="block text-sm">{isHandover?'Handover reference / confirmation note *':'Reference / note'}<textarea required={isHandover} maxLength={isHandover?460:500} className={field} value={note} onChange={e=>setNote(e.target.value)}/></label><p className="text-xs text-slate-500">Today's business date: {reportDay(new Date())}. {isHandover?'Confirm only after physically receiving and counting the cash.':'This moves funds; it does not create income or expense.'}</p></>:mode==='create'?<><label className="block text-sm">Account name<input autoFocus required maxLength={120} className={field} value={name} onChange={e=>setName(e.target.value)} /></label><label className="block text-sm">Account type<select className={field} value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>{kinds.map(k=><option key={k}>{k}</option>)}</select></label></>:<><p className="text-sm">{accounts.find(a=>a.id===accountId)?.name}</p><p className="text-xs text-slate-500">Only accounts without previous movements can register an opening balance. A zero starting balance needs no entry.</p><label className="block text-sm">Opening amount (LKR)<input autoFocus required type="number" step="0.01" className={field} value={amount} onChange={e=>setAmount(e.target.value)}/></label><label className="block text-sm">Effective date<input required type="date" max={reportDay(new Date())} className={field} value={date} onChange={e=>setDate(e.target.value)}/></label><label className="block text-sm">Note<textarea className={field} maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label></>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} className="rounded border px-4 py-2 text-sm" onClick={()=>{setMode(null);setError('');}}>Cancel</button><button type="submit" disabled={busy||(isTransfer&&!!pendingTransfer)} className={button}>{busy?'Saving…':isHandover?'Confirm receipt of cash':'Save'}</button></div>
    </form></div>}
  </section>;
}
