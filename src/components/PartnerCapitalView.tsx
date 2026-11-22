import React,{useEffect,useState} from 'react';
import {Landmark,ShieldCheck,RefreshCcw,Plus} from 'lucide-react';
type Partner={id:string;name:string;ownership_percent:string|null;};
type Capital={id:string;partner_id:string;entry_type:'Contribution'|'Drawing';amount_lkr:string;entry_date:string;reference:string;note:string;created_by:string;};
type ProfitAllocation={id:string;period_key:string;approved_profit_lkr:string;approval_reference:string;allocated_at:string;approved_by:string;shares:Array<{partnerId:string;name:string;ownershipPercent:number;allocatedLkr:string}>};
type Props={authToken:string;shopId:string;};
export default function PartnerCapitalView({authToken,shopId}:Props){
 const [partners,setPartners]=useState<Partner[]>([]);
 const [entries,setEntries]=useState<Capital[]>([]);
 const [profits,setProfits]=useState<ProfitAllocation[]>([]);
 const [profitPeriod,setProfitPeriod]=useState(()=>new Date().toISOString().slice(0,7));
 const [approvedProfit,setApprovedProfit]=useState('');
 const [profitApproval,setProfitApproval]=useState('');
 const [profitNote,setProfitNote]=useState('');
 const [name,setName]=useState('');
 const [ownership,setOwnership]=useState('');
 const [partnerId,setPartnerId]=useState('');
 const [type,setType]=useState<'Contribution'|'Drawing'>('Contribution');
 const [amount,setAmount]=useState('');
 const [reference,setReference]=useState('');
 const [note,setNote]=useState('');
 const [date,setDate]=useState(()=>new Date().toISOString().slice(0,10));
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const call=async(url:string,options:RequestInit={})=>{
   const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${authToken}`,'X-Shop-Id':shopId,'Content-Type':'application/json',...options.headers}});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Unable to complete partner ledger request');
   return data;
 };
 const refresh=async()=>{try{
   const [data,allocations]=await Promise.all([call('/api/ars/partners'),call('/api/ars/partner-profits')]);
   setPartners(data.partners);setEntries(data.entries);setProfits(allocations);
 }catch(e:any){setError(e.message)}};
 const recordProfit=async(e:React.FormEvent)=>{
   e.preventDefault();
   const profit=Number(approvedProfit);
   if(!Number.isFinite(profit)||profit<=0||!profitApproval.trim())return;
   if(!window.confirm(`Record approved profit of Rs.${profit.toFixed(2)} for ${profitPeriod}? This creates permanent allocations but DOES NOT transfer money. Confirm the approved accounting statement and ownership percentages.`))return;
   setBusy(true);setError('');setNotice('');
   try{
     await call('/api/ars/partner-profits',{method:'POST',body:JSON.stringify({
       periodKey:profitPeriod,approvedProfitLkr:profit,
       approvalReference:profitApproval,note:profitNote
     })});
     setApprovedProfit('');setProfitApproval('');setProfitNote('');
     setNotice('Profit allocation recorded. Payout transfers must be reconciled separately.');
     await refresh();
   }catch(e:any){setError(e.message)}finally{setBusy(false);}
 };
 useEffect(()=>{void refresh()},[authToken,shopId]);
 const register=async(e:React.FormEvent)=>{
   e.preventDefault();setBusy(true);setError('');setNotice('');
   try{await call('/api/ars/partners',{method:'POST',body:JSON.stringify({name,ownershipPercent:ownership===''?null:Number(ownership)})});
     setName('');setOwnership('');setNotice('Partner registered without any assumed ownership or capital.');await refresh();
   }catch(e:any){setError(e.message)}finally{setBusy(false);}
 };
 const updateOwnership=async(partner:Partner,value:string)=>{
   setBusy(true);setError('');setNotice('');
   try{await call(`/api/ars/partners/${encodeURIComponent(partner.id)}/ownership`,{
     method:'PUT',body:JSON.stringify({ownershipPercent:value===''?null:Number(value)})});
     setNotice('Ownership updated; no profit distribution was posted.');await refresh();
   }catch(e:any){setError(e.message)}finally{setBusy(false);}
 };
 const postCapital=async(e:React.FormEvent)=>{
   e.preventDefault();
   if(!window.confirm(`Record ${type.toLowerCase()} of Rs. ${amount} for the selected partner? This capital entry is permanent and will not change the cash drawer automatically.`))return;
   setBusy(true);setError('');setNotice('');
   try{await call('/api/ars/partner-capital',{method:'POST',body:JSON.stringify({partnerId,entryType:type,amountLkr:Number(amount),reference,entryDate:date,note})});
     setAmount('');setReference('');setNote('');setNotice('Capital ledger entry recorded. Accounting bank/cash reconciliation remains separate.');await refresh();
   }catch(e:any){setError(e.message)}finally{setBusy(false);}
 };
 const n=(v:any)=>Number(v||0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
 const ownershipTotal=partners.reduce((sum,p)=>sum+Number(p.ownership_percent||0),0);
 const formField='mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-amber-400 focus:outline-none';
 return <div className="space-y-5">
  <header className="rounded-2xl bg-[#172a47] p-6 text-white"><p className="text-xs font-bold uppercase tracking-widest text-amber-300">Super Admin Only · Confidential</p>
    <h2 className="mt-2 flex items-center gap-2 font-heading text-2xl font-bold"><Landmark className="h-6 w-6"/>Three-Partner Capital Ledger</h2>
    <p className="mt-2 text-sm text-slate-300">Maintain independent records of contributions, drawings and agreed ownership. Approved profit allocation is available when all three ownership percentages total 100%. It does not transfer funds.</p></header>
  {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
  <div className="grid gap-5 xl:grid-cols-2">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="font-bold">Partners ({partners.length}/3)</h3><button type="button" onClick={()=>void refresh()} className="rounded-lg p-2 text-slate-600" aria-label="Refresh partner records"><RefreshCcw className="h-4 w-4"/></button></div>
      <p className="mt-1 text-xs text-slate-500">Ownership shares are optional until agreed. Shares must not exceed 100% combined.</p>
      <div className="mt-3 space-y-3">{partners.map(p=><div key={p.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-bold">{p.name}</p><label className="mt-2 block text-xs font-semibold text-slate-600">Agreed ownership percentage
        <div className="mt-1 flex items-center gap-2"><input key={p.id+'-'+p.ownership_percent} id={'partner-pct-'+p.id} type="number" min="0" max="100" step="0.01" defaultValue={p.ownership_percent===null?'':p.ownership_percent} placeholder="Not yet agreed" className={formField+' mt-0'}/>
        <button type="button" disabled={busy} onClick={()=>{const element=document.getElementById('partner-pct-'+p.id) as HTMLInputElement|null;void updateOwnership(p,element?.value||'')}} className="shrink-0 rounded-lg bg-[#172a47] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">Update</button></div></label>
      </div>)}</div>
      <p className="mt-3 text-xs font-bold text-slate-600">Allocated ownership: {ownershipTotal.toFixed(2)}% {ownershipTotal<100?'· Remainder unassigned':''}</p>
      {partners.length<3&&<form onSubmit={register} className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row">
        <input aria-label="Partner name" required minLength={2} maxLength={120} placeholder="Partner full name" value={name} onChange={e=>setName(e.target.value)} className={formField+' mt-0 flex-1'}/>
        <input aria-label="Ownership percent optional" type="number" min="0" max="100" step="0.01" placeholder="% (optional)" value={ownership} onChange={e=>setOwnership(e.target.value)} className={formField+' mt-0 w-full sm:w-32'}/>
        <button disabled={busy} type="submit" className="flex items-center justify-center gap-1 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-slate-900 disabled:opacity-50"><Plus className="h-4 w-4"/>Add partner</button>
      </form>}
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-bold">Record partner contribution or drawing</h3>
      <p className="mt-1 text-xs text-slate-500">Records are immutable. Verify payment evidence and reference before saving.</p>
      <form onSubmit={postCapital} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold">Partner
          <select required value={partnerId} onChange={e=>setPartnerId(e.target.value)} className={formField}><option value="">Select partner</option>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-xs font-semibold">Transaction type
          <select value={type} onChange={e=>setType(e.target.value as 'Contribution'|'Drawing')} className={formField}><option value="Contribution">Capital contribution</option><option value="Drawing">Partner drawing</option></select></label>
        <label className="text-xs font-semibold">Amount LKR<input required min="0.01" step="0.01" type="number" value={amount} onChange={e=>setAmount(e.target.value)} className={formField}/></label>
        <label className="text-xs font-semibold">Effective date<input required type="date" value={date} onChange={e=>setDate(e.target.value)} className={formField}/></label>
        <label className="text-xs font-semibold sm:col-span-2">Bank transfer / voucher reference<input required maxLength={120} value={reference} onChange={e=>setReference(e.target.value)} className={formField}/></label>
        <label className="text-xs font-semibold sm:col-span-2">Notes<textarea maxLength={1000} rows={2} value={note} onChange={e=>setNote(e.target.value)} className={formField}/></label>
        <button type="submit" disabled={busy||!partners.length} className="rounded-xl bg-[#172a47] px-4 py-3 text-xs font-bold text-white disabled:opacity-50 sm:col-span-2">Record permanent capital entry</button>
      </form>
    </section>
  </div>
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h3 className="font-bold">Partner capital activity</h3>
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[580px] text-left text-xs">
      <thead className="border-b border-slate-200 text-slate-500"><tr><th className="py-2">Date</th><th>Partner</th><th>Type</th><th>Amount · LKR</th><th>Reference</th></tr></thead>
      <tbody>{entries.map(e=><tr key={e.id} className="border-b border-slate-100"><td className="py-3">{String(e.entry_date).slice(0,10)}</td><td>{partners.find(p=>p.id===e.partner_id)?.name||'Unknown'}</td><td>{e.entry_type}</td><td className="font-semibold">{e.entry_type==='Drawing'?'-':'+'}{n(e.amount_lkr)}</td><td>{e.reference}</td></tr>)}</tbody>
    </table>{entries.length===0&&<p className="py-8 text-center text-xs text-slate-500">No capital contributions or drawings recorded yet.</p>}</div>
    <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600"/>This ledger is separate from cash, bank accounts and profit distribution. Reconcile it with supporting documents.</p>
  </section>
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h3 className="font-bold">Approved partner profit allocation</h3>
    <p className="mt-1 text-xs text-slate-600">Enter a profit amount approved from reconciled accounts. This is an allocation ledger only, not a cash payment, and cannot calculate business profit automatically.</p>
    <form onSubmit={recordProfit} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold">Accounting month<input type="month" required value={profitPeriod} onChange={e=>setProfitPeriod(e.target.value)} className={formField} /></label>
      <label className="text-xs font-semibold">Approved distributable profit (LKR)<input type="number" min="0.01" step="0.01" required value={approvedProfit} onChange={e=>setApprovedProfit(e.target.value)} className={formField}/></label>
      <label className="text-xs font-semibold sm:col-span-2">Approved financial statement / board reference<input required maxLength={160} value={profitApproval} onChange={e=>setProfitApproval(e.target.value)} className={formField} /></label>
      <label className="text-xs font-semibold sm:col-span-2">Allocation note<textarea value={profitNote} onChange={e=>setProfitNote(e.target.value)} maxLength={1000} rows={2} className={formField}/></label>
      <button type="submit" disabled={busy||partners.length!==3||Math.abs(ownershipTotal-100)>0.00001||partners.some(p=>p.ownership_percent===null)}
        className="rounded-xl bg-[#172a47] px-4 py-3 text-xs font-bold text-white disabled:opacity-50 sm:col-span-2">
        Record approved allocation (no money transfer)
      </button>
    </form>
    {(partners.length!==3||Math.abs(ownershipTotal-100)>0.00001||partners.some(p=>p.ownership_percent===null))&&
      <p role="status" className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Configure three partners whose ownership percentages total exactly 100% before allocating profits.</p>}
    <div className="mt-5 space-y-3">
      <h4 className="text-sm font-semibold">Past approved allocations</h4>
      {profits.length===0&&<p className="text-xs text-slate-500">No approved profit allocations recorded.</p>}
      {profits.map(p=><div key={p.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{p.period_key} · Rs.{n(p.approved_profit_lkr)}</strong><span className="text-xs text-slate-500">Reference: {p.approval_reference}</span></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">{(p.shares||[]).map(share=><div key={share.partnerId} className="rounded-lg bg-white p-3 text-xs">
          <p className="font-semibold">{share.name}</p><p>{Number(share.ownershipPercent).toFixed(2)}% ownership</p>
          <p className="mt-1 text-sm font-bold">Rs.{n(share.allocatedLkr)}</p>
        </div>)}</div>
        <p className="mt-2 text-[11px] text-slate-500">Recorded by {p.approved_by} · {new Date(p.allocated_at).toLocaleString()} · Payment status: not tracked</p>
      </div>)}
    </div>
  </section>
 </div>;
}
