import React, { useEffect, useMemo, useState, useRef } from 'react';
import { PackageCheck, RefreshCcw, ShieldCheck, X } from 'lucide-react';

type Line = { purchaseOrderItemId: number; productId: string; productName: string; ordered: number; received: number; remaining: number; sellingUnitLabel?: string; baseUnitsPerPurchaseUnit?: number };
type Batch = { id: string; received_by: string; note: string; created_at: string };
type Overview = { status: string; items: Line[]; batches: Batch[] };
type Props = { poId: string; poNumber: string; authToken: string; shopId: string; onClose: () => void; onCommitted: () => void };

export default function PartialReceiptPanel({ poId, poNumber, authToken, shopId, onClose, onCommitted }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [showOnlyOutstanding, setShowOnlyOutstanding] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [pendingReceipt, setPendingReceipt] = useState<{requestKey:string;note:string;items:{purchaseOrderItemId:number;quantity:number}[]}|null>(null);
  const posting = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const headers = { Authorization: `Bearer ${authToken}`, 'X-Shop-Id': shopId, 'Content-Type': 'application/json' };
  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/ars/purchases/${encodeURIComponent(poId)}/receipts`, { headers });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Cannot load receiving history');
      setOverview(data);
      setQuantities({});
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load receipts'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [poId, authToken, shopId]);
  const visibleLines = (overview?.items || []).filter(line =>
    (!showOnlyOutstanding || line.remaining > 0)
    && [line.productName, line.productId, String(line.purchaseOrderItemId)]
      .some(value => value.toLowerCase().includes(productSearch.trim().toLowerCase()))
  );
  const fillAllOutstanding = () => {
    if (!overview || saving || pendingReceipt) return;
    setQuantities(Object.fromEntries(overview.items.filter(line=>line.remaining>0)
      .map(line=>[line.purchaseOrderItemId,String(line.remaining)])));
  };
  const selected = useMemo(() => (overview?.items || []).flatMap(line => {
    const raw = quantities[line.purchaseOrderItemId] || '';
    if (!raw.trim() || raw === '0') return [];
    const quantity = Number(raw);
    return [{ purchaseOrderItemId: line.purchaseOrderItemId, quantity }];
  }), [overview, quantities]);
  const valid = selected.length > 0 && selected.every(line => {
    const info = overview?.items.find(item => item.purchaseOrderItemId === line.purchaseOrderItemId);
    return info && Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.quantity <= info.remaining;
  });
  const submit = async () => {
    if (posting.current || loading || (!pendingReceipt && !valid)) return;
    if (!pendingReceipt && !window.confirm(`Post ${selected.length} purchase line(s) to warehouse stock for ${poNumber}? This receipt cannot be edited or deleted.`)) return;
    const request = pendingReceipt || { requestKey, note, items: selected };
    posting.current = true;
    setPendingReceipt(request);
    setSaving(true); setError(''); setSuccess('');
    try {
      const response = await fetch(`/api/ars/purchases/${encodeURIComponent(poId)}/receipts`, {
        method: 'POST', headers, body: JSON.stringify(request)
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Could not save goods receipt');
      setSuccess(data.repeated ? 'Previous receipt found; stock was not added again.' : `Goods receipt recorded. Status: ${data.status}.`);
      setPendingReceipt(null); setRequestKey(crypto.randomUUID()); setNote('');
      await refresh(); onCommitted();
    } catch (e) {
      // Keep the request key unchanged so a retry is idempotent after an uncertain network result.
      setError((e instanceof Error ? e.message : 'Receipt failed') + ' If the connection failed, retry with the same receipt; do not enter a new delivery.');
    } finally { posting.current = false; setSaving(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Receive purchase order goods" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6">
      <section className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-4 text-white">
          <div><p className="text-xs font-bold uppercase tracking-wider text-amber-300">ARS Warehouse / Goods Received Note</p><h3 className="text-lg font-bold">{poNumber}</h3></div>
          <button type="button" aria-label="Close receiving" onClick={onClose} disabled={saving || !!pendingReceipt} className="rounded-lg p-2 hover:bg-slate-700"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-4 overflow-y-auto p-5">
          <p className="flex items-center gap-2 text-sm text-slate-600"><ShieldCheck className="h-4 w-4 text-emerald-600" />Only enter quantities physically checked and accepted at the warehouse.</p>
          {pendingReceipt && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Receipt request locked: {pendingReceipt.items.length} line(s). Retry the exact receipt until its outcome is confirmed. Do not create another delivery.</p>}
          {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          {success && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
          {loading && <p className="text-sm text-slate-500">Loading receiving balances…</p>}
          {!loading && overview && <>
            <div className="grid gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm sm:grid-cols-3">
              <div><p className="text-xs text-emerald-800">Purchase order lines</p><strong>{overview.items.length}</strong></div>
              <div><p className="text-xs text-emerald-800">Fully received lines</p><strong>{overview.items.filter(line=>line.remaining===0).length}</strong></div>
              <div><p className="text-xs text-emerald-800">Lines awaiting receipt</p><strong>{overview.items.filter(line=>line.remaining>0).length}</strong></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input id="ars-receiving-product-search" type="search" aria-label="Search purchase order items"
                value={productSearch} onChange={e=>setProductSearch(e.target.value)}
                placeholder="Search product or item code..." className="min-w-[180px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">
                <input type="checkbox" checked={showOnlyOutstanding} onChange={e=>setShowOnlyOutstanding(e.target.checked)}/>
                Remaining only
              </label>
              <button id="ars-receiving-fill-outstanding" type="button" disabled={saving || !!pendingReceipt}
                onClick={fillAllOutstanding} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900">
                Fill all outstanding quantities
              </button>
              <button type="button" disabled={saving || !!pendingReceipt} onClick={()=>setQuantities({})}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">Clear quantities</button>
            </div>
            <p className="text-xs text-slate-600">{visibleLines.length} matching products (all displayed). Enter actual accepted quantities only. Bulk fill is a draft until you confirm.</p>
            <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>Status: {overview.status}</strong><button type="button" disabled={saving || !!pendingReceipt} onClick={() => void refresh()} className="inline-flex items-center gap-1 text-slate-600 underline"><RefreshCcw className="h-4 w-4" /> Refresh</button></div>
            <div className="max-h-[42dvh] overflow-auto overscroll-contain rounded-xl border border-slate-200">
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="p-3">Product</th><th className="p-3">U/M</th><th className="p-3 text-right">Ordered</th><th className="p-3 text-right">Received</th><th className="p-3 text-right">Remaining</th><th className="p-3">Receive now</th></tr></thead>
                <tbody>{visibleLines.map(line => <tr key={line.purchaseOrderItemId} className="border-t border-slate-100">
                  <td className="p-3 font-semibold text-slate-800">{line.productName}</td><td className="p-3">{line.sellingUnitLabel || "—"}{line.baseUnitsPerPurchaseUnit && <span className="block text-xs text-slate-500">{line.baseUnitsPerPurchaseUnit} base units each</span>}</td>
                  <td className="p-3 text-right">{line.ordered}</td><td className="p-3 text-right">{line.received}</td><td className="p-3 text-right font-bold">{line.remaining}</td>
                  <td className="p-3"><input aria-label={`Receive ${line.productName}`} type="number" min="0" max={line.remaining} step="1" disabled={saving || !!pendingReceipt || line.remaining === 0}
                    value={quantities[line.purchaseOrderItemId] ?? ''} onChange={e => setQuantities(current => ({...current,[line.purchaseOrderItemId]:e.target.value}))}
                    placeholder={line.remaining ? '0' : 'Complete'} className="w-28 rounded-lg border border-slate-300 p-2 disabled:bg-slate-100" />{line.baseUnitsPerPurchaseUnit && <span className="block text-xs text-slate-500">{(Number(quantities[line.purchaseOrderItemId])||0)*line.baseUnitsPerPurchaseUnit} base units</span>}</td>
                </tr>)}</tbody>
              </table>
              {visibleLines.length===0&&<p className="p-5 text-center text-sm text-slate-500">No matching purchase-order products.</p>}
            </div>
            <label className="block text-xs font-semibold text-slate-700">Receiving note / container details
              <textarea disabled={saving || !!pendingReceipt} maxLength={1000} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Delivery batch, shortages, damaged packages or document reference" className="mt-1 block w-full rounded-xl border border-slate-200 p-3 text-sm" />
            </label>
            <div className="rounded-xl bg-slate-50 p-3"><h4 className="mb-2 text-xs font-bold uppercase text-slate-600">Complete receiving batch history ({overview.batches.length})</h4>
              {overview.batches.length === 0 ? <p className="text-sm text-slate-500">No goods received yet.</p> :
                <ul className="space-y-2">{overview.batches.map(batch => <li key={batch.id} className="text-xs text-slate-600"><strong>{new Date(batch.created_at).toLocaleString()}</strong> · {batch.received_by}{batch.note ? ' · ' + batch.note : ''}</li>)}</ul>}
            </div>
          </>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4">
          <div><p className="text-xs text-slate-500">{selected.length} line(s) selected · quantities use each line’s U/M</p>{selected.length>0&&!valid&&<p role="alert" className="mt-1 text-xs text-rose-700">Correct invalid quantities before posting. Each quantity must be a whole number within its remaining balance.</p>}</div>
          <div className="flex gap-2"><button type="button" onClick={onClose} disabled={saving || !!pendingReceipt} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm">Close</button>
            <button type="button" onClick={() => void submit()} disabled={saving || loading || (!pendingReceipt && (!valid || overview?.status === 'Received'))} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><PackageCheck className="h-4 w-4" />{saving ? 'Recording…' : pendingReceipt ? 'Retry exact receipt' : 'Confirm received quantities'}</button></div>
        </footer>
      </section>
    </div>
  );
}
