import { reportDay, reportTime } from '../utils/reporting';
import { ReportExportMenu } from './ReportExportMenu';
import type { BusinessReport } from '../utils/businessReport';
import React,{useEffect,useState,useRef} from 'react';
import {Landmark,ShieldCheck,RefreshCcw,Plus,Users,Wallet,History,ChartNoAxesColumn,ArrowRight} from 'lucide-react';
type CapitalRequest={requestId:string;partnerId:string;accountId:string;entryType:'Contribution'|'Drawing';amountLkr:string;entryDate:string;reference:string;note:string};
type CapitalAccount={id:string;name:string;kind:string;active:boolean;balance:number;balanceAfterChequeCommitments?:number};
type Partner={id:string;name:string;ownership_percent:string|null;is_active:boolean;};
type OwnershipAudit={id:string;partner_id:string;partner_name:string;old_percent:string|null;new_percent:string|null;change_type:string;reference:string;changed_by:string;changed_at:string;};
type Capital={id:string;partner_id:string;entry_type:'Contribution'|'Drawing';amount_lkr:string;entry_date:string;reference:string;note:string;created_by:string;};
type ProfitAllocation={id:string;period_key:string;approved_profit_lkr:string;approval_reference:string;allocated_at:string;approved_by:string;shares:Array<{partnerId:string;name:string;ownershipPercent:number;allocatedLkr:string}>};
type Agreement={id:string;effective_period:string;approval_reference:string;approved_by:string;approved_at:string;shares:Array<{partnerId:string;name:string;ownershipBasisPoints:number}>;};
import type {StoreSettings} from '../types';
type Props={taxConfig?:StoreSettings;authToken:string;shopId:string;owner?:string;key?:string;};
type PartnerWorkspace='overview'|'partners'|'agreements'|'capital'|'profits'|'history';
export default function PartnerCapitalView(props:Props){return <PartnerCapitalWorkspace key={JSON.stringify([props.shopId,props.owner,props.authToken])} {...props}/>;}
function PartnerCapitalWorkspace({taxConfig,authToken,shopId,owner}:Props){
 const [partners,setPartners]=useState<Partner[]>([]);
 const [workspace,setWorkspace]=useState<PartnerWorkspace>('overview');
 const [entries,setEntries]=useState<Capital[]>([]);
 const [profits,setProfits]=useState<ProfitAllocation[]>([]);
 const [audits,setAudits]=useState<OwnershipAudit[]>([]);
 const [agreements,setAgreements]=useState<Agreement[]>([]);
 const [agreementMonth,setAgreementMonth]=useState(()=>new Date().toISOString().slice(0,7));
 const [agreementReference,setAgreementReference]=useState('');
 const [agreementShares,setAgreementShares]=useState<Record<string,string>>({});
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
 const [date,setDate]=useState(()=>reportDay(new Date()));
 const [accounts,setAccounts]=useState<CapitalAccount[]>([]),[accountId,setAccountId]=useState(''),[pending,setPending]=useState<CapitalRequest|null>(null),[storageReady,setStorageReady]=useState(false);
 const capitalLock=useRef(false);
 const legacyStorageKey='ars:pending-partner-capital:'+shopId;
 const storageKey='ars:pending-partner-capital:v2:'+JSON.stringify([shopId,owner||'']);
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
   const [data,allocations,history,agreementHistory,financialAccounts]=await Promise.all([
     call('/api/ars/partners'),call('/api/ars/partner-profits'),
     call('/api/ars/partner-ownership-audit'),call('/api/ars/ownership-agreements'),call('/api/financial-accounts')]);
   setAccounts(financialAccounts.filter((a:CapitalAccount)=>a.active&&['Bank','Office Cash'].includes(a.kind)));
   setPartners(data.partners);setEntries(data.entries);setProfits(allocations);setAudits(history);setAgreements(agreementHistory);
   setAgreementShares(previous=>{
     const next:Record<string,string>={};
     for(const partner of data.partners as Partner[])if(partner.is_active)
       next[partner.id]=previous[partner.id]??String(partner.ownership_percent??'');
     return next;
   });
 }catch(e:any){setError(e.message)}};
 const approveAgreement=async(e:React.FormEvent)=>{
   e.preventDefault();
   const shares=partners.filter(p=>p.is_active).map(p=>({partnerId:p.id,ownershipPercent:Number(agreementShares[p.id])}));
   if(shares.some(share=>!Number.isFinite(share.ownershipPercent))||
      shares.some(share=>(agreementShares[share.partnerId]??'').trim()==='')){
     setError('Enter each active partner ownership percentage.');return;
   }
   if(!window.confirm(`Approve ownership agreement effective ${agreementMonth}? The agreement is permanent and future profit allocations will use these shares until a newer agreement begins.`))return;
   setBusy(true);setError('');setNotice('');
   try{
     await call('/api/ars/ownership-agreements',{method:'POST',body:JSON.stringify({
       effectivePeriod:agreementMonth,approvalReference:agreementReference.trim(),shares
     })});
     setNotice('Effective-dated ownership agreement approved. Historical allocations remain unchanged.');
     setAgreementReference('');await refresh();
   }catch(e:any){setError(e.message)}finally{setBusy(false);}
 };
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
 useEffect(()=>{setAccounts([]);setAccountId('');setPending(null);setStorageReady(false);try{if(!owner||localStorage.getItem(legacyStorageKey)!==null)throw Error('Unscoped saved request requires administrator review');const raw=localStorage.getItem(storageKey);if(raw){const p=JSON.parse(raw);if(!p||typeof p.requestId!=='string'||typeof p.accountId!=='string'||typeof p.amountLkr!=='string')throw Error('Invalid saved capital request');setPending(p);}setStorageReady(true);}catch{setError('Saved capital request cannot be read. Administrator review required.');}void refresh()},[authToken,shopId,owner]);
 const register=async(e:React.FormEvent)=>{
   e.preventDefault();setBusy(true);setError('');setNotice('');
   try{await call('/api/ars/partners',{method:'POST',body:JSON.stringify({name,ownershipPercent:ownership===''?null:Number(ownership)})});
     setName('');setOwnership('');setNotice('Partner registered without any assumed ownership or capital.');await refresh();
   }catch(e:any){setError(e.message)}finally{setBusy(false);}
 };
 const updateOwnership=async(partner:Partner,value:string)=>{
   const reference=window.prompt(`Approval/reason for updating ${partner.name}'s ownership:`);
   if(reference===null)return;
   if(reference.trim().length<3||reference.trim().length>160){
     setError('Enter an ownership approval/reference between 3 and 160 characters.');return;
   }
   setBusy(true);setError('');setNotice('');
   try{await call(`/api/ars/partners/${encodeURIComponent(partner.id)}/ownership`,{
     method:'PUT',body:JSON.stringify({ownershipPercent:value===''?null:Number(value),reference:reference.trim()})});
     setNotice('Ownership updated; no profit distribution was posted.');await refresh();
   }catch(e:any){setError(e.message)}finally{setBusy(false);}
 };
 const changeStatus=async(partner:Partner)=>{
   const next=!partner.is_active;
   const reference=window.prompt(`Reason/reference for ${next?'reactivating':'deactivating'} ${partner.name}:`);
   if(reference===null)return;
   if(reference.trim().length<3){setError('Enter a reason of at least 3 characters.');return;}
   if(!window.confirm(`Confirm ${next?'reactivation':'deactivation'} for ${partner.name}? Existing capital and approved allocations will remain permanently recorded.`))return;
   setBusy(true);setError('');setNotice('');
   try{await call(`/api/ars/partners/${encodeURIComponent(partner.id)}/status`,{
     method:'POST',body:JSON.stringify({isActive:next,reference:reference.trim()})});
     setNotice(next?'Partner reactivated. Reconfigure ownership before allocating profits.':'Partner deactivated. Historical entries remain available.');
     await refresh();
   }catch(e:any){setError(e.message)}finally{setBusy(false);}
 };
 const selectedAccount=accounts.find(a=>a.id===accountId);
 const capitalIssue=!partners.some(p=>p.id===partnerId&&p.is_active)?'Select an active partner.':!selectedAccount?'Select a financial account.':!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)||Number(amount)<=0?'Enter a positive amount with up to two decimals.':!date||date>reportDay(new Date())?'Select a valid effective date.':!reference.trim()?'Enter a payment reference.':type==='Drawing'&&(selectedAccount.balanceAfterChequeCommitments===undefined||Number(amount)>selectedAccount.balanceAfterChequeCommitments)?'Insufficient or unverified uncommitted funds.':'';
 const sendCapital=async(p:CapitalRequest)=>{
   if(capitalLock.current||!owner||!storageReady)return;capitalLock.current=true;setBusy(true);setError('');setNotice('');
   try{const result=await call('/api/ars/partner-capital/post',{method:'POST',body:JSON.stringify(p)});
     if(result.id!=='capital-'+p.requestId||typeof result.replayed!=='boolean')throw Error('Capital transaction not confirmed.');
     localStorage.removeItem(storageKey);setPending(null);setAmount('');setReference('');setNote('');setNotice('Capital transaction and financial journal confirmed.');await refresh();
   }catch(e:any){setError(e.message+' Original request retained for safe retry.');}finally{capitalLock.current=false;setBusy(false);}
 };
 const verifyCapital=async(p:CapitalRequest)=>{
   if(capitalLock.current||!owner||!storageReady)return;
   capitalLock.current=true;setBusy(true);setError('');setNotice('');
   try{
     const result=await call('/api/ars/partner-capital/requests/'+encodeURIComponent(p.requestId),{cache:'no-store'});
     if(result.status==='NotConfirmed'){setNotice('No committed transaction confirmed. Keep the original request; retry only with the same details.');return;}
     const cents=(v:unknown)=>typeof v==='string'&&/^\d{1,12}(?:\.\d{1,2})?$/.test(v)?Math.round(Number(v)*100):null;
     if(result.status!=='Committed'||result.requestId!==p.requestId||result.id!=='capital-'+p.requestId||result.partnerId!==p.partnerId||result.accountId!==p.accountId||result.entryType!==p.entryType||cents(result.amountLkr)===null||cents(result.amountLkr)!==cents(p.amountLkr)||result.entryDate!==p.entryDate||result.reference!==p.reference||result.note!==p.note||result.consistent!==true||result.journalId!=='partner-capital:'+result.id||result.movementId!=='partner-capital:'+result.id)throw Error('Committed details do not match saved request. Accounting review required.');
     if(localStorage.getItem(storageKey)!==JSON.stringify(p))throw Error('Saved request changed. Review before clearing.');
     localStorage.removeItem(storageKey);setPending(null);setAmount('');setReference('');setNote('');setNotice('Original capital transaction verified. No additional payment was posted.');await refresh();
   }catch(e:any){setError(e.message+' Original request retained.');}finally{capitalLock.current=false;setBusy(false);}
 };
 const postCapital=async(e:React.FormEvent)=>{
   e.preventDefault();if(busy||pending||!storageReady||capitalIssue||capitalLock.current)return;
   if(!window.confirm('Confirm this actual '+type.toLowerCase()+'? This permanently posts capital, financial movement and journal.'))return;
   const p:CapitalRequest={requestId:crypto.randomUUID(),partnerId,accountId,entryType:type,amountLkr:amount,entryDate:date,reference:reference.trim(),note:note.trim()};
   try{localStorage.setItem(storageKey,JSON.stringify(p));}catch{setError('Cannot safely preserve capital request.');return;}
   setPending(p);await sendCapital(p);
 };
 const n=(v:any)=>Number(v||0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
 const activePartners=partners.filter(p=>p.is_active);
 const ownershipTotal=activePartners.reduce((sum,p)=>sum+Number(p.ownership_percent||0),0);
 const allocationReady=activePartners.length>0&&activePartners.every(p=>p.ownership_percent!==null)&&Math.abs(ownershipTotal-100)<0.00001;
 const partnerReport=():BusinessReport=>{
 const base={period:'All available records | Confidential'};
 if(workspace==='profits')return {...base,title:'Approved partner profit allocations',filename:'ars-partner-profits',headers:['Period','Approval reference','Partner','Ownership (%)','Allocated (LKR)','Approved by','Allocated at'],moneyColumns:[4],rows:profits.flatMap(p=>p.shares.map(s=>[p.period_key,p.approval_reference,s.name,s.ownershipPercent,Number(s.allocatedLkr),p.approved_by,reportTime(p.allocated_at)])),summary:[{label:'Approved allocations',value:profits.length},{label:'Approved profit (LKR)',value:profits.reduce((a,p)=>a+Number(p.approved_profit_lkr),0)}]};
 if(workspace==='capital')return {...base,title:'Partner capital ledger',filename:'ars-partner-capital',headers:['Date','Partner','Type','Amount (LKR)','Reference','Note','Created by'],moneyColumns:[3],rows:entries.map(e=>[reportDay(e.entry_date),partners.find(p=>p.id===e.partner_id)?.name||e.partner_id,e.entry_type,Number(e.amount_lkr),e.reference,e.note,e.created_by]),summary:[{label:'Contributions (LKR)',value:entries.filter(e=>e.entry_type==='Contribution').reduce((a,e)=>a+Number(e.amount_lkr),0)},{label:'Drawings (LKR)',value:entries.filter(e=>e.entry_type==='Drawing').reduce((a,e)=>a+Number(e.amount_lkr),0)}]};
 return {...base,title:'Partner ownership register',filename:'ars-partner-ownership',headers:['Partner','Ownership (%)','Status'],rows:partners.map(p=>[p.name,p.ownership_percent===null?'Not assigned':Number(p.ownership_percent),p.is_active?'Active':'Inactive']),summary:[{label:'Active partners',value:activePartners.length},{label:'Assigned active ownership (%)',value:ownershipTotal}]};
 };
 const formField='mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-amber-400 focus:outline-none';
 return <div className="space-y-3">
  <header className="rounded-xl bg-[#172a47] px-3 py-2 text-white sm:px-4"><p className="text-xs font-bold uppercase tracking-widest text-amber-300">Super Admin Only · Confidential</p>
    <h2 className="mt-1 flex items-center gap-2 font-heading text-base font-bold"><Landmark className="h-4 w-4"/>Partner Capital & Ownership Ledger</h2>
    <p className="mt-1 text-xs text-slate-300">Add or deactivate partners as the business evolves. Profit allocations require all active ownership shares to total 100%, and never transfer funds.</p></header>
  {taxConfig&&['overview','partners','capital','profits'].includes(workspace)&&<ReportExportMenu report={partnerReport} settings={taxConfig}/>}
  {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
  <nav aria-label="Partner management workspaces" className="flex flex-wrap gap-1.5">
    {([
      ['overview','Overview',Landmark],
      ['partners','Partner Profiles',Users],
      ['agreements','Agreements',ShieldCheck],
      ['capital','Capital Ledger',Wallet],
      ['profits','Profit Allocations',ChartNoAxesColumn],
      ['history','Audit & History',History],
    ] as const).map(([id,label,Icon])=><button key={id} type="button"
      aria-current={workspace===id?'page':undefined}
      onClick={()=>{setWorkspace(id);setError('');setNotice('');}}
      className={`flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 ${workspace===id?'border-[#172a47] bg-[#172a47] text-white shadow-sm':'border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50'}`}>
      <Icon className="h-4 w-4 shrink-0"/><span>{label}</span>
    </button>)}
  </nav>
  {workspace==='overview'&&<section aria-label="Partner overview" className="space-y-3">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[
        ['Active partners',String(activePartners.length)],
        ['Registered partners',String(partners.length)],
        ['Assigned ownership',ownershipTotal.toFixed(2)+'%'],
        ['Approved allocations',String(profits.length)],
      ].map(([label,value])=><div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[11px] font-semibold text-slate-500">{label}</p>
        <p className="mt-2 text-xl font-bold text-[#172a47]">{value}</p>
      </div>)}
    </div>
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="font-bold text-slate-900">Partner management</h3>
      <p className="mt-1 text-sm text-slate-600">Choose a dedicated workspace above. Partner registration, capital entries, profit allocations and audit records no longer share one long scrolling page.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {([
          ['partners','Manage partners and ownership'],
          ['agreements','Approve effective-month ownership shares'],
          ['capital','Record contributions or drawings'],
          ['profits','Review and approve profit allocation'],
          ['history','Review permanent audit and activity history'],
        ] as const).map(([id,label])=><button key={id} type="button" onClick={()=>setWorkspace(id)}
          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-3 text-left text-xs font-semibold text-slate-700 hover:bg-amber-50">
          {label}<ArrowRight className="h-4 w-4 shrink-0"/>
        </button>)}
      </div>
      <p className="mt-3 text-xs font-medium text-slate-500">All financial records remain restricted to Super Admin. Profit allocations do not transfer funds.</p>
    </div>
  </section>}
  {workspace==='partners'&&<section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="font-bold">Partners ({activePartners.length} active · {partners.length} total)</h3><button type="button" onClick={()=>void refresh()} className="rounded-lg p-2 text-slate-600" aria-label="Refresh partner records"><RefreshCcw className="h-4 w-4"/></button></div>
      <p className="mt-1 text-xs text-slate-500">Ownership shares are optional until agreed. Shares must not exceed 100% combined.</p>
      <div className="mt-3 space-y-3">{partners.map(p=><div key={p.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2"><p className="text-sm font-bold">{p.name} {!p.is_active&&<span className="text-xs font-normal text-slate-500">(inactive)</span>}</p>
        <button type="button" disabled={busy} onClick={()=>void changeStatus(p)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 disabled:opacity-50">{p.is_active?'Deactivate':'Reactivate'}</button></div>
        {p.is_active&&<label className="mt-2 block text-xs font-semibold text-slate-600">Agreed ownership percentage
        <div className="mt-1 flex items-center gap-2"><input key={p.id+'-'+p.ownership_percent} id={'partner-pct-'+p.id} type="number" min="0" max="100" step="0.01" defaultValue={p.ownership_percent===null?'':p.ownership_percent} placeholder="Not yet agreed" className={formField+' mt-0'}/>
        <button type="button" disabled={busy} onClick={()=>{const element=document.getElementById('partner-pct-'+p.id) as HTMLInputElement|null;void updateOwnership(p,element?.value||'')}} className="shrink-0 rounded-lg bg-[#172a47] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">Update</button></div></label>}
      </div>)}</div>
      <p className="mt-3 text-xs font-bold text-slate-600">Allocated ownership: {ownershipTotal.toFixed(2)}% {ownershipTotal<100?'· Remainder unassigned':''}</p>
      <form onSubmit={register} className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row">
        <input aria-label="Partner name" required minLength={2} maxLength={120} placeholder="Partner full name" value={name} onChange={e=>setName(e.target.value)} className={formField+' mt-0 flex-1'}/>
        <input aria-label="Ownership percent optional" type="number" min="0" max="100" step="0.01" placeholder="% (optional)" value={ownership} onChange={e=>setOwnership(e.target.value)} className={formField+' mt-0 w-full sm:w-32'}/>
        <button disabled={busy} type="submit" className="flex items-center justify-center gap-1 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-slate-900 disabled:opacity-50"><Plus className="h-4 w-4"/>Add partner</button>
      </form>
    </section>}
    {workspace==='agreements'&&<section aria-label="Effective-dated ownership agreements"
    className="space-y-3">
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="font-bold text-[#172a47]">Approve ownership agreement</h3>
      <p className="mt-1 text-xs text-slate-600">One complete agreement per effective accounting month. Previous distributions never change. You cannot backdate an agreement to an already-approved allocation month.</p>
      <form onSubmit={approveAgreement} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">Effective accounting month
          <input type="month" required value={agreementMonth} onChange={e=>setAgreementMonth(e.target.value)} className={formField}/>
        </label>
        <label className="text-xs font-semibold text-slate-700">Signed agreement / approval reference
          <input required minLength={3} maxLength={160} value={agreementReference} onChange={e=>setAgreementReference(e.target.value)} className={formField} placeholder="Agreement or board resolution number"/>
        </label>
        <div className="sm:col-span-2 space-y-2">
          <h4 className="text-xs font-bold text-slate-700">Shares of every active partner</h4>
          {activePartners.map(p=><label key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-xs">
            <span className="font-semibold text-slate-700">{p.name}</span>
            <span className="flex items-center gap-1"><input aria-label={`Agreement ownership for ${p.name}`} type="number"
              min="0" max="100" step="0.01" required value={agreementShares[p.id]??''}
              onChange={e=>setAgreementShares(previous=>({...previous,[p.id]:e.target.value}))}
              className="w-28 rounded-lg border border-slate-300 px-2 py-2 text-right text-sm"/>%</span>
          </label>)}
          <p className="text-xs font-semibold text-slate-600">Proposed total: {activePartners.reduce((sum,p)=>sum+(Number(agreementShares[p.id])||0),0).toFixed(2)}% / 100.00%</p>
        </div>
        <button type="submit" disabled={busy||!activePartners.length||Math.round(activePartners.reduce((sum,p)=>sum+(Number(agreementShares[p.id])||0),0)*100)!==10000}
          className="rounded-xl bg-[#172a47] px-4 py-3 text-xs font-bold text-white disabled:opacity-50 sm:col-span-2">
          Approve permanent ownership agreement
        </button>
      </form>
    </div>
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="font-bold">Approved agreements ({agreements.length})</h3>
      {agreements.length===0&&<p className="mt-2 text-xs text-slate-500">No signed ownership agreements recorded. Older allocations continue to use the existing legacy shares until the first agreement.</p>}
      <div className="mt-3 space-y-2">{agreements.map(a=><div key={a.id} className="rounded-lg border border-slate-200 p-3">
        <p className="text-sm font-bold">Effective {a.effective_period}</p>
        <p className="text-xs text-slate-600">Reference: {a.approval_reference} · Approved by {a.approved_by}</p>
        <div className="mt-2 flex flex-wrap gap-2">{(a.shares||[]).map(share=><span key={share.partnerId}
          className="rounded-lg bg-slate-100 px-2 py-1 text-xs">{share.name}: {(share.ownershipBasisPoints/100).toFixed(2)}%</span>)}</div>
      </div>)}</div>
    </div>
  </section>}
  {workspace==='capital'&&<section aria-label="Record partner capital" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <h3 className="font-bold">Record partner contribution or drawing</h3>
      <p className="mt-1 text-xs text-slate-500">Records are immutable. Verify payment evidence and reference before saving.</p>
      {pending&&<div role="status" className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">Unconfirmed capital request. <p className="my-1 text-xs">{pending.entryType} · Rs. {n(pending.amountLkr)} · {pending.entryDate} · {pending.reference}</p><button type="button" disabled={busy} className="mr-2 rounded border px-2 py-1" onClick={()=>void verifyCapital(pending)}>Check committed status</button><button type="button" disabled={busy} className="rounded border px-2 py-1" onClick={()=>void sendCapital(pending)}>Retry exact request</button></div>}
      {capitalIssue&&<p className="text-xs text-amber-800">{capitalIssue}</p>}
      <form onSubmit={postCapital} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold">Partner
          <select required value={partnerId} onChange={e=>setPartnerId(e.target.value)} className={formField}><option value="">Select partner</option>{partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-xs font-semibold">Transaction type
          <select value={type} onChange={e=>setType(e.target.value as 'Contribution'|'Drawing')} className={formField}><option value="Contribution">Capital contribution</option><option value="Drawing">Partner drawing</option></select></label>
        <label className="text-xs font-semibold sm:col-span-2">Financial account<select required value={accountId} onChange={e=>setAccountId(e.target.value)} className={formField}><option value="">Select bank or office cash</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.kind}</option>)}</select></label>
        {selectedAccount&&<p className="text-xs sm:col-span-2">Recorded balance: Rs. {n(selectedAccount.balance)} · After cheque commitments: {selectedAccount.balanceAfterChequeCommitments===undefined?'Unavailable':'Rs. '+n(selectedAccount.balanceAfterChequeCommitments)}</p>}
        <label className="text-xs font-semibold">Amount LKR<input required min="0.01" step="0.01" type="number" value={amount} onChange={e=>setAmount(e.target.value)} className={formField}/></label>
        <label className="text-xs font-semibold">Effective date<input required type="date" value={date} onChange={e=>setDate(e.target.value)} className={formField}/></label>
        <label className="text-xs font-semibold sm:col-span-2">Bank transfer / voucher reference<input required maxLength={120} value={reference} onChange={e=>setReference(e.target.value)} className={formField}/></label>
        <label className="text-xs font-semibold sm:col-span-2">Notes<textarea maxLength={1000} rows={2} value={note} onChange={e=>setNote(e.target.value)} className={formField}/></label>
        <button type="submit" disabled={busy||!!pending||!storageReady||!!capitalIssue} className="rounded-xl bg-[#172a47] px-4 py-3 text-xs font-bold text-white disabled:opacity-50 sm:col-span-2">Post capital and accounting journal</button>
      </form>
    </section>}
  {workspace==='capital'&&<section aria-label="Partner capital entries" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <h3 className="font-bold">Partner capital activity ({entries.length} records)</h3>
    <div className="mt-3 max-h-[55dvh] overflow-auto"><table className="w-full min-w-[580px] text-left text-xs">
      <thead className="border-b border-slate-200 text-slate-500"><tr><th className="py-2">Date</th><th>Partner</th><th>Type</th><th>Amount · LKR</th><th>Reference</th></tr></thead>
      <tbody>{entries.map(e=><tr key={e.id} className="border-b border-slate-100"><td className="py-3">{reportDay(e.entry_date)}</td><td>{partners.find(p=>p.id===e.partner_id)?.name||'Unknown'}</td><td>{e.entry_type}</td><td className="font-semibold">{e.entry_type==='Drawing'?'-':'+'}{n(e.amount_lkr)}</td><td>{e.reference}</td></tr>)}</tbody>
    </table>{entries.length===0&&<p className="py-8 text-center text-xs text-slate-500">No capital contributions or drawings recorded yet.</p>}</div>
    <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600"/>New posted capital entries include cash or bank movements. Historical entries require separate reconciliation. Profit allocations remain separate.</p>
  </section>}
  {workspace==='history'&&<section aria-label="Partner ownership audit" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <h3 className="font-bold">Ownership and partner status history ({audits.length})</h3>
    <p className="mt-2 text-xs text-slate-500">Historical allocations keep the percentages used at approval time. Changes here affect future allocations only.</p>
    <div className="mt-3 max-h-[55dvh] overflow-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="border-b border-slate-200 text-slate-500"><tr><th className="py-2">When</th><th>Partner</th><th>Change</th><th>Share</th><th>Reference</th><th>By</th></tr></thead>
        <tbody>{audits.map(a=><tr key={a.id} className="border-b border-slate-100">
          <td className="py-2">{reportTime(a.changed_at)}</td><td>{a.partner_name}</td>
          <td>{a.change_type}</td><td>{a.old_percent??'–'} → {a.new_percent??'–'}%</td>
          <td>{a.reference}</td><td>{a.changed_by}</td></tr>)}</tbody>
      </table>
      {audits.length===0&&<p className="py-4 text-center text-xs text-slate-500">No ownership history recorded yet.</p>}
    </div>
  </section>}
  {workspace==='profits'&&<section aria-label="Approved partner profit allocation" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <h3 className="font-bold">Approved partner profit allocation ({profits.length} periods)</h3>
    <p className="mt-1 text-xs text-slate-600">Enter a profit amount approved from reconciled accounts. This is an allocation ledger only, not a cash payment, and cannot calculate business profit automatically.</p>
    <form onSubmit={recordProfit} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold">Accounting month<input type="month" required value={profitPeriod} onChange={e=>setProfitPeriod(e.target.value)} className={formField} /></label>
      <label className="text-xs font-semibold">Approved distributable profit (LKR)<input type="number" min="0.01" step="0.01" required value={approvedProfit} onChange={e=>setApprovedProfit(e.target.value)} className={formField}/></label>
      <label className="text-xs font-semibold sm:col-span-2">Approved financial statement / board reference<input required maxLength={160} value={profitApproval} onChange={e=>setProfitApproval(e.target.value)} className={formField} /></label>
      <label className="text-xs font-semibold sm:col-span-2">Allocation note<textarea value={profitNote} onChange={e=>setProfitNote(e.target.value)} maxLength={1000} rows={2} className={formField}/></label>
      <button type="submit" disabled={busy||!allocationReady}
        className="rounded-xl bg-[#172a47] px-4 py-3 text-xs font-bold text-white disabled:opacity-50 sm:col-span-2">
        Record approved allocation (no money transfer)
      </button>
    </form>
    {!allocationReady&&
      <p role="status" className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Configure at least one active partner and ensure every active partner has a percentage. Active ownership must total exactly 100% before allocating profits.</p>}
    <div className="mt-5 space-y-3">
      <h4 className="text-sm font-semibold">Past approved allocations</h4>
      {profits.length===0&&<p className="text-xs text-slate-500">No approved profit allocations recorded.</p>}
      {profits.map(p=><div key={p.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{p.period_key} · Rs.{n(p.approved_profit_lkr)}</strong><span className="text-xs text-slate-500">Reference: {p.approval_reference}</span></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{(p.shares||[]).map(share=><div key={share.partnerId} className="rounded-lg bg-white p-3 text-xs">
          <p className="font-semibold">{share.name}</p><p>{Number(share.ownershipPercent).toFixed(2)}% ownership</p>
          <p className="mt-1 text-sm font-bold">Rs.{n(share.allocatedLkr)}</p>
        </div>)}</div>
        <p className="mt-2 text-[11px] text-slate-500">Recorded by {p.approved_by} · {reportTime(p.allocated_at)} · Payment status: not tracked</p>
      </div>)}
    </div>
  </section>}
 </div>;
}
