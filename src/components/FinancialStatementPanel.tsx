import React,{useEffect,useState} from 'react';
import {reportDay} from '../utils/reporting';
import {ReportExportMenu} from './ReportExportMenu';
import type {StoreSettings} from '../types';
import type {BusinessReport} from '../utils/businessReport';
type Account={id:string;name:string;kind:string;active:boolean};
type Movement={id:string;kind:string;sourceId:string;recordedBy:string;recordedAt:string;effectiveDate:string;note?:string;amount:number;runningBalance:number};
type Statement={account:Account;fromDate:string;toDate:string;offset:number;limit:number;total:number;opening:number;inflows:number;outflows:number;closing:number;rows:Movement[]};
const money=(n:number)=>n.toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
const field='rounded-lg border border-slate-300 p-2 text-sm';
export default function FinancialStatementPanel({authToken,shopId,settings}:{authToken:string;shopId:string;settings:StoreSettings}){
  const today=reportDay(new Date());
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [accountId,setAccountId]=useState('');
  const [from,setFrom]=useState(today.slice(0,7)+'-01');
  const [to,setTo]=useState(today);
  const [offset,setOffset]=useState(0);
  const [revision,setRevision]=useState(0);
  const [loading,setLoading]=useState(false);
  const [accountsLoading,setAccountsLoading]=useState(true);
  const [error,setError]=useState('');
  const [accountError,setAccountError]=useState('');
  const [statement,setStatement]=useState<Statement|null>(null);
  const limit=100;
  async function read(path:string,signal?:AbortSignal){
    const r=await fetch(path,{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},cache:'no-store',signal});
    const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load statement.');return data;
  }
  useEffect(()=>{
    const controller=new AbortController();setAccounts([]);setAccountId('');setOffset(0);setStatement(null);setAccountsLoading(true);setAccountError('');
    read('/api/financial-accounts',controller.signal).then(data=>{if(!Array.isArray(data))throw Error('Invalid account response.');if(!controller.signal.aborted)setAccounts(data);}).catch(e=>{if(!controller.signal.aborted)setAccountError(e.message);}).finally(()=>{if(!controller.signal.aborted)setAccountsLoading(false);});
    return ()=>controller.abort();
  },[authToken,shopId]);
  const valid=!!accountId&&!!from&&!!to&&from<=to&&to<=today;
  useEffect(()=>{
    setStatement(null);setError('');
    if(!valid){setLoading(false);return;}
    const controller=new AbortController();setLoading(true);
    const query=new URLSearchParams({fromDate:from,toDate:to,offset:String(offset),limit:String(limit)});
    read('/api/financial-accounts/'+encodeURIComponent(accountId)+'/statement?'+query,controller.signal).then(data=>{if(!controller.signal.aborted)setStatement(data);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[authToken,shopId,accountId,from,to,offset,revision,valid]);
  const current=statement&&statement.account.id===accountId&&statement.fromDate===from&&statement.toDate===to&&statement.offset===offset?statement:null;
  // Export only the exact page already retrieved from the server. Never label a partial export as a full statement.
  function report():BusinessReport{
    if(!current)throw Error('Load a statement before exporting.');
    const start=current.total?current.offset+1:0,end=current.offset+current.rows.length;
    return {title:'Financial account statement — '+current.account.name,filename:'ars-account-statement-'+from+'-'+to+'-page-'+(Math.floor(offset/limit)+1),period:from+' to '+to+' | Rows '+start+'–'+end+' of '+current.total+' | Recorded ledger only',headers:['Date','Movement','Reference','Note','Recorded by','Amount (LKR)','Running balance (LKR)'],moneyColumns:[5,6],rows:current.rows.map(m=>[m.effectiveDate,m.kind,m.sourceId,m.note||'',m.recordedBy,m.amount,m.runningBalance]),summary:[{label:'Period opening (LKR)',value:current.opening},{label:'Period inflows (LKR)',value:current.inflows},{label:'Period outflows (LKR)',value:current.outflows},{label:'Period closing (LKR)',value:current.closing}],csvPreamble:[['Account',current.account.name],['Period',from+' to '+to],['Rows',start+'–'+end+' of '+current.total],['Period opening (LKR)',current.opening],['Period inflows (LKR)',current.inflows],['Period outflows (LKR)',current.outflows],['Period closing (LKR)',current.closing]]};
  }
  return <section className="rounded-xl border bg-white p-4 space-y-4">
    <div><h3 className="text-lg font-semibold">Financial account statements</h3><p className="text-xs text-slate-500">Recorded ledger only. Inflows and outflows include internal transfers; these are not profit or sales figures.</p></div>
    <div className="flex flex-wrap items-end gap-2"><label className="text-sm">Account<select className={'block '+field} disabled={accountsLoading} value={accountId} onChange={e=>{setAccountId(e.target.value);setOffset(0);}}><option value="">{accountsLoading?'Loading accounts…':'Select account'}</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.kind}{a.active?'':' (inactive)'}</option>)}</select></label><label className="text-sm">From<input className={'block '+field} type="date" max={to} value={from} onChange={e=>{setFrom(e.target.value);setOffset(0);}}/></label><label className="text-sm">To<input className={'block '+field} type="date" min={from} max={today} value={to} onChange={e=>{setTo(e.target.value);setOffset(0);}}/></label><button type="button" className={field} disabled={!valid||loading} onClick={()=>{setOffset(0);setRevision(v=>v+1);}}>Refresh</button></div>
    {(accountError||error)&&<p role="alert" className="text-sm text-red-700">{accountError||error}</p>}
    {loading?<p className="text-sm">Loading statement…</p>:current?<><div className="grid grid-cols-2 lg:grid-cols-4 gap-2">{[{label:'Period opening',value:current.opening},{label:'Period inflows',value:current.inflows},{label:'Period outflows',value:current.outflows},{label:'Period closing',value:current.closing}].map(x=><div key={x.label} className="rounded border p-3"><span className="block text-xs text-slate-500">{x.label}</span><strong>Rs. {money(x.value)}</strong></div>)}</div><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">Export displayed page:</span><ReportExportMenu report={report} settings={{...settings,activeShopId:shopId}}/></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['Date','Movement / reference','Recorded by','Inflow','Outflow','Running balance'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{current.rows.map(m=><tr key={m.id} className="border-t"><td className="p-2">{m.effectiveDate}</td><td className="p-2">{m.kind}<div className="text-xs break-all text-slate-500">{m.sourceId}</div>{m.note&&<div className="text-xs">{m.note}</div>}</td><td className="p-2">{m.recordedBy}</td><td className="p-2 text-right tabular-nums">{m.amount>0?money(m.amount):'—'}</td><td className="p-2 text-right tabular-nums">{m.amount<0?money(-m.amount):'—'}</td><td className="p-2 text-right font-medium tabular-nums">{money(m.runningBalance)}</td></tr>)}</tbody></table>{!current.rows.length&&<p className="p-3 text-sm">No movements on this page.</p>}</div><div className="flex items-center justify-between gap-2 text-sm"><span>{current.total?current.offset+1:0}–{current.offset+current.rows.length} of {current.total}</span><div className="flex gap-2"><button type="button" className={field} disabled={offset===0} onClick={()=>setOffset(o=>Math.max(0,o-limit))}>Previous</button><button type="button" className={field} disabled={offset+limit>=current.total} onClick={()=>setOffset(o=>o+limit)}>Next</button></div></div><p className="text-xs text-slate-500">Pages are live snapshots. Refresh from page one if new movements were posted during review. Exports contain only the displayed page.</p></>:<p className="text-sm text-slate-500">Select an account and valid date range to view its statement.</p>}
  </section>;
}
