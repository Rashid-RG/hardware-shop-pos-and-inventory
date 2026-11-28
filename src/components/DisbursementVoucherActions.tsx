import React,{useRef,useState} from 'react';
export default function DisbursementVoucherActions({kind,id,authToken,shopId}:{kind:'supplier'|'expense'|'supplier-refund'|'import-recovery';id:string;authToken:string;shopId:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),scope=useRef('');scope.current=JSON.stringify([authToken,shopId,id,kind]);
 const open=async(mode:'download'|'print')=>{
  if(lock.current)return;
  const expected=scope.current;
  const preview=mode==='print'?window.open('','_blank'):null;
  if(mode==='print'&&!preview){setError('Allow pop-ups to open the printable voucher.');return;}
  if(preview)preview.document.body.textContent='Loading verified payment voucher…';
  lock.current=true;setBusy(true);setError('');
  try{
   const endpoint=kind==='import-recovery'?'ledger/import-charge-recovery-receipts':kind==='supplier-refund'?'ledger/supplier-refund-receipts':kind==='supplier'?'supplier-payments':'manual-expenses';
   const r=await fetch('/api/'+endpoint+'/'+encodeURIComponent(id)+'/pdf',{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':shopId},cache:'no-store'});
   if(!r.ok){const d=await r.json().catch(()=>null);throw Error(d?.error||'Voucher unavailable.');}
   if(!r.headers.get('Content-Type')?.includes('application/pdf'))throw Error('Invalid voucher response.');
   const blob=await r.blob();if(scope.current!==expected){preview?.close();return;}
   const url=URL.createObjectURL(blob);
   if(preview){preview.location.replace(url);setTimeout(()=>URL.revokeObjectURL(url),300000);}
   else{const a=document.createElement('a');a.href=url;a.download=(kind==='import-recovery'?'import-charge-recovery-':kind==='supplier-refund'?'supplier-refund-':'voucher-')+id.replace(/[^a-zA-Z0-9_-]/g,'-')+'.pdf';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  }catch(e){preview?.close();if(scope.current===expected)setError(e instanceof Error?e.message:'Unable to open voucher.');}
  finally{lock.current=false;setBusy(false);}
 };
 return <div className="space-y-1 text-xs font-sans"><div className="flex flex-wrap gap-1"><button type="button" disabled={busy} onClick={()=>void open('download')} className="border rounded px-2 py-1 text-slate-700">{busy?'Loading…':(kind==='supplier-refund'||kind==='import-recovery')?'Receipt PDF':'Voucher PDF'}</button><button type="button" disabled={busy} onClick={()=>void open('print')} className="border rounded px-2 py-1 text-slate-700">Open / print</button></div>{error&&<p role="alert" className="text-red-700 max-w-xs whitespace-normal">{error}</p>}</div>;
}
