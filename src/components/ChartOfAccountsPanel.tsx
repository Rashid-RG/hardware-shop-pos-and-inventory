import React,{useEffect,useRef,useState} from 'react';
const kinds=['Asset','Liability','Equity','Revenue','Expense'] as const;
type Account={code:string;name:string;kind:typeof kinds[number];active:boolean};
type Audit={revision:string;actor:string;previous_value:Account|null;new_value:Account;recorded_at:string};
const field='w-full rounded-lg border border-slate-300 p-2 text-sm';
const button='rounded-lg border px-3 py-2 text-sm disabled:opacity-50';
const empty:Account={code:'',name:'',kind:'Asset',active:true};
export default function ChartOfAccountsPanel(props:{authToken:string;shopId:string;canManage:boolean}){
 return <Accounts key={JSON.stringify([props.shopId,props.authToken,props.canManage])} {...props}/>;
}
function Accounts({authToken,shopId,canManage}:{authToken:string;shopId:string;canManage:boolean;key?:string}){
 const [rows,setRows]=useState<Account[]|null>(null),[revision,setRevision]=useState(0),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [search,setSearch]=useState(''),[kind,setKind]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(0);
 const [draft,setDraft]=useState<Account|null>(null),[editing,setEditing]=useState(false),[seed,setSeed]=useState(false),[busy,setBusy]=useState(false);
 const [history,setHistory]=useState<{account:Account;rows:Audit[]|null;error:string}|null>(null);
 const lock=useRef(false),live=useRef(true);
 const headers={Authorization:'Bearer '+authToken,'X-Shop-Id':shopId};
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function request(path:string,options:RequestInit={}){
  const response=await fetch('/api/ledger/accounts'+path,{...options,cache:'no-store',headers:{...headers,'Content-Type':'application/json'}});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Accounting request failed.');return data;
 }
 useEffect(()=>{const c=new AbortController();setRows(null);setError('');
 request('',{signal:c.signal}).then(data=>{if(!Array.isArray(data))throw Error('Invalid account response.');if(!c.signal.aborted)setRows(data);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[revision]);
 const save=async(e?:React.FormEvent)=>{
  e?.preventDefault();if(!canManage||lock.current||(!draft&&!seed))return;
  if(draft&&(!/^\d{4,10}$/.test(draft.code)||!draft.name.trim()))return;
  lock.current=true;setBusy(true);setError('');setMessage('');
  try{
   const data=seed?await request('/defaults',{method:'POST',body:JSON.stringify({confirm:true})}):await request(editing?'/'+encodeURIComponent(draft!.code):'',{method:editing?'PUT':'POST',body:JSON.stringify(draft)});
   if(!live.current)return;
   setMessage(seed?'Created '+data.created+' accounts; existing codes preserved.':'Account saved.');setDraft(null);setSeed(false);setPage(0);setRevision(n=>n+1);
  }catch(e){if(live.current)setError((e instanceof Error?e.message:'Request failed.')+' Refresh accounts before retrying if the outcome is uncertain.');}
  finally{lock.current=false;if(live.current)setBusy(false);}
 };
 const audit=async(account:Account)=>{
  setHistory({account,rows:null,error:''});
  try{const data=await request('/'+encodeURIComponent(account.code)+'/audit');if(!Array.isArray(data))throw Error('Invalid audit response.');if(live.current)setHistory(h=>h?.account.code===account.code?{account,rows:data,error:''}:h);}
  catch(e){if(live.current)setHistory(h=>h?.account.code===account.code?{account,rows:null,error:e instanceof Error?e.message:'Unable to load history.'}:h);}
 };
 const filtered=(rows||[]).filter(a=>(!kind||a.kind===kind)&&(!status||(status==='active')===a.active)&&(a.code+' '+a.name).toLowerCase().includes(search.trim().toLowerCase()));
 const size=20,p=Math.min(page,Math.max(0,Math.ceil(filtered.length/size)-1));
 return <section className="rounded-xl border bg-white p-4 space-y-3">
 <header className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-lg font-bold">Chart of accounts</h3><p className="text-xs text-slate-500">Account setup only. Does not create opening balances or activate journal posting.</p></div><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>setRevision(n=>n+1)}>Refresh</button>{canManage&&<><button className={button} disabled={busy||!rows} onClick={()=>{setError('');setSeed(true);}}>Add wholesale defaults</button><button className="rounded-lg bg-slate-900 text-white px-3 py-2 text-sm" disabled={busy||!rows} onClick={()=>{setError('');setEditing(false);setDraft({...empty});}}>New account</button></>}</div></header>
 {error&&!draft&&!seed&&<p role="alert" className="text-sm text-red-700">{error}</p>}{message&&<p role="status" className="text-sm text-green-700">{message}</p>}
 {rows&&<><div className="flex flex-wrap gap-2 text-sm"><span>{rows.length} accounts</span><span className="text-slate-500">{rows.filter(a=>a.active).length} active</span></div><div className="grid sm:grid-cols-3 gap-2"><input className={field} aria-label="Search accounts" placeholder="Search code or name" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><select className={field} aria-label="Account category" value={kind} onChange={e=>{setKind(e.target.value);setPage(0);}}><option value="">All categories</option>{kinds.map(k=><option key={k}>{k}</option>)}</select><select className={field} aria-label="Account status" value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
 <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-slate-50"><tr>{['Code','Account','Category','Status','Actions'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{filtered.slice(p*size,(p+1)*size).map(a=><tr key={a.code} className="border-t"><td className="p-2 font-mono">{a.code}</td><td className="p-2">{a.name}</td><td className="p-2">{a.kind}</td><td className="p-2">{a.active?'Active':'Inactive'}</td><td className="p-2"><div className="flex gap-2">{canManage&&<button className={button} disabled={busy} onClick={()=>{setError('');setEditing(true);setDraft({...a});}}>Edit</button>}<button className={button} onClick={()=>void audit(a)}>History</button></div></td></tr>)}</tbody></table>{!filtered.length&&<p className="p-3 text-sm text-slate-500">No matching accounts.</p>}</div><div className="flex items-center gap-2 text-sm"><span>{filtered.length} results</span><button className={button} disabled={!p} onClick={()=>setPage(p-1)}>Previous</button><button className={button} disabled={(p+1)*size>=filtered.length} onClick={()=>setPage(p+1)}>Next</button></div></>}
 {!rows&&!error&&<p role="status" className="text-sm">Loading accounts…</p>}
 {draft&&canManage&&<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><form role="dialog" aria-modal="true" aria-label={editing?'Edit account':'New account'} className="bg-white rounded-xl p-5 w-full max-w-md space-y-3 max-h-[90vh] overflow-auto" onSubmit={save}><h3 className="font-bold">{editing?'Edit account':'New account'}</h3><label className="block text-sm">Code<input className={field} required pattern="[0-9]{4,10}" maxLength={10} disabled={editing||busy} value={draft.code} onChange={e=>setDraft({...draft,code:e.target.value})}/></label><label className="block text-sm">Name<input className={field} required maxLength={160} disabled={busy} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label className="block text-sm">Category<select className={field} disabled={editing||busy} value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as Account['kind']})}>{kinds.map(k=><option key={k}>{k}</option>)}</select></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.active} disabled={busy} onChange={e=>setDraft({...draft,active:e.target.checked})}/>Active for new postings</label><p className="text-xs text-slate-500">Account codes and categories cannot be changed after creation. Deactivation preserves history.</p>{error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}<div className="flex justify-end gap-2"><button type="button" className={button} disabled={busy} onClick={()=>setDraft(null)}>Cancel</button><button className={button} disabled={busy} type="submit">{busy?'Saving…':'Save account'}</button></div></form></div>}
 {seed&&canManage&&<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div role="dialog" aria-modal="true" aria-label="Add wholesale default accounts" className="bg-white rounded-xl p-5 max-w-md space-y-3"><h3 className="font-bold">Add wholesale defaults?</h3><p className="text-sm">Only missing account codes are created. Existing accounts are unchanged. This does not activate accounting.</p>{error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}<div className="flex justify-end gap-2"><button className={button} disabled={busy} onClick={()=>setSeed(false)}>Cancel</button><button className={button} disabled={busy} onClick={()=>void save()}>{busy?'Creating…':'Confirm setup'}</button></div></div></div>}
 {history&&<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div role="dialog" aria-modal="true" aria-label="Account audit history" className="bg-white rounded-xl p-5 w-full max-w-xl max-h-[85vh] overflow-auto space-y-3"><h3 className="font-bold">Audit history: {history.account.code} · {history.account.name}</h3>{history.error?<p role="alert">{history.error}</p>:history.rows?history.rows.length?history.rows.map(a=><div key={a.revision} className="border rounded p-2 text-sm"><strong>{a.actor}</strong><p>{new Date(a.recorded_at).toLocaleString()}</p><p>{a.previous_value?a.previous_value.name+' · '+(a.previous_value.active?'Active':'Inactive'):'Account created'}</p><p>New: {a.new_value.name} · {a.new_value.active?'Active':'Inactive'}</p></div>):<p>No recorded history.</p>:<p>Loading history…</p>}<button className={button} onClick={()=>setHistory(null)}>Close</button></div></div>}
 </section>;
}
