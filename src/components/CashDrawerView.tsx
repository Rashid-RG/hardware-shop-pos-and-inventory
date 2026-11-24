import { reportTime } from '../utils/reporting';
import { ReportExportMenu } from './ReportExportMenu';
import type { BusinessReport } from '../utils/businessReport';
import React, { useState } from 'react';
import { notify } from '../utils/notifications';
import {
  Timer,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  History,
} from 'lucide-react';
import { CashShift, SalesTransaction } from '../types';

import type { StoreSettings } from '../types';
interface CashDrawerViewProps {
  taxConfig?: StoreSettings;
  cashShifts: CashShift[];
  transactions: SalesTransaction[];
  authToken: string;
  onRefreshDb: () => void;
}

function fmt(n: number) {
  return `Rs.${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CashDrawerView({ taxConfig, cashShifts, transactions, authToken, onRefreshDb }: CashDrawerViewProps) {
  const authFetch = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${authToken}`);
    if (!headers.has('Content-Type') && init?.body) headers.set('Content-Type', 'application/json');
    return fetch(url, { ...init, headers });
  };

  const openShift = cashShifts.find((s) => s.status === 'Open') || null;
  const closedShifts = cashShifts.filter((s) => s.status === 'Closed').sort((a, b) => b.openedAt.localeCompare(a.openedAt));

  const liveCashSalesSinceOpen = openShift
    ? transactions
        .filter((t) => t.paymentMethod === 'Cash' && t.status !== 'Refunded' && new Date(t.date) >= new Date(openShift.openedAt))
        .reduce((sum, t) => sum + Number(t.total || 0), 0)
    : 0;
  const liveExpectedCash = openShift
    ? Math.round((openShift.openingFloat + liveCashSalesSinceOpen) * 100) / 100
    : 0;

  const [floatAmount, setFloatAmount] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const handleOpenShift = async () => {
    const float = parseFloat(floatAmount);
    if (isNaN(float) || float < 0) return notify.warning('Enter a valid opening float amount.');
    setIsBusy(true);
    try {
      const res = await authFetch('/api/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloat: float }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to open shift' }));
        notify.warning(data.error || 'Failed to open shift.');
        return;
      }
      notify.success('Cash shift opened successfully.');
      setFloatAmount('');
      onRefreshDb();
    } finally {
      setIsBusy(false);
    }
  };

  const handleCloseShift = async () => {
    if (!openShift) return;
    const actual = parseFloat(actualCash);
    if (isNaN(actual) || actual < 0) return notify.warning('Enter the actual cash amount in drawer.');
    setIsBusy(true);
    try {
      const res = await authFetch(`/api/shifts/${openShift.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ closingCash: actual, notes: closingNote }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to close shift' }));
        notify.warning(data.error || 'Failed to close shift.');
        return;
      }
      notify.success('Cash shift closed and reconciliation saved.');
      setActualCash('');
      setClosingNote('');
      onRefreshDb();
    } finally {
      setIsBusy(false);
    }
  };

  const variance = openShift && actualCash !== '' && !isNaN(parseFloat(actualCash))
    ? parseFloat(actualCash) - liveExpectedCash
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-xs">
        <h2 className="text-xl font-heading font-semibold text-slate-900 flex items-center gap-2">
          <Timer className="w-5 h-5 text-indigo-500" /> Shift & Cash Drawer
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">Manage opening/closing of cash drawer shifts and track cash variances.</p>
      </div>

      {taxConfig&&<ReportExportMenu settings={taxConfig} report={()=>({title:'Closed cash shift reconciliation',filename:'ars-cash-shifts',period:'All closed shifts available to this workspace',headers:['Cashier','Opened','Closed','Opening float (LKR)','Expected cash (LKR)','Closing cash (LKR)','Difference (LKR)','Notes'],moneyColumns:[3,4,5,6],rows:closedShifts.map(s=>[s.cashierName,reportTime(s.openedAt),reportTime(s.closedAt||''),s.openingFloat,s.expectedCash??'',s.closingCash??'',s.cashDifference??'',s.notes||'']),summary:[{label:'Closed shifts',value:closedShifts.length},{label:'Recorded net variance (LKR)',value:closedShifts.reduce((a,s)=>a+(s.cashDifference??0),0)}]})}/>}
      {/* Current shift card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className={`rounded-xl border p-6 shadow-xs ${openShift ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-100'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {openShift ? (
                <span className="flex items-center gap-1.5 text-emerald-700 font-semibold text-sm"><CheckCircle2 className="w-4 h-4" /> Shift Open</span>
              ) : (
                <span className="flex items-center gap-1.5 text-slate-500 font-semibold text-sm"><AlertCircle className="w-4 h-4" /> No Active Shift</span>
              )}
            </div>
            {openShift && (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 font-mono px-2 py-1 rounded-full">{openShift.id.slice(-6).toUpperCase()}</span>
            )}
          </div>

          {openShift ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-lg p-3 border border-emerald-100">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">Opening Float</p>
                  <p className="font-bold text-slate-900 text-lg mt-1">{fmt(openShift.openingFloat)}</p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-emerald-100">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">Expected in Drawer</p>
                  <p className="font-bold text-indigo-700 text-lg mt-1">{fmt(liveExpectedCash)}</p>
                </div>
              </div>
              <div className="text-xs text-slate-500 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Opened: {reportTime(openShift.openedAt)}
                {openShift.cashierName && ` by ${openShift.cashierName}`}
              </div>

              {/* Close shift form */}
              <div className="border-t border-emerald-200 pt-4 space-y-2">
                <label className="block text-xs font-semibold text-slate-700">Actual Cash in Drawer</label>
                <input
                  type="number" min="0" step="0.01"
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                  placeholder="Count and enter cash amount..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                />
                {variance !== null && (
                  <div className={`text-xs font-semibold px-3 py-2 rounded-lg ${Math.abs(variance) < 0.01 ? 'bg-emerald-100 text-emerald-700' : variance > 0 ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-600'}`}>
                    {Math.abs(variance) < 0.01
                      ? '✓ Cash balanced perfectly'
                      : variance > 0
                      ? `↑ Surplus: +${fmt(variance)}`
                      : `↓ Shortage: ${fmt(variance)}`}
                  </div>
                )}
                <input
                  value={closingNote}
                  onChange={(e) => setClosingNote(e.target.value)}
                  placeholder="Closing note (optional)..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <button
                  onClick={handleCloseShift}
                  disabled={isBusy || actualCash === ''}
                  className="w-full flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
                >
                  <ArrowDownCircle className="w-4 h-4" />
                  {isBusy ? 'Closing...' : 'Close Shift'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">Open a new shift to start accepting cash payments.</p>
              <label className="block text-xs font-semibold text-slate-700">Opening Float (Rs.)</label>
              <input
                type="number" min="0" step="0.01"
                value={floatAmount}
                onChange={(e) => setFloatAmount(e.target.value)}
                placeholder="e.g. 5000"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <button
                onClick={handleOpenShift}
                disabled={isBusy || floatAmount === ''}
                className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
              >
                <ArrowUpCircle className="w-4 h-4" />
                {isBusy ? 'Opening...' : 'Open Shift'}
              </button>
            </div>
          )}
        </div>

        {/* Quick stats */}
        <div className="space-y-4">
          {openShift ? (
            <>
              <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-xs">
                <p className="text-[10px] font-semibold text-slate-400 uppercase mb-3">Shift Summary</p>
                <div className="space-y-2 text-xs text-slate-700">
                  <div className="flex justify-between"><span>Cash sales this shift</span><span className="font-mono font-bold text-slate-900">{fmt(liveCashSalesSinceOpen)}</span></div>
                  <div className="flex justify-between"><span>Opening float</span><span className="font-mono">{fmt(openShift.openingFloat)}</span></div>
                  <div className="flex justify-between font-semibold border-t border-slate-100 pt-2"><span>Expected total</span><span className="font-mono text-indigo-600">{fmt(liveExpectedCash)}</span></div>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-800">
                <DollarSign className="w-4 h-4 mb-1" />
                <strong>Cash Count Reminder:</strong> Count all denominations carefully before entering the actual amount above.
              </div>
            </>
          ) : (
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-6 flex flex-col items-center justify-center text-center min-h-[150px]">
              <Timer className="w-8 h-8 text-slate-300 mb-2" />
              <p className="text-xs text-slate-500">No active shift. Open a shift when you start your day.</p>
            </div>
          )}
        </div>
      </div>

      {/* Shift history */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <History className="w-4 h-4 text-slate-400" />
          <span className="font-semibold text-sm text-slate-700">Shift History</span>
          <span className="ml-auto text-xs text-slate-400">{closedShifts.length} shifts</span>
        </div>
        {closedShifts.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-xs">No closed shifts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Shift ID</th>
                  <th className="px-4 py-3">Opened</th>
                  <th className="px-4 py-3">Closed</th>
                  <th className="px-4 py-3">Cashier</th>
                  <th className="px-4 py-3 text-right">Float</th>
                  <th className="px-4 py-3 text-right">Cash Sales</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Actual</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {closedShifts.map((s) => {
                  const cashSales = (s.expectedCash ?? s.openingFloat) - s.openingFloat;
                  const v = s.closingCash != null ? s.closingCash - (s.expectedCash ?? s.openingFloat) : null;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-mono text-slate-500">{s.id.slice(-8).toUpperCase()}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{reportTime(s.openedAt)}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{s.closedAt ? reportTime(s.closedAt) : '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{s.cashierName || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">{fmt(s.openingFloat)}</td>
                      <td className="px-4 py-3 text-right font-mono text-indigo-600">{fmt(cashSales)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-900">{fmt(s.expectedCash ?? s.openingFloat)}</td>
                      <td className="px-4 py-3 text-right font-mono">{s.closingCash != null ? fmt(s.closingCash) : '—'}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${v == null ? 'text-slate-400' : Math.abs(v) < 0.01 ? 'text-emerald-600' : v > 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                        {v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
