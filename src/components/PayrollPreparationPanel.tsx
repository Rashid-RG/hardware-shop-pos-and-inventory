import React,{useEffect,useRef,useState} from 'react';
import {reportDay} from '../utils/reporting';
type Props={shopId:string;authToken:string;owner:string;employees:{id:string;name:string;salary:number}[];key?:string};
type Proposal={id:string;employee_id:string;employee_name:string;period_key:string;base_salary:string;posting_date:string;evidence:string;submitted_by:string;decision:'Approved'|'Rejected'|null;review_evidence:string|null;reviewed_by:string|null;accrual_id:string|null};
type Request={kind:'prepare';body:{requestId:string;employeeId:string;period:string;expectedBaseSalary:string;postingDate:string;evidence:string}}|{kind:'review';id:string;body:{decision:'Approved'|'Rejected';evidence:string}};
const field='w-full rounded-lg border border-slate-300 p-2 text-sm';
const button='rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50';
const money=(v:number|string)=>Number(v).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function PayrollPreparationPanel(props:Props){return <PayrollWorkspace key={JSON.stringify([props.shopId,props.owner,props.authToken])} {...props}/>;}
function PayrollWorkspace({shopId,authToken,owner,employees}:Props){
 const today=reportDay(new Date()),storageKey='ars:pending-payroll:'+JSON.stringify([shopId,owner]);
 const [period,setPeriod]=useState(today.slice(0,7)),[rows,setRows]=useState<Proposal[]|null>(null),[revision,setRevision]=useState(0),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(0);
 const [dialog,setDialog]=useState<'prepare'|Proposal|null>(null),[employeeId,setEmployeeId]=useState(''),[date,setDate]=useState(today),[evidence,setEvidence]=useState(''),[decision,setDecision]=useState<'Approved'|'Rejected'>('Approved');
 const [pending,setPending]=useState<Request|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false);
 const headers={Authorization:'Bearer '+authToken,'X-Shop-Id':shopId,'Content-Type':'application/json'};
 useEffect(()=>{try{if(!owner)throw Error('Identity required.');const raw=localStorage.getItem(storageKey);if(raw){const p=JSON.parse(raw);if(!p||!p.body||!['prepare','review'].includes(p.kind))throw Error('Invalid saved request.');setPending(p);}setReady(true);}catch{setError('Saved payroll request requires administrator assistance.');}},[storageKey]);
 useEffect(()=>{const c=new AbortController();setRows(null);setPage(0);
 fetch('/api/ars/payroll/proposals?'+new URLSearchParams({period}),{headers,cache:'no-store',signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok||!Array.isArray(d)||d.some(p=>p.period_key!==period))throw Error(d.error||'Payroll list could not be verified.');if(!c.signal.aborted)setRows(d);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[period,revision,authToken,shopId]);
 const employee=employees.find(e=>e.id===employeeId);
 const send=async(p:Request)=>{
  if(lock.current||!ready)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const route='/api/ars/payroll/proposals'+(p.kind==='review'?'/'+encodeURIComponent(p.id)+'/review':'');
   const r=await fetch(route,{method:'POST',headers,body:JSON.stringify(p.body)}),d=await r.json();
   if(!r.ok)throw Error(d.error||'Payroll request not confirmed.');
   if(d.id!==(p.kind==='prepare'?p.body.requestId:p.id)||typeof d.replayed!=='boolean')throw Error('Payroll response not verified.');
   if(localStorage.getItem(storageKey)!==JSON.stringify(p))throw Error('Saved request changed. Administrator review required.');
   localStorage.removeItem(storageKey);setPending(null);setDialog(null);setNotice('Payroll evidence saved. No salary payment or journal was created.');setRevision(v=>v+1);
  }catch(e){setError(e instanceof Error?e.message:'Payroll request not confirmed.');}finally{lock.current=false;setBusy(false);}
 };
 const submit=(e:React.FormEvent)=>{
  e.preventDefault();if(!ready||pending||busy||lock.current||!dialog||!evidence.trim())return;
  let p:Request;
  if(dialog==='prepare'){
   if(!employee||!Number.isFinite(employee.salary)||employee.salary<=0||date.slice(0,7)!==period||date>today)return;
   p={kind:'prepare',body:{requestId:crypto.randomUUID(),employeeId,period,expectedBaseSalary:employee.salary.toFixed(2),postingDate:date,evidence:evidence.trim()}};
  }else p={kind:'review',id:dialog.id,body:{decision,evidence:evidence.trim()}};
  if(!window.confirm('Save permanent payroll evidence? This does not create a financial posting.'))return;
  try{if(localStorage.getItem(storageKey)!==null)throw Error('Another payroll request is awaiting recovery.');localStorage.setItem(storageKey,JSON.stringify(p));}catch(e){setError(e instanceof Error?e.message:'Cannot save request.');return;}
  setPending(p);void send(p);
 };
 const filtered=(rows||[]).filter(p=>p.employee_name.toLowerCase().includes(search.trim().toLowerCase())&&(filter==='all'||(p.decision||'Pending')===filter));
 const validPeriod=/^\d{4}-(0[1-9]|1[0-2])$/.test(period)&&period<=today.slice(0,7);
 const totals=(status:string)=>(rows||[]).filter(p=>(p.decision||'Pending')===status).reduce((n,p)=>n+Number(p.base_salary),0);
 return <section aria-label="Payroll preparation and approvals" className="rounded-xl border bg-white p-3 space-y-3">
  <header className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Monthly payroll</h3><p className="text-xs text-slate-500">Confidential · Base-salary preparation and review only</p></div><button className={button} disabled={!ready||!!pending||busy||!validPeriod||!rows} onClick={()=>{setDialog('prepare');setEmployeeId('');setDate(period===today.slice(0,7)?today:period+'-01');setEvidence('');}}>Prepare payroll</button></header>
  <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Financial posting and payment are disabled pending statutory payroll and deduction verification.</p>
  {error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}{notice&&<p role="status" className="text-xs text-emerald-700">{notice}</p>}
  {pending&&<div className="rounded border border-amber-300 p-2 text-xs">A saved payroll request needs confirmation. <button className={button} disabled={busy} onClick={()=>void send(pending)}>Retry exact request</button><button className={button} disabled={busy} onClick={()=>setRevision(v=>v+1)}>Refresh records</button></div>}
  <div className="grid gap-2 sm:grid-cols-3"><label className="text-xs font-semibold">Month<input type="month" className={field} value={period} max={today.slice(0,7)} disabled={busy||!!dialog} onChange={e=>{setPeriod(e.target.value);setRows(null);}}/></label><label className="text-xs font-semibold">Employee search<input className={field} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label><label className="text-xs font-semibold">Status<select className={field} value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}>{['all','Pending','Approved','Rejected'].map(v=><option key={v}>{v}</option>)}</select></label></div>
  {rows&&<><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{[['Proposals',String(rows.length)],['Pending review','Rs. '+money(totals('Pending'))],['Approved','Rs. '+money(totals('Approved'))],['Rejected records',String(rows.filter(p=>p.decision==='Rejected').length)]].map(([label,value])=><div key={label} className="rounded border bg-slate-50 p-2"><p className="text-xs text-slate-500">{label}</p><strong className="text-sm">{value}</strong></div>)}</div>
  <div className="max-h-[48dvh] overflow-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{['Employee','Base salary (LKR)','Posting date','Status','Action'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{filtered.slice(page*20,page*20+20).map(p=><tr key={p.id} className="border-b"><td className="p-2">{p.employee_name}</td><td>{money(p.base_salary)}</td><td>{p.posting_date}</td><td>{p.decision||'Pending'}{p.accrual_id?' · Accrued':''}</td><td><button className={button} disabled={busy||!!pending} onClick={()=>{setDialog(p);setDecision('Approved');setEvidence('');}}>{p.decision?'Details':'Review'}</button></td></tr>)}</tbody></table>{!filtered.length&&<p className="p-3 text-xs">No matching proposals.</p>}</div>
  <div className="flex gap-2 items-center text-xs"><span>{filtered.length} records</span><button className={button} disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><button className={button} disabled={(page+1)*20>=filtered.length} onClick={()=>setPage(p=>p+1)}>Next</button></div></>}
  {dialog&&<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3"><form role="dialog" aria-modal="true" aria-label="Payroll evidence" onSubmit={submit} className="w-full max-w-md max-h-[85dvh] overflow-auto rounded-xl bg-white p-4 space-y-3"><h3 className="font-bold">{dialog==='prepare'?'Prepare payroll':dialog.employee_name+' · '+dialog.period_key}</h3>
  {dialog==='prepare'?<><label className="block text-xs">Employee<select className={field} required value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Choose employee</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><p className="text-sm">Base salary: Rs. {money(employee?.salary||0)}</p><label className="block text-xs">Proposed posting date<input className={field} type="date" required value={date} min={period+'-01'} max={today} onChange={e=>setDate(e.target.value)}/></label></>:<><p>Base salary: Rs. {money(dialog.base_salary)}</p><p className="text-xs">Submitted by {dialog.submitted_by}: {dialog.evidence}</p>{dialog.decision?<p className="text-sm">{dialog.decision} by {dialog.reviewed_by}: {dialog.review_evidence}</p>:<label className="block text-xs">Decision<select className={field} value={decision} onChange={e=>setDecision(e.target.value as 'Approved'|'Rejected')}><option>Approved</option><option>Rejected</option></select></label>}</>}
  {(dialog==='prepare'||!dialog.decision)&&<label className="block text-xs">Supporting evidence<textarea className={field} required rows={3} maxLength={500} disabled={busy||!!pending} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>}
  {error&&<p role="alert" className="text-xs text-rose-700">{error}</p>}<div className="flex justify-end gap-2"><button type="button" className={button} disabled={busy} onClick={()=>setDialog(null)}>Close</button>{(dialog==='prepare'||!dialog.decision)&&<button type="submit" className={button} disabled={!ready||busy||!!pending||!evidence.trim()}>Save evidence</button>}</div></form></div>}
 </section>;
}
