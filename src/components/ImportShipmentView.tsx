import React,{useEffect,useState} from 'react';
import {Ship,PackageCheck,Plus,RefreshCcw,ShieldCheck} from 'lucide-react';
import PartialReceiptPanel from './PartialReceiptPanel';
import type {PurchaseOrder,Role} from '../types';

type Shipment = {
 id:string; shop_id:string; purchase_order_id:string; shipment_reference:string;
 container_number:string; origin_country:string; eta_date:string|null;
 invoice_currency:string; exchange_rate_lkr:string; freight_lkr:string; customs_lkr:string;
 clearance_lkr:string; notes:string; status:string; po_number:string; supplier_name:string;
};
type Props={authToken:string;shopId:string;currentRole:Role;purchaseOrders:PurchaseOrder[];onRefreshDb:()=>void;mode:'shipments'|'receiving'};
export default function ImportShipmentView({authToken,shopId,currentRole,purchaseOrders,onRefreshDb,mode}:Props){
 const [rows,setRows]=useState<Shipment[]>([]);
 const [loading,setLoading]=useState(false);
 const [receivingPo,setReceivingPo]=useState<{id:string;number:string}|null>(null);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [form,setForm]=useState({purchaseOrderId:'',shipmentReference:'',containerNumber:'',etaDate:'',
   currency:'CNY',exchangeRateLkr:'1',freightLkr:'0',customsLkr:'0',clearanceLkr:'0',notes:''});
 const fetchWithAuth=(url:string,options:RequestInit={})=>fetch(url,{
   ...options,headers:{Authorization:`Bearer ${authToken}`,'X-Shop-Id':shopId,'Content-Type':'application/json',...options.headers}
 });
 const refresh=async()=>{
   setLoading(true);setError('');
   try {const response=await fetchWithAuth('/api/ars/import-shipments');const data=await response.json();
     if(!response.ok)throw Error(data.error||'Failed to load shipments');setRows(data);
   }catch(e:any){setError(e.message||'Unable to load shipments');}
   finally{setLoading(false);}
 };
 useEffect(()=>{void refresh();},[authToken,shopId]);
 const add=async(event:React.FormEvent)=>{
   event.preventDefault();setSaving(true);setError('');setNotice('');
   try{const response=await fetchWithAuth('/api/ars/import-shipments',{method:'POST',body:JSON.stringify(form)});
     const data=await response.json();if(!response.ok)throw Error(data.error||'Could not register shipment');
     setNotice('Shipment registered. Stock has NOT been changed.');
     setForm({purchaseOrderId:'',shipmentReference:'',containerNumber:'',etaDate:'',currency:'CNY',exchangeRateLkr:'1',freightLkr:'0',customsLkr:'0',clearanceLkr:'0',notes:''});
     await refresh();
   }catch(e:any){setError(e.message||'Unable to register shipment');}finally{setSaving(false);}
 };
 const openOrders=purchaseOrders.filter(po=>po.shopId===shopId&&['Pending','Ordered'].includes(po.status)&&!rows.some(row=>row.purchase_order_id===po.id));
 const format=(value:any)=>Number(value||0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
 return <div className="space-y-5">
   <header className="rounded-2xl bg-[#172a47] p-6 text-white">
     <p className="text-xs font-bold uppercase tracking-wider text-amber-300">ARS Import Operations</p>
     <h2 className="mt-2 flex items-center gap-2 font-heading text-2xl font-bold">{mode==='shipments'?<Ship className="h-6 w-6"/>:<PackageCheck className="h-6 w-6"/>}{mode==='shipments'?'Import Shipment Register':'Warehouse Receiving'}</h2>
     <p className="mt-2 text-sm text-slate-300">{mode==='shipments'?'Link incoming China shipments to purchase orders and record freight, customs and expected arrival.':'Receive confirmed purchase orders with atomic stock posting and duplicate-receipt protection.'}</p>
   </header>
   {error&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
   {notice&&<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
   {mode==='shipments'&&['Super Admin','Store Manager'].includes(currentRole)&&
    <form onSubmit={add} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-lg font-bold">Register incoming shipment</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-semibold">Purchase order *
          <select required value={form.purchaseOrderId} onChange={e=>setForm(v=>({...v,purchaseOrderId:e.target.value}))}
            className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="">Select open purchase order</option>
            {openOrders.map(po=><option key={po.id} value={po.id}>{po.poNumber} · {po.supplierName}</option>)}</select>
        </label>
        {([['shipmentReference','Shipment reference *'],['containerNumber','Container / BL reference'],['etaDate','Expected arrival date'],['exchangeRateLkr','LKR per foreign unit *'],['freightLkr','Freight LKR'],['customsLkr','Customs / duty LKR'],['clearanceLkr','Clearance LKR']] as const).map(([field,label])=>
          <label key={field} className="text-xs font-semibold">{label}
            <input required={field==='shipmentReference'||field==='exchangeRateLkr'} type={field==='etaDate'?'date':field==='exchangeRateLkr'||field.endsWith('Lkr')?'number':'text'}
              min={field==='exchangeRateLkr'?'0.000001':field.endsWith('Lkr')?'0':undefined}
              step={field==='exchangeRateLkr'?'any':field.endsWith('Lkr')?'0.01':undefined}
              value={form[field]} onChange={e=>setForm(v=>({...v,[field]:e.target.value}))}
              className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
          </label>)}
        <label className="text-xs font-semibold">Invoice currency<select value={form.currency} onChange={e=>setForm(v=>({...v,currency:e.target.value}))}
          className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
          <option value="CNY">CNY</option><option value="USD">USD</option><option value="LKR">LKR</option></select></label>
      </div>
      <label className="mt-3 block text-xs font-semibold">Notes / shipping documents
        <textarea value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))} rows={2} maxLength={2000} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm" />
      </label>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600"/>Registering a shipment does not add stock or pay suppliers.</p>
        <button type="submit" disabled={saving||!openOrders.length} className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-xs font-bold text-slate-900 disabled:opacity-50"><Plus className="h-4 w-4"/>Register shipment</button>
      </div>
    </form>}
   <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
     <div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-bold">{mode==='shipments'?'Shipment history':'Shipments awaiting warehouse receipt'}</h3>
       <button type="button" disabled={loading} onClick={()=>void refresh()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><RefreshCcw className="h-4 w-4"/>Refresh</button></div>
     <div className="space-y-3">
       {rows.filter(row=>mode==='shipments'||['In Transit','Partially Received'].includes(row.status)).map(row=><article key={row.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center">
         <div className="min-w-0"><p className="font-bold text-slate-900">{row.shipment_reference} · {row.po_number}</p>
           <p className="mt-1 text-xs text-slate-600">{row.supplier_name} · {row.origin_country} · {row.invoice_currency} · {row.container_number||'Container not entered'}</p>
           <p className="mt-1 text-xs text-slate-500">ETA: {row.eta_date?String(row.eta_date).slice(0,10):'Not set'} · Freight Rs.{format(row.freight_lkr)} · Customs Rs.{format(row.customs_lkr)} · Clearance Rs.{format(row.clearance_lkr)}</p></div>
         <div className="flex shrink-0 items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${row.status==='Received'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-800'}`}>{row.status}</span>
           {mode==='receiving'&&<button type="button" disabled={saving} onClick={()=>setReceivingPo({id:row.purchase_order_id,number:row.po_number})} className="rounded-xl bg-[#172a47] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">Receive quantities</button>}
         </div>
       </article>)}
       {!rows.some(row=>mode==='shipments'||row.status==='In Transit')&&<p className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">No shipments to show. Create a supplier purchase order first, then register its shipment.</p>}
     </div>
     {mode==='receiving'&&<p className="mt-4 text-xs text-amber-800">Only record verified goods actually received. Damaged or missing items must remain outstanding; formal discrepancy resolution is still pending.</p>}
   </section>
   {mode==='receiving'&&receivingPo&&<PartialReceiptPanel poId={receivingPo.id} poNumber={receivingPo.number} authToken={authToken} shopId={shopId} onClose={()=>setReceivingPo(null)} onCommitted={()=>{void refresh();onRefreshDb();}} />}
 </div>;
}
