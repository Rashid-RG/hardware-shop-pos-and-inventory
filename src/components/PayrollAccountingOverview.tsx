import React,{useEffect,useState} from 'react';
type Id='salary'|'advances'|'epf'|'etf';
type Control={id:Id;label:string;classification:'Asset'|'Liability';ledgerBalance:string;recordedBalance:string|null;difference:string|null;matched:boolean;exceptionCount:number;unmatchedCount:number|null;checksPassed:boolean};
type Report={scope:string;controls:Control[];statutoryUnmatchedCount:number;checksPassed:boolean;postingEnabled:false};
const btn='rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold';
const amount=(v:unknown):v is string=>typeof v==='string'&&/^-?\d+(\.\d{1,2})?$/.test(v);
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const cents=(v:string)=>{const negative=v.startsWith('-'),[w,f='']=(negative?v.slice(1):v).split('.');const n=BigInt(w)*100n+BigInt(f.padEnd(2,'0'));return negative?-n:n;};
const money=(n:bigint)=>{const sign=n<0n?'-':'',v=n<0n?-n:n;return sign+(v/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+(v%100n).toString().padStart(2,'0');};
export default function PayrollAccountingOverview({shopId,authToken,onOpen}:{shopId:string;authToken:string;onOpen:(id:Id)=>void}){
 const [version,setVersion]=useState(0),[onlyReview,setOnlyReview]=useState(false);
 const [loaded,setLoaded]=useState<{key:string;report:Report}|null>(null),[failure,setFailure]=useState<{key:string;message:string}|null>(null);
 const key=JSON.stringify([shopId,authToken,version]),r=loaded?.key===key?loaded.report:null,error=failure?.key===key?failure.message:'';
 useEffect(()=>{const c=new AbortController();
 fetch('/api/ars/payroll/accounting-overview',{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},cache:'no-store',signal:c.signal}).then(async response=>{
 const d=await response.json();if(!response.ok)throw Error(typeof d?.error==='string'?d.error:'Accounting overview unavailable.');
 if(!d||d.postingEnabled!==false||typeof d.scope!=='string'||typeof d.checksPassed!=='boolean'||!count(d.statutoryUnmatchedCount)||!Array.isArray(d.controls)||d.controls.length!==4||new Set(d.controls.map((x:Control)=>x?.id)).size!==4||!d.controls.every((x:Control)=>x&&['salary','advances','epf','etf'].includes(x.id)&&typeof x.label==='string'&&x.classification===(x.id==='advances'?'Asset':'Liability')&&amount(x.ledgerBalance)&&(x.recordedBalance===null||amount(x.recordedBalance))&&(x.difference===null||amount(x.difference))&&typeof x.matched==='boolean'&&count(x.exceptionCount)&&(x.unmatchedCount===null||count(x.unmatchedCount))&&typeof x.checksPassed==='boolean'&&(!x.checksPassed||x.matched&&x.exceptionCount===0&&!x.unmatchedCount)&&(!x.matched||x.recordedBalance!==null&&cents(x.ledgerBalance)===cents(x.recordedBalance))))throw Error('Invalid accounting overview response.');
 if(d.checksPassed!==(d.controls.every((x:Control)=>x.checksPassed)&&d.statutoryUnmatchedCount===0))throw Error('Inconsistent accounting overview response.');
 if(!c.signal.aborted)setLoaded({key,report:d});
 }).catch(e=>{if(!c.signal.aborted)setFailure({key,message:e instanceof Error?e.message:'Accounting overview unavailable.'});});return()=>c.abort();},[key,shopId,authToken]);
 const cards=(r?.controls||[]).filter(x=>!onlyReview||!x.checksPassed);
 return <section className="rounded-xl border bg-white p-3 space-y-3" aria-label="Payroll accounting overview">
 <header className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Payroll accounting overview</h3><p className="text-xs text-slate-500">All recorded periods · One consistent snapshot · LKR</p></div><button className={btn} onClick={()=>setVersion(v=>v+1)}>Refresh checks</button></header>
 {error?<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>:!r?<p role="status" className="text-xs">Checking all payroll controls…</p>:<>
 <div role="status" className={'rounded-lg p-3 text-xs '+(r.checksPassed?'bg-emerald-50 text-emerald-900':'bg-amber-50 text-amber-900')}><strong>{r.controls.filter(c=>c.checksPassed).length} of 4 controls passed current checks</strong><p>{r.checksPassed?'No exceptions detected in the current checks.':'Accounting review required.'} Financial posting remains locked; this is not accounting or legal certification.</p></div>
 <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyReview} onChange={e=>setOnlyReview(e.target.checked)}/>Show controls requiring review only</label>
 <div className="grid gap-3 md:grid-cols-2">{cards.map(c=><article key={c.id} className="rounded-xl border p-3 space-y-2"><header className="flex items-center justify-between gap-2"><strong>{c.label}</strong><span className="text-xs text-slate-500">{c.classification}</span></header><div className="grid grid-cols-2 gap-2"><div><p className="text-xs text-slate-500">Recorded subledger</p><strong className="text-lg">{c.recordedBalance===null?'Not verified':'Rs. '+money(cents(c.recordedBalance))}</strong></div><div><p className="text-xs text-slate-500">General ledger</p><strong className="text-lg">Rs. {money(cents(c.ledgerBalance))}</strong></div></div><p className="text-xs">Difference: {c.recordedBalance===null?'Not verified':'Rs. '+money(cents(c.ledgerBalance)-cents(c.recordedBalance))}</p><div className="flex flex-wrap justify-between gap-2 text-xs"><span>{c.exceptionCount} exception records{c.unmatchedCount!==null?' · '+c.unmatchedCount+' unmatched':''}</span><strong className={c.checksPassed?'text-emerald-800':'text-amber-800'}>{c.checksPassed?'Checks passed':'Review required'}</strong></div><button className={btn+' w-full'} onClick={()=>onOpen(c.id)}>Open reconciliation</button></article>)}</div>
 {!cards.length&&<p className="text-sm text-slate-600">No controls requiring review in this snapshot.</p>}
 <p className="text-xs text-slate-600">Unmatched statutory records (shared across EPF and ETF): {r.statutoryUnmatchedCount}. Asset and liability balances are shown separately, not netted. Recorded balances may include exceptions.</p>
 </>}
 </section>;
}
