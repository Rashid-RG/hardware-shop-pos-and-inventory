import React, { useMemo, useState } from 'react';
import { Calculator, Container, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { estimateImportLandedCost, type ImportLine } from '../utils/importLandedCost';

const formatLkr = (value: number) => new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const newLine = (): ImportLine => ({ sku: '', description: '', quantity: 1, unitForeign: 0 });

export default function ImportCostPlanner() {
  const [currency, setCurrency] = useState<'CNY' | 'USD' | 'LKR'>('CNY');
  const [exchangeRateLkr, setExchangeRateLkr] = useState(1);
  const [freightLkr, setFreightLkr] = useState(0);
  const [dutiesLkr, setDutiesLkr] = useState(0);
  const [clearanceLkr, setClearanceLkr] = useState(0);
  const [otherLkr, setOtherLkr] = useState(0);
  const [lines, setLines] = useState<ImportLine[]>([newLine()]);
  const result = useMemo(() => {
    try {
      return { estimate: estimateImportLandedCost({ currency, exchangeRateLkr, freightLkr, dutiesLkr, clearanceLkr, otherLkr, lines }), error: '' };
    } catch (error) {
      return { estimate: null, error: (error as Error).message };
    }
  }, [currency, exchangeRateLkr, freightLkr, dutiesLkr, clearanceLkr, otherLkr, lines]);
  const edit = (index: number, patch: Partial<ImportLine>) => setLines((previous) => previous.map((row, i) => i === index ? { ...row, ...patch } : row));
  const numberInput = (label: string, value: number, setValue: (value: number) => void) => (
    <label className="block text-xs font-semibold text-slate-700">{label}
      <input type="number" min="0" step="any" value={value} onChange={(e) => setValue(Number(e.target.value))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200" />
    </label>
  );
  return (
    <div className="space-y-5">
      <header className="rounded-2xl bg-[#182a45] px-5 py-6 text-white sm:px-7">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-300">Imports · Sri Lanka distribution</p>
        <h2 className="mt-2 flex items-center gap-2 font-heading text-2xl font-bold"><Container className="h-6 w-6 text-amber-400" /> Landed Cost Planner</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">Estimate the true Sri Lankan rupee cost of imported goods, including freight, customs and clearance. Specify your actual supplier currency and exchange rate.</p>
      </header>
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold">Shipment cost assumptions</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-700">Supplier invoice currency
              <select value={currency} onChange={(e) => { const next = e.target.value as 'CNY' | 'USD' | 'LKR'; setCurrency(next); if (next === 'LKR') setExchangeRateLkr(1); }} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <option value="CNY">CNY · China yuan</option><option value="USD">USD · US dollar</option><option value="LKR">LKR · Sri Lankan rupee</option>
              </select>
            </label>
            {numberInput('LKR per 1 foreign unit', exchangeRateLkr, setExchangeRateLkr)}
            {numberInput('Freight / shipping · LKR', freightLkr, setFreightLkr)}
            {numberInput('Import duties / taxes · LKR', dutiesLkr, setDutiesLkr)}
            {numberInput('Customs clearance · LKR', clearanceLkr, setClearanceLkr)}
            {numberInput('Other landed costs · LKR', otherLkr, setOtherLkr)}
          </div>
          <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> This is a planning estimate only. Nothing is posted to stock, supplier payments, accounts or partner capital.</p>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-2"><h3 className="font-bold">Import invoice lines</h3><button type="button" onClick={() => setLines((previous) => [...previous, newLine()])} disabled={lines.length >= 100} className="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-slate-900 disabled:opacity-50"><Plus className="h-4 w-4" /> Add item</button></div>
          <div className="max-h-[430px] space-y-3 overflow-y-auto pr-1">
            {lines.map((line, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex justify-between gap-2"><span className="text-xs font-bold text-slate-600">Item {index + 1}</span><button type="button" aria-label={`Remove import item ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((previous) => previous.filter((_, i) => i !== index))} className="text-slate-500 hover:text-rose-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input aria-label="SKU" value={line.sku} onChange={(e) => edit(index, { sku: e.target.value })} placeholder="SKU / item code" className="col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                  <input aria-label="Description" value={line.description} onChange={(e) => edit(index, { description: e.target.value })} placeholder="Product description" className="col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                  <label className="text-xs text-slate-600">Quantity<input type="number" min="1" step="1" value={line.quantity} onChange={(e) => edit(index, { quantity: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                  <label className="text-xs text-slate-600">Unit price · {currency}<input type="number" min="0" step="any" value={line.unitForeign} onChange={(e) => edit(index, { unitForeign: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-base font-bold"><Calculator className="h-5 w-5 text-amber-600" /> Estimated landed costs</h3>
        {result.error && <p role="alert" className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-900">{result.error}</p>}
        {result.estimate && (<>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[['Goods converted to LKR', result.estimate.goodsTotalLkr], ['Shipping, duties & clearance', result.estimate.chargesTotalLkr], ['Estimated landed total', result.estimate.grandTotalLkr]].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-100 bg-slate-50 p-4"><p className="text-xs font-medium text-slate-600">{label}</p><p className="mt-1 text-lg font-bold text-slate-900">{formatLkr(Number(value))}</p></div>
            ))}
          </div>
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[630px] text-left text-xs">
            <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-3">SKU</th><th>Qty</th><th>Goods · LKR</th><th>Allocated costs</th><th>Landed total</th><th>Cost per unit · LKR</th></tr></thead>
            <tbody>{result.estimate.detail.map((row, i) => <tr key={i} className="border-b border-slate-100"><td className="py-3 font-semibold">{row.sku}</td><td>{row.quantity}</td><td>{formatLkr(row.baseLkr)}</td><td>{formatLkr(row.allocatedChargesLkr)}</td><td>{formatLkr(row.landedTotalLkr)}</td><td className="font-bold">{formatLkr(row.landedUnitCostLkr)}</td></tr>)}</tbody>
          </table></div>
        </>)}
      </section>
    </div>
  );
}
