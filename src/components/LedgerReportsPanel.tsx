import React,{useEffect,useState} from 'react';
import {reportDay} from '../utils/reporting';
import {ReportExportMenu} from './ReportExportMenu';
import type {StoreSettings} from '../types';
import type {BusinessReport} from '../utils/businessReport';
type Amounts=Record<string,string>;
type Account={code:string;name:string;kind:string;active:boolean;debit:string;credit:string;balance:string;trialDebit:string;trialCredit:string};
type Statements={asOf:string;cutoverDate:string|null;postingEnabled:boolean;journalCount:string;accounts:Account[];trialBalance:Amounts;profitAndLoss:Amounts|null;balanceSheet:Amounts|null;note:string;complete:false};
type Journal={id:string;day:string;source_kind:string;source_id:string;description:string;recorded_by:string;lines:{accountCode:string;debit:string;credit:string}[]};
type Activity={rows:Journal[];offset:number;nextOffset:number|null;note:string};
const field='rounded-lg border border-slate-300 p-2 text-sm';
const money=(s:string)=>s.replace(/\B(?=(\d{3})+(?!\d))/g,',');
export default function LedgerReportsPanel({authToken,shopId,settings}:{authToken:string;shopId:string;settings:StoreSettings}){
 const today=reportDay(new Date());
 const [tab,setTab]=useState<'statements'|'activity'>('statements'),[to,setTo]=useState(today),[from,setFrom]=useState(today.slice(0,7)+'-01'),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
 const [state,setState]=useState<{key:string;data:Statements|Activity|null;error:string}|null>(null);
 const key=JSON.stringify([authToken,shopId,tab,from,to,offset,revision]);
 const current=state?.key===key?state:null;
 const valid=!!shopId&&!!to&&to<=today&&(tab==='statements'||!!from&&from<=to);
 useEffect(()=>{
 if(!valid)return;
 const controller=new AbortController();
 const path=tab==='statements'?'/api/ledger/statements?'+new URLSearchParams({asOf:to}):'/api/ledger/activity?'+new URLSearchParams({from,to,offset:String(offset)});
 fetch(path,{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},cache:'no-store',signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load report.');if(tab==='statements'?data.asOf!==to||!Array.isArray(data.accounts):data.offset!==offset||!Array.isArray(data.rows))throw Error('Invalid ledger report response.');if(!controller.signal.aborted)setState({key,data,error:''});}).catch(e=>{if(!controller.signal.aborted)setState({key,data:null,error:e.message});});
 return ()=>controller.abort();
 },[key,valid]);
 const statements=tab==='statements'&&current?.data?current.data as Statements:null;
 const activity=tab==='activity'&&current?.data?current.data as Activity:null;
 const [search,setSearch]=useState('');
 const labels:Record<string,string>={movementDebit:'Movement debit',movementCredit:'Movement credit',debit:'Debit balance',credit:'Credit balance',difference:'Difference',revenue:'Revenue',expenses:'Expenses',netProfit:'Net profit',assets:'Assets',liabilities:'Liabilities',recordedEquity:'Recorded equity',cumulativeProfit:'Cumulative profit',totalEquity:'Total equity'};
 const summary=(values:Amounts)=>Object.entries(values).map(([k,v])=>({label:(labels[k]||k)+' (LKR)',value:v}));
 function report():BusinessReport{
 const warning='PROVISIONAL — operational completeness not verified';
 if(statements)return {title:'General ledger trial balance',filename:'ars-ledger-trial-balance-'+to,period:'Cumulative through '+to+' | '+warning,headers:['Account code','Account','Classification','Debit balance (LKR)','Credit balance (LKR)'],rows:statements.accounts.map(a=>[a.code,a.name,a.kind,a.trialDebit,a.trialCredit]),summary:[...summary(statements.trialBalance),...(statements.profitAndLoss?summary(statements.profitAndLoss):[]),...(statements.balanceSheet?summary(statements.balanceSheet):[])],csvPreamble:[['Status',warning],['As of',to],['Posting',statements.postingEnabled?'Enabled':'Disabled'],...summary(statements.trialBalance).map(s=>[s.label,s.value]),...(statements.profitAndLoss?summary(statements.profitAndLoss).map(s=>[s.label,s.value]):[]),...(statements.balanceSheet?summary(statements.balanceSheet).map(s=>[s.label,s.value]):[])]};
 if(activity)return {title:'General ledger activity — displayed page',filename:'ars-journal-'+from+'-'+to+'-page-'+(offset/50+1),period:from+' to '+to+' | Page '+(offset/50+1)+' | '+warning,headers:['Date','Source','Reference','Account','Debit (LKR)','Credit (LKR)','Recorded by'],rows:activity.rows.flatMap(j=>(j.lines||[]).map(l=>[j.day,j.source_kind,j.source_id,l.accountCode,l.debit,l.credit,j.recorded_by])),csvPreamble:[['Status',warning],['Page',offset/50+1]]};
 throw Error('Load the report first.');
 }
 const metrics=(title:string,values:Amounts|null)=><div className="rounded-lg border p-3"><h4 className="font-semibold">{title}</h4>{values?<dl className="grid grid-cols-2 gap-2 mt-2">{summary(values).map(x=><div key={x.label}><dt className="text-xs text-slate-600">{x.label}</dt><dd className="font-semibold tabular-nums">{money(x.value)}</dd></div>)}</dl>:<p className="text-sm text-slate-600">Unavailable until an approved opening journal and accounting cutover exist.</p>}</div>;
 return <section className="rounded-xl border bg-white p-4 space-y-3"><h3 className="font-semibold text-lg">General ledger reporting</h3><p className="text-sm border border-amber-300 rounded p-2">Provisional ledger only. Not certified accounts or proof of operational reconciliation.</p>
 <div className="flex flex-wrap gap-2"><button type="button" className={field} aria-pressed={tab==='statements'} onClick={()=>setTab('statements')}>Financial statements</button><button type="button" className={field} aria-pressed={tab==='activity'} onClick={()=>setTab('activity')}>Journal activity</button></div>
 <div className="flex flex-wrap items-end gap-2">{tab==='activity'&&<label className="text-sm">From<input type="date" className={'block '+field} max={to} value={from} onChange={e=>{setFrom(e.target.value);setOffset(0);}}/></label>}<label className="text-sm">{tab==='statements'?'As of':'To'}<input type="date" className={'block '+field} max={today} value={to} onChange={e=>{setTo(e.target.value);setOffset(0);}}/></label><button type="button" className={field} onClick={()=>{setOffset(0);setRevision(n=>n+1);}}>Refresh</button>{current?.data&&<ReportExportMenu report={report} settings={{...settings,activeShopId:shopId}}/>}</div>
 {!valid?<p role="alert">Select a valid reporting date range.</p>:!current?<p role="status">Loading ledger report…</p>:current.error?<p role="alert" className="text-red-700">{current.error}</p>:null}
 {statements&&<><p className="text-sm">Posting: {statements.postingEnabled?'Enabled':'Disabled'} · Cutover: {statements.cutoverDate||'Not activated'} · Journals: {statements.journalCount}</p><div className="grid lg:grid-cols-3 gap-2">{metrics('Trial balance',statements.trialBalance)}{metrics('Cumulative profit and loss',statements.profitAndLoss)}{metrics('Balance sheet',statements.balanceSheet)}</div><label className="text-sm">Search accounts<input className={'block '+field} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Code or name"/></label><div className="overflow-x-auto max-h-96"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-100"><tr>{['Code','Account','Class','Debit (LKR)','Credit (LKR)'].map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{statements.accounts.filter(a=>(a.code+' '+a.name).toLowerCase().includes(search.toLowerCase())).map(a=><tr key={a.code} className="border-t"><td className="p-2">{a.code}</td><td>{a.name}{!a.active?' (inactive)':''}</td><td>{a.kind}</td><td className="text-right">{money(a.trialDebit)}</td><td className="text-right">{money(a.trialCredit)}</td></tr>)}</tbody></table></div><p className="text-xs">Exports include all accounts, not only search results. {statements.note}</p></>}
 {activity&&<><div className="space-y-2 max-h-96 overflow-auto">{activity.rows.map(j=><details key={j.id} className="border rounded p-2"><summary className="cursor-pointer text-sm font-medium">{j.day} · {j.source_kind} · {j.description}</summary><p className="text-xs break-all">{j.source_id} · {j.recorded_by}</p>{(j.lines||[]).map((l,i)=><div key={i} className="grid grid-cols-3 text-sm border-t py-1"><span>{l.accountCode}</span><span>Dr {money(l.debit)}</span><span>Cr {money(l.credit)}</span></div>)}</details>)}{!activity.rows.length&&<p>No journals in this date range.</p>}</div><div className="flex items-center gap-2"><button type="button" className={field} disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Previous</button><span>Page {offset/50+1}</span><button type="button" className={field} disabled={activity.nextOffset===null} onClick={()=>{if(activity.nextOffset!==null)setOffset(activity.nextOffset);}}>Next</button></div><p className="text-xs">Exports contain the displayed page only. {activity.note}</p></>}
 </section>;
}
