import React, {useEffect,useState,useRef} from 'react';
import {reportDay} from '../utils/reporting';
import type {Customer,SalesTransaction} from '../types';
type Cheque={id:string;customerId:string;customerName:string;invoiceId?:string;chequeNumber:string;issuingBank:string;drawerName:string;amount:number;receivedDate:string;dueDate:string;status:string;depositAccountId?:string};
type Bank={id:string;name:string;kind:string;active:boolean};
type Saved={path:string;body:Record<string,unknown>;label:string};
const money=(n:number)=>n.toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
const field='w-full rounded-lg border border-slate-300 p-2 text-sm';
const btn='rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50';
export default function ChequeManagementPanel({authToken,shopId,owner,customers,transactions,onRefresh}:{authToken:string;shopId:string;owner?:string;customers:Customer[];transactions:SalesTransaction[];onRefresh?:()=>Promise<void>}){
  const [rows,setRows]=useState<Cheque[]>([]);
  const [banks,setBanks]=useState<Bank[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [version,setVersion]=useState(0);
  const [filter,setFilter]=useState('All');
  const [search,setSearch]=useState('');
  const [mode,setMode]=useState('');
  const [selected,setSelected]=useState<Cheque|null>(null);
  const [customerId,setCustomerId]=useState('');
  const [invoiceId,setInvoiceId]=useState('');
  const [number,setNumber]=useState('');
  const [bank,setBank]=useState('');
  const [drawer,setDrawer]=useState('');
  const [amount,setAmount]=useState('');
  const [received,setReceived]=useState(reportDay(new Date()));
  const [due,setDue]=useState(reportDay(new Date()));
  const [date,setDate]=useState(reportDay(new Date()));
  const [deposit,setDeposit]=useState('');
  const [note,setNote]=useState('');
  const [pending,setPending]=useState<Saved|null>(null);
  const [ready,setReady]=useState(false);
  const storageKey='ars:pending-cheque:'+JSON.stringify([owner||'',shopId]);
  const today=reportDay(new Date());
  const headers={Authorization:'Bearer '+authToken,'X-Shop-Id':shopId,'Content-Type':'application/json'};
  useEffect(()=>{
    setReady(false);setMode('');setPending(null);
    if(!owner)return;
    try{setPending(JSON.parse(localStorage.getItem(storageKey)||'null'));setReady(true);}
    catch{setError('Cannot read saved cheque request. Check browser storage.');}
  },[storageKey,owner]);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setRows([]);setBanks([]);
    const load=async(path:string)=>{
      const r=await fetch(path,{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},cache:'no-store',signal:controller.signal});
      const data=await r.json();if(!r.ok||!Array.isArray(data))throw Error(data.error||'Unable to load cheque data.');return data;
    };
    Promise.all([load('/api/customer-cheques'),load('/api/financial-accounts')]).then(([c,b])=>{if(!controller.signal.aborted){setRows(c);setBanks(b.filter((a:Bank)=>a.active&&a.kind==='Bank'));}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[authToken,shopId,version]);
  const eligible=customers.filter(c=>c.shopId===shopId&&Number(c.creditBalance||0)>0);
  const invoices=transactions.filter(t=>t.shopId===shopId&&t.customerId===customerId&&t.paymentMethod==='Credit Account'&&t.status==='Completed'&&t.paymentStatus!=='PAID');
  const visible=rows.filter(c=>(filter==='All'||(filter==='Due now'?c.status==='Received'&&c.dueDate<=today:c.status===filter))&&[c.customerName,c.chequeNumber,c.issuingBank,c.drawerName].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const dueNow=rows.filter(c=>c.status==='Received'&&c.dueDate<=today);
  const postDated=rows.filter(c=>c.status==='Received'&&c.dueDate>today);
  const validAmount=Number.isFinite(Number(amount))&&Number(amount)>0&&Number.isSafeInteger(Math.round(Number(amount)*100))&&Math.abs(Number(amount)*100-Math.round(Number(amount)*100))<1e-6;
  const formIssue=mode==='Register'?(!eligible.some(c=>c.id===customerId)?'Select a customer with outstanding credit.':invoiceId&&!invoices.some(t=>t.id===invoiceId)?'Select an eligible invoice.':!number.trim()||!bank.trim()||!drawer.trim()?'Enter cheque number, bank and drawer name.':!validAmount?'Enter a positive amount with at most two decimal places.':!received||received>today||!due?'Enter valid received and due dates.':''):(!selected?'Select a cheque.':!date||date>today||date<selected.receivedDate?'Enter an effective date on or after receipt and not in the future.':mode==='Deposited'&&(!banks.some(b=>b.id===deposit)||date<selected.dueDate)?'Select a receiving bank and a date on or after maturity.':['Bounced','Cancelled','Returned'].includes(mode)&&!note.trim()?'Enter the reason for this action.':'');
  function open(action:string,cheque:Cheque|null=null){
    setMode(action);setSelected(cheque);setError('');setMessage('');setCustomerId('');setInvoiceId('');setNumber('');setBank('');setDrawer('');setAmount('');setReceived(today);setDue(today);setDate(today);setDeposit('');setNote('');
  }
  async function send(saved:Saved){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setMessage('');
    try{
      const r=await fetch(saved.path,{method:'POST',headers,body:JSON.stringify(saved.body)});
      const data=await r.json();
      if(!r.ok){
        if(r.status===400||r.status===403||r.status===404||r.status===409){localStorage.removeItem(storageKey);setPending(null);}
        throw Error(data.error||'Unable to confirm cheque operation.');
      }
      localStorage.removeItem(storageKey);setPending(null);setMode('');setMessage(saved.label+' confirmed.');setVersion(v=>v+1);
      if(onRefresh)try{await onRefresh();}catch{setMessage(saved.label+' confirmed. Refresh customer records before further collections.');}
    }catch(e){setError(e instanceof Error?e.message:'Unable to confirm operation. Check the saved request.');}
    finally{lock.current=false;setBusy(false);}
  }
  async function save(e:React.FormEvent){
    e.preventDefault();if(!ready||pending||busy||lock.current)return;if(formIssue){setError(formIssue);return;}if(mode==='Cleared'&&!window.confirm('Confirm actual bank clearance? This records customer payment and bank funds.'))return;
    const requestId=crypto.randomUUID();
    let saved:Saved;
    if(mode==='Register'){
      if(!eligible.some(c=>c.id===customerId)||!Number.isFinite(Number(amount))||Number(amount)<=0)return setError('Select a customer and positive amount.');
      saved={path:'/api/customer-cheques',label:'Cheque registration',body:{requestId,customerId,invoiceId:invoiceId||undefined,chequeNumber:number.trim(),issuingBank:bank.trim(),drawerName:drawer.trim(),amount:Number(amount),receivedDate:received,dueDate:due,note}};
    }else{
      if(!selected)return;
      const base='/api/customer-cheques/'+encodeURIComponent(selected.id);
      saved=mode==='Cleared'?{path:base+'/clear',label:'Cheque clearance',body:{requestId,effectiveDate:date}}:{path:base+'/status',label:mode,body:{requestId,nextStatus:mode,effectiveDate:date,depositAccountId:mode==='Deposited'?deposit:undefined,note}};
    }
    try{localStorage.setItem(storageKey,JSON.stringify(saved));}catch{return setError('Cannot safely preserve cheque request.');}
    setPending(saved);await send(saved);
  }
  return <section className="rounded-xl border bg-white p-4 space-y-4">
    <div className="flex flex-wrap justify-between gap-2"><div><h3 className="text-lg font-semibold">Cheque management</h3><p className="text-xs text-slate-500">Pending cheques do not reduce customer debt or increase bank funds until cleared.</p></div><div className="flex gap-2"><button type="button" className="rounded border px-3 py-2" disabled={busy||loading} onClick={()=>setVersion(v=>v+1)}>Refresh</button><button type="button" className={btn} disabled={!ready||busy||loading||!!pending} onClick={()=>open('Register')}>Register cheque</button></div></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{['Received','Deposited','Cleared','Bounced'].map(s=><button type="button" key={s} onClick={()=>setFilter(s)} className="rounded-lg border p-3 text-left"><span className="block text-xs text-slate-500">{s}</span><strong>Rs. {money(rows.filter(c=>c.status===s).reduce((n,c)=>n+c.amount,0))}</strong></button>)}</div>
    <div className="flex flex-wrap items-center gap-2 text-xs"><button type="button" onClick={()=>setFilter('Due now')} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-semibold text-amber-900">Due now: {dueNow.length} · Rs. {money(dueNow.reduce((n,c)=>n+c.amount,0))}</button><span className="rounded-lg border px-3 py-2">Post-dated: {postDated.length} · Rs. {money(postDated.reduce((n,c)=>n+c.amount,0))}</span><button type="button" onClick={()=>{setFilter('All');setSearch('');}} className="rounded-lg border px-3 py-2">Clear filters</button><span className="ml-auto text-slate-500">{visible.length} matching cheques</span></div>
    {pending&&<div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm"><p>Unconfirmed request: {pending.label}. Retry the saved request, not a new operation.</p><button type="button" className={btn} disabled={busy} onClick={()=>void send(pending)}>Retry exact request</button></div>}
    {message&&<p role="status" className="text-emerald-700 text-sm">{message}</p>}{error&&!mode&&<p role="alert" className="text-red-700 text-sm">{error}</p>}
    <div className="flex gap-2"><input aria-label="Search cheques" className={field} placeholder="Search customer, cheque or bank" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Cheque status" className={field} value={filter} onChange={e=>setFilter(e.target.value)}>{['All','Due now','Received','Deposited','Cleared','Bounced','Cancelled','Returned'].map(s=><option key={s}>{s}</option>)}</select></div>
    {loading?<p>Loading cheque register…</p>:<div className="max-h-[52dvh] overflow-auto overscroll-contain"><table className="w-full min-w-[680px] text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-50"><tr>{['Customer / cheque','Bank','Due date','Amount (LKR)','Status','Actions'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{visible.map(c=><tr key={c.id} className="border-t"><td className="p-2">{c.customerName}<div className="text-xs">{c.chequeNumber}</div></td><td className="p-2">{c.issuingBank}</td><td className="p-2">{c.dueDate}</td><td className="p-2">{money(c.amount)}</td><td className="p-2">{c.status}{c.status==='Received'&&c.dueDate>today?' · Post-dated':''}</td><td className="p-2"><div className="flex flex-wrap gap-1">{(c.status==='Received'?(c.dueDate<=today?['Deposited','Cancelled','Returned']:['Cancelled','Returned']):c.status==='Deposited'?['Cleared','Bounced','Returned']:[]).map(s=><button key={s} type="button" disabled={!ready||busy||!!pending} className="rounded border px-2 py-1 text-xs" onClick={()=>open(s,c)}>{s==='Cleared'?'Confirm clearance':s==='Deposited'?'Deposit':s}</button>)}</div></td></tr>)}</tbody></table>{!visible.length&&<p className="p-3 text-sm text-slate-500">No matching cheques.</p>}</div>}
    {mode&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><form role="dialog" aria-modal="true" aria-label={mode+' cheque'} className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-xl bg-white p-5 space-y-3" onSubmit={save}><h4 className="text-lg font-semibold">{mode==='Register'?'Register customer cheque':mode+' cheque'}</h4>
      {mode==='Register'?<><label className="block text-sm">Customer<select required className={field} value={customerId} onChange={e=>{setCustomerId(e.target.value);setInvoiceId('');}}><option value="">Select customer</option>{eligible.map(c=><option key={c.id} value={c.id}>{c.name} · Rs. {money(Number(c.creditBalance||0))}</option>)}</select></label><label className="block text-sm">Invoice<select className={field} value={invoiceId} onChange={e=>setInvoiceId(e.target.value)}><option value="">Customer account (unallocated)</option>{invoices.map(t=><option key={t.id} value={t.id}>{t.invoiceNumber}</option>)}</select></label><div className="grid grid-cols-2 gap-2"><label>Cheque number<input required maxLength={80} className={field} value={number} onChange={e=>setNumber(e.target.value)}/></label><label>Issuing bank<input required maxLength={120} className={field} value={bank} onChange={e=>setBank(e.target.value)}/></label></div><label className="block">Drawer name<input required maxLength={160} className={field} value={drawer} onChange={e=>setDrawer(e.target.value)}/></label><label className="block">Amount (LKR)<input required type="number" min="0.01" step="0.01" className={field} value={amount} onChange={e=>setAmount(e.target.value)}/></label><div className="grid grid-cols-2 gap-2"><label>Received<input required type="date" max={today} className={field} value={received} onChange={e=>setReceived(e.target.value)}/></label><label>Due date<input required type="date" className={field} value={due} onChange={e=>setDue(e.target.value)}/></label></div></>:<><p>{selected?.chequeNumber} · {selected?.customerName} · Rs. {money(selected?.amount||0)}</p><label className="block">Effective date<input required type="date" max={today} className={field} value={date} onChange={e=>setDate(e.target.value)}/></label>{mode==='Deposited'&&<label className="block">Receiving bank account<select required className={field} value={deposit} onChange={e=>setDeposit(e.target.value)}><option value="">Select bank account</option>{banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}{mode==='Cleared'&&<p className="text-sm text-amber-800">Confirm only after verifying actual bank clearance. This records customer payment and bank funds.</p>}</>}
      {mode!=='Cleared'&&<label className="block">Note<textarea required={['Bounced','Cancelled','Returned'].includes(mode)} maxLength={500} className={field} value={note} onChange={e=>setNote(e.target.value)}/></label>}
      {formIssue&&<p role="status" className="text-xs text-amber-800">{formIssue}</p>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={()=>setMode('')}>Close</button><button type="submit" disabled={busy||!!pending||!ready||!!formIssue} className={btn}>{busy?'Saving…':mode==='Cleared'?'Confirm bank clearance':'Save'}</button></div>
    </form></div>}
  </section>;
}
