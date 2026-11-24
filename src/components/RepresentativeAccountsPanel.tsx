import React,{useEffect,useState,useRef} from 'react';
type Employee={id:string;name:string};
type Account={id:string;name:string;balance:number};
type Assignment={employeeId:string;employeeName:string|null;employeeRole:string|null;accountId:string;accountName:string;balance:number;active:boolean;assignedBy:string;assignedAt:string};
type Directory={employees:Employee[];accounts:Account[];assignments:Assignment[]};
export default function RepresentativeAccountsPanel({authToken,shopId}:{authToken:string;shopId:string}){
  const [data,setData]=useState<Directory|null>(null);
  const [employeeId,setEmployeeId]=useState('');
  const [accountId,setAccountId]=useState('');
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [revision,setRevision]=useState(0);
  const lock=useRef(false);
  const scope=useRef(shopId);scope.current=shopId;
  const money=(n:number)=>'Rs. '+n.toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
  useEffect(()=>{
    const controller=new AbortController();
    setData(null);setLoading(true);setError('');
    fetch('/api/representative-accounts',{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},signal:controller.signal,cache:'no-store'})
      .then(async r=>{const result=await r.json();if(!r.ok)throw Error(result.error||'Unable to load accounts.');return result;})
      .then(result=>{if(!controller.signal.aborted)setData(result);})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[authToken,shopId,revision]);
  useEffect(()=>{setEmployeeId('');setAccountId('');setOpen(false);setMessage('');},[shopId,authToken]);
  const employees=data?.employees.filter(e=>!data.assignments.some(a=>a.employeeId===e.id))||[];
  const accounts=data?.accounts.filter(a=>!data.assignments.some(r=>r.accountId===a.id)&&a.balance===0)||[];
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(lock.current||!employees.some(r=>r.id===employeeId)||!accounts.some(a=>a.id===accountId))return;
    lock.current=true;setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch('/api/representative-accounts',{method:'POST',headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId,'Content-Type':'application/json'},body:JSON.stringify({employeeId,accountId})});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Assignment could not be confirmed.');
      if(scope.current!==shopId)return;
      setOpen(false);setEmployeeId('');setAccountId('');setMessage('Representative cash account assigned.');setRevision(n=>n+1);
    }catch(e){if(scope.current===shopId)setError(e instanceof Error?e.message:'Assignment uncertain. Refresh or retry the same selection.');}
    finally{lock.current=false;setBusy(false);}
  };
  return <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-slate-900">Representative cash accounts</h3><p className="text-xs text-slate-500">Individual cash custody and recorded balances.</p></div><div className="flex gap-2"><button type="button" disabled={busy||loading} onClick={()=>setRevision(n=>n+1)} className="rounded border px-3 py-2 text-xs">Refresh</button><button type="button" disabled={loading||busy||!data} onClick={()=>{setOpen(true);setMessage('');setError('');}} className="rounded bg-slate-900 text-white px-3 py-2 text-xs font-semibold">Assign account</button></div></header>
    {error&&<p role="alert" className="rounded bg-red-50 text-red-800 p-2 text-sm">{error}</p>}
    {message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
    {loading&&<p role="status" className="text-sm">Loading representative accounts…</p>}
    {data&&<><div className="grid sm:grid-cols-2 gap-2"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Assigned accounts</p><strong className="text-xl">{data.assignments.length}</strong></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Recorded cash held</p><strong className="text-xl">{money(data.assignments.reduce((s,a)=>s+a.balance,0))}</strong></div></div>
    <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-slate-50 text-xs"><tr><th className="p-2">Representative</th><th className="p-2">Cash account</th><th className="p-2 text-right">Recorded balance</th><th className="p-2">Status</th></tr></thead><tbody>{data.assignments.map(a=><tr key={a.accountId} className="border-t"><td className="p-2">{a.employeeName||'Historical staff record'}<div className="text-xs text-slate-500">{a.employeeId}</div></td><td className="p-2">{a.accountName}</td><td className="p-2 text-right font-mono">{money(a.balance)}</td><td className="p-2">{a.active&&a.employeeRole==='Cashier'?'Assigned':'Review required'}</td></tr>)}</tbody></table>{!data.assignments.length&&<p className="p-4 text-sm text-slate-500">No representative accounts assigned.</p>}</div></>}
    {open&&<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><form onSubmit={submit} className="bg-white rounded-xl p-5 w-full max-w-md max-h-[90dvh] overflow-auto space-y-4"><h4 className="font-bold">Assign representative cash account</h4><p className="text-xs text-slate-600">Create an unused Representative Cash account in Financial Accounts first. Existing transaction history cannot be reassigned automatically.</p><label className="block text-sm">Sales representative<select required disabled={busy} value={employeeId} onChange={e=>setEmployeeId(e.target.value)} className="block w-full border rounded p-2 mt-1"><option value="">Select representative</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label className="block text-sm">Cash account<select required disabled={busy} value={accountId} onChange={e=>setAccountId(e.target.value)} className="block w-full border rounded p-2 mt-1"><option value="">Select unused cash account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>{(!accounts.length||!employees.length)&&<p className="text-xs text-amber-800">An unassigned representative and eligible cash account are required.</p>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={()=>setOpen(false)} className="border rounded px-3 py-2">Close</button><button disabled={busy||!employeeId||!accountId} type="submit" className="bg-slate-900 text-white rounded px-3 py-2">{busy?'Assigning…':'Confirm assignment'}</button></div></form></div>}
  </section>;
}
