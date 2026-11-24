import { reportDay, reportTime } from '../utils/reporting';
import React, { useState } from 'react';
import { notify } from '../utils/notifications';
import {
  History,
  TrendingDown,
  TrendingUp,
  Sliders,
  Search,
  Filter,
  PlusCircle,
  FileCheck2,
  X,
} from 'lucide-react';
import { Product, StockLog, Role, StoreSettings } from '../types';

import { ReportExportMenu } from './ReportExportMenu';
import type { BusinessReport } from '../utils/businessReport';

interface InventoryViewProps {
  taxConfig: StoreSettings;
  products: Product[];
  stockLogs: StockLog[];
  currentRole: Role;
  currentUser: string;
  onEditProduct: (id: string, prodData: Partial<Product> & { reason?: string; user?: string }) => Promise<void>;
}

export default function InventoryView({
  taxConfig,
  products,
  stockLogs,
  currentRole,
  currentUser,
  onEditProduct,
}: InventoryViewProps) {
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [logTypeFilter, setLogTypeFilter] = useState('All');
  const [productSearch, setProductSearch] = useState('');
  const [productLimit, setProductLimit] = useState(12);
  const [logLimit, setLogLimit] = useState(25);
  const [logDateFrom, setLogDateFrom] = useState('');
  const [logDateTo, setLogDateTo] = useState('');
  const [isLedgerFocused, setIsLedgerFocused] = useState(false);

  // Manual Adjust Modal
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qtyDifference, setQtyDifference] = useState<number>(0);
  const [adjustUnitId, setAdjustUnitId] = useState('');
  const adjustmentProduct = products.find(p=>p.id===selectedProductId);
  const adjustmentUnit = adjustmentProduct?.sharedStockUnits?.units.find(u=>u.id===adjustUnitId);
  const baseDifference = qtyDifference * (adjustmentUnit?.baseUnits ?? 1);
  const [adjustType, setAdjustType] = useState<'Stock In' | 'Stock Out' | 'Stock Adjust' | 'Return'>('Stock Adjust');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Validate Operator Role for Adjustments
  const canAdjust = ['Super Admin', 'Store Manager', 'Inventory Staff'].includes(currentRole);

  const handleSubmitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) {
      notify.warning('Please select a product to adjust.');
      return;
    }
    if (!Number.isSafeInteger(qtyDifference) || qtyDifference === 0) {
      notify.warning('Adjustment amount cannot be zero.');
      return;
    }
    if (!reason.trim()) {
      notify.warning('Please provide an audit reason or ticket log reference.');
      return;
    }
    setIsSubmitting(true);

    const product = products.find((p) => p.id === selectedProductId);
    if (!product) {
      notify.warning('Product not found.');
      setIsSubmitting(false);
      return;
    }

    // Compute new target quantity
    if (product.sharedStockUnits && !adjustmentUnit) { notify.warning('Select an adjustment U/M.'); setIsSubmitting(false); return; }
    const newQty = product.quantity + baseDifference;
    if (!Number.isSafeInteger(newQty) || newQty > 2147483647 || newQty < 0) {
      notify.error('Inventory error: Stock cannot be adjusted below zero.');
      setIsSubmitting(false);
      return;
    }

    try {
      await onEditProduct(selectedProductId, {
        quantity: newQty,
        reason: `${adjustType}: ${adjustmentUnit ? `${qtyDifference} ${adjustmentUnit.label} (${baseDifference} base units); ` : ''}${reason.trim()}`,
        user: currentUser,
      });
      notify.success('Inventory adjustment saved with audit reason.');
      setIsAdjustOpen(false);
      setSelectedProductId('');
      setQtyDifference(0);
      setReason('');
    } catch (err) {
      notify.error('Adjustment failed: ' + err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenAdjustForProduct = (productId: string) => {
    if (!canAdjust) {
      notify.error('Permission Denied: Your active security clearance restricts manual audit updates.');
      return;
    }
    setSelectedProductId(productId);
    setAdjustUnitId('');
    setQtyDifference(0);
    setAdjustType('Stock Adjust');
    setReason('Manual bin location recount audit');
    setIsAdjustOpen(true);
  };

  // Filter Stock Ledger Logs
  const filteredLogs = stockLogs.filter((log) => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const matchesSearch = [log.productName, log.productId, log.reason, log.user, log.referenceId, log.type]
      .some((field) => String(field || '').toLowerCase().includes(normalizedSearch));
    const matchesType = logTypeFilter === 'All' || log.type === logTypeFilter;
    const logDay = reportDay(log.date);
    const matchesDate = (!logDateFrom || logDay >= logDateFrom) && (!logDateTo || logDay <= logDateTo);
    return matchesSearch && matchesType && matchesDate;
  });
  const isLedgerFiltered = Boolean(searchTerm.trim() || logTypeFilter !== 'All' || logDateFrom || logDateTo);
  const isProductFiltered = Boolean(productSearch.trim());

  const ledgerReport = ():BusinessReport => ({
    title:'Stock movement ledger',filename:'ars-stock-movements',period:(logDateFrom||'All dates')+' to '+(logDateTo||'Latest')+' | '+logTypeFilter,
    headers:['Date','Product ID','Product','Type','Quantity','Operator','Reason','Reference'],
    rows:filteredLogs.map(log=>[reportTime(log.date),log.productId,log.productName,log.type,Number(log.quantity),log.user,log.reason,log.referenceId||'']),
    summary:[{label:'Matching movements',value:filteredLogs.length},{label:'Distinct products',value:new Set(filteredLogs.map(log=>log.productId)).size}]
  });

  const matchingProducts = products.filter(p => [p.name,p.sku,p.location].some(v=>String(v||'').toLowerCase().includes(productSearch.trim().toLowerCase())));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 motion-safe:animate-fade-in">
      {/* LEFT: Products Quick Stock overview inline adjustments (5 cols) */}
      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-xs">
          <h3 className="font-heading font-medium text-slate-900 text-sm mb-1">
            Shelf Audit Controls
          </h3>
          <p className="text-[11px] text-slate-500 mb-4">
            Select catalog products to perform manual inventory overrides.
          </p>

          <input type="search" aria-label="Find shelf stock product" value={productSearch}
            onChange={event=>{setProductSearch(event.target.value);setProductLimit(12);}}
            placeholder="Find product, SKU or shelf..." className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"/>
          <div className="space-y-2">
            {(isProductFiltered ? matchingProducts : matchingProducts.slice(0,productLimit)).map((p) => {
              const isLow = p.quantity <= p.reorderLevel;
              const isOut = p.quantity <= 0;

              return (
                <div
                  key={p.id}
                  id={`shelf-audit-item-${p.id}`}
                  className="p-3 bg-slate-50 rounded-xl border border-slate-200/50 flex items-center justify-between hover:bg-slate-100/50 transition"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-semibold text-slate-800 text-xs truncate" title={p.name}>
                      {p.name}
                    </p>
                    <p className="text-[10px] font-mono text-slate-400 mt-1">
                      SKU: {p.sku} | Loc: {p.location || 'Aisle 1'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                        isOut
                          ? 'bg-rose-100 text-rose-700'
                          : isLow
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      Qty: {p.quantity} {p.sharedStockUnits?.baseUnit || ''}
                      {p.sharedStockUnits?.units.filter(u=>Number.isSafeInteger(u.baseUnits)&&u.baseUnits>1).map(u=><span key={u.id} className="block text-[10px] font-normal">{Math.floor(p.quantity/u.baseUnits)} {u.label} equivalents + {p.quantity%u.baseUnits} {p.sharedStockUnits?.baseUnit}</span>)}
                    </span>

                    {canAdjust && (
                      <button
                        id={`btn-adjust-qty-${p.id}`}
                        onClick={() => handleOpenAdjustForProduct(p.id)}
                        className="bg-white hover:bg-slate-50 text-[10px] font-bold px-2 py-1 rounded border border-slate-250 shadow-2xs hover:border-indigo-400 transition"
                      >
                        Adjust
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {!isProductFiltered&&matchingProducts.length>productLimit&&<button type="button"
              onClick={()=>setProductLimit(v=>v+12)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">
              Show more shelf products ({matchingProducts.length-productLimit} remaining)
            </button>}
          </div>
        </div>
      </div>

      {/* RIGHT: Detailed Logs Ledger Chronology (7 cols) */}
      <div id="ars-stock-ledger-workspace" role={isLedgerFocused ? 'dialog' : undefined} aria-label={isLedgerFocused ? 'Full stock movement history' : undefined}
        className={isLedgerFocused
          ? 'fixed inset-0 z-40 flex min-h-0 flex-col gap-3 overflow-y-auto bg-slate-50 p-3 sm:p-6'
          : 'lg:col-span-7 flex min-h-0 flex-col space-y-4'}>
        {/* Logs Timeline Search Controls */}
        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-xs space-y-4">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-heading font-medium tracking-tight text-slate-900">
                Stock Ledger & Movement History
              </h2>
              <button type="button" id="ars-stock-ledger-focus-toggle" onClick={() => setIsLedgerFocused(value => !value)}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-100">
                {isLedgerFocused ? 'Back to stock overview' : 'Open full stock history'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Audits warehouse intake logs and points-of-sale deduction feeds.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                id="ledger-search-input"
                type="text"
                placeholder="Search ledger by keyword or operator..."
                value={searchTerm}
                onChange={(e) => {setSearchTerm(e.target.value);setLogLimit(25);}}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 text-slate-850 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-sans"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Sliders className="w-3.5 h-3.5 text-slate-400" />
              <select
                id="ledger-type-filter"
                value={logTypeFilter}
                onChange={(e) => {setLogTypeFilter(e.target.value);setLogLimit(25);}}
                className="bg-slate-50 border border-slate-200 p-1.5 rounded-lg text-xs font-sans text-slate-700 focus:outline-none"
              >
                <option value="All">All Movements</option>
                <option value="Stock In">Stock In (+)</option>
                <option value="Stock Out">Stock Out (-)</option>
                <option value="Stock Adjust">Adjustments (*)</option>
                <option value="Return">Returns</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <div><label htmlFor="ledger-from" className="block text-xs font-semibold text-slate-600">From date</label>
            <input id="ledger-from" type="date" value={logDateFrom}
              onChange={event => setLogDateFrom(event.target.value)}
              className="rounded-lg border border-slate-200 p-2 text-xs" /></div>
          <div><label htmlFor="ledger-to" className="block text-xs font-semibold text-slate-600">To date</label>
            <input id="ledger-to" type="date" value={logDateTo}
              onChange={event => setLogDateTo(event.target.value)}
              className="rounded-lg border border-slate-200 p-2 text-xs" /></div>
          <span className="mr-auto text-xs font-semibold text-slate-600">{filteredLogs.length} matching movement(s)</span>
          <button type="button" onClick={() => {setSearchTerm(''); setLogTypeFilter('All'); setLogDateFrom(''); setLogDateTo(''); setLogLimit(25);}}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">
            Clear filters
          </button>
          <ReportExportMenu report={ledgerReport} settings={taxConfig}/>
        </div>

        {/* Chronological log feed */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className={isLedgerFocused ? 'h-full overflow-auto' : 'overflow-x-auto'}>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50/75 border-b border-slate-100 text-slate-500 font-medium font-sans">
                  <th className="p-4">Timestamp</th>
                  <th className="p-4">Target Product</th>
                  <th className="p-4">Action Type</th>
                  <th className="p-4 text-right">Adjustment Quantity</th>
                  <th className="p-4">Operator</th>
                  <th className="p-4">Reason Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {(isLedgerFiltered ? filteredLogs : filteredLogs.slice(0,logLimit)).map((log) => {
                  const qtyVal = Number(log.quantity);
                  const isPos = qtyVal > 0;

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition duration-150 text-[11px]">
                      <td className="p-4 text-slate-400 font-mono">
                        {reportDay(log.date)} <br />
                        {new Date(log.date).toLocaleTimeString('en-GB',{timeZone:'Asia/Colombo'})}
                      </td>
                      <td className="p-4">
                        <div className="font-semibold text-slate-900 max-w-xs truncate" title={log.productName}>
                          {log.productName}
                        </div>
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[9px] font-mono font-bold ${
                            log.type === 'Stock In'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : log.type === 'Stock Out'
                              ? 'bg-rose-50 text-rose-800 border border-rose-200'
                              : log.type === 'Return'
                              ? 'bg-blue-50 text-blue-800 border border-blue-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {log.type}
                        </span>
                      </td>
                      <td className="p-4 text-right font-mono font-bold">
                        <span className={isPos ? 'text-emerald-600' : 'text-rose-600'}>
                          {isPos ? '+' : ''}
                          {log.quantity}
                        </span>
                      </td>
                      <td className="p-4 text-slate-600 font-medium">{log.user}</td>
                      <td className="p-4 text-slate-500 font-mono leading-snug max-w-xs">{log.reason}</td>
                    </tr>
                  );
                })}

                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-24 text-slate-400 font-sans">
                      <History className="w-11 h-11 mx-auto text-slate-200" />
                      <p className="text-sm font-semibold mt-2">Inventory Stock Ledger stands still</p>
                      <p className="text-xs text-slate-500">Perform manual audit adjustments or register POS billing checks</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!isLedgerFiltered&&filteredLogs.length>logLimit&&<div className="border-t border-slate-100 p-3 text-center">
            <button type="button" onClick={()=>setLogLimit(v=>v+25)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold">
              Show more stock movements ({filteredLogs.length-logLimit} remaining)
            </button>
          </div>}
        </div>
      </div>

      {/* ADJUST QUANTITY OVERLAY MODAL */}
      {isAdjustOpen && (
        <div id="adjust-dialog-backdrop" className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-4 w-full max-w-sm border border-slate-200 font-sans relative max-h-[90dvh] overflow-y-auto">
            <button
              onClick={() => setIsAdjustOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-amber-500" /> Manual Stock Audit Override
            </h3>

            <form onSubmit={handleSubmitAdjustment} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Select Product *</label>
                <select
                  id="adjust-prod-select"
                  value={selectedProductId}
                  onChange={(e) => {setSelectedProductId(e.target.value);setAdjustUnitId('');}}
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded text-xs focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Choose Hardware SKU --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Current Qty: {p.quantity})
                    </option>
                  ))}
                </select>
              </div>

              {adjustmentProduct?.sharedStockUnits && <label className="block text-slate-500 font-semibold">Adjustment U/M
                <select required value={adjustUnitId} onChange={e=>setAdjustUnitId(e.target.value)} className="w-full border rounded p-2">
                  <option value="">Select U/M</option>
                  {adjustmentProduct.sharedStockUnits.units.map(u=><option key={u.id} value={u.id}>{u.label} ({u.baseUnits} base units)</option>)}
                </select>
              </label>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Difference amount ({adjustmentUnit?.label || 'base stock units'}) *</label>
                  <input
                    id="adjust-qty-diff"
                    type="number"
                    value={qtyDifference}
                    onChange={(e) => setQtyDifference(Number(e.target.value))}
                    placeholder="e.g. +11 or -4"
                    className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">Use negative values to subtract. {adjustmentUnit && `Converted change: ${baseDifference} base units.`}</span>
                </div>

                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Adjustment Type</label>
                  <select
                    id="adjust-type-select"
                    value={adjustType}
                    onChange={(e) => setAdjustType(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 text-xs"
                  >
                    <option value="Stock Adjust">Stock Adjust (*)</option>
                    <option value="Stock In">Stock In (+)</option>
                    <option value="Stock Out">Stock Out (-)</option>
                    <option value="Return">Customer Return</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Audit Log Reason *</label>
                <input
                  id="adjust-reason-input"
                  type="text"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Floor stock recount verified visual checklist"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                />
              </div>

              {selectedProductId && (
                <div className="bg-amber-50/50 border border-amber-200 p-2.5 rounded text-[10px] text-slate-600 font-sans leading-relaxed">
                  <strong>Outcome Forecast:</strong> <br />
                  Product original base stock will transition from{' '}
                  <strong className="font-mono">
                    {products.find((p) => p.id === selectedProductId)?.quantity || 0}
                  </strong>{' '}
                  to{' '}
                  <strong className="font-mono">
                    {(products.find((p) => p.id === selectedProductId)?.quantity || 0) + baseDifference}
                  </strong>
                  .
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsAdjustOpen(false)}
                  className="flex-1 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-adjust"
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm hover:shadow-md transition"
                >
                  {isSubmitting ? 'Adjusting Ledger...' : 'Apply Adjustments'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
