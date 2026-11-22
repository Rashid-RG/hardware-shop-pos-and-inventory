import React, { useState } from 'react';
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
import { Product, StockLog, Role } from '../types';

interface InventoryViewProps {
  products: Product[];
  stockLogs: StockLog[];
  currentRole: Role;
  currentUser: string;
  onEditProduct: (id: string, prodData: Partial<Product> & { reason?: string; user?: string }) => Promise<void>;
}

export default function InventoryView({
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

  // Manual Adjust Modal
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [qtyDifference, setQtyDifference] = useState<number>(0);
  const [adjustType, setAdjustType] = useState<'Stock In' | 'Stock Out' | 'Stock Adjust' | 'Return'>('Stock Adjust');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Validate Operator Role for Adjustments
  const canAdjust = ['Super Admin', 'Store Manager', 'Inventory Staff'].includes(currentRole);

  const handleSubmitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) {
      alert('Please select a product to adjust.');
      return;
    }
    if (qtyDifference === 0) {
      alert('Adjustment amount cannot be zero.');
      return;
    }
    if (!reason.trim()) {
      alert('Please provide an audit reason or ticket log reference.');
      return;
    }
    setIsSubmitting(true);

    const product = products.find((p) => p.id === selectedProductId);
    if (!product) {
      alert('Product not found.');
      setIsSubmitting(false);
      return;
    }

    // Compute new target quantity
    const newQty = product.quantity + qtyDifference;
    if (newQty < 0) {
      alert('Inventory error: Stock cannot be adjusted below zero.');
      setIsSubmitting(false);
      return;
    }

    try {
      await onEditProduct(selectedProductId, {
        quantity: newQty,
        reason: `${adjustType}: ${reason.trim()}`,
        user: currentUser,
      });
      setIsAdjustOpen(false);
      setSelectedProductId('');
      setQtyDifference(0);
      setReason('');
    } catch (err) {
      alert('Adjustment failed: ' + err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenAdjustForProduct = (productId: string) => {
    if (!canAdjust) {
      alert('Permission Denied: Your active security clearance restricts manual audit updates.');
      return;
    }
    setSelectedProductId(productId);
    setQtyDifference(0);
    setAdjustType('Stock Adjust');
    setReason('Manual bin location recount audit');
    setIsAdjustOpen(true);
  };

  // Filter Stock Ledger Logs
  const filteredLogs = stockLogs.filter((log) => {
    const matchesSearch =
      log.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.reason.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = logTypeFilter === 'All' || log.type === logTypeFilter;
    return matchesSearch && matchesType;
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
            {matchingProducts.slice(0,productLimit).map((p) => {
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
                      Qty: {p.quantity}
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
            {matchingProducts.length>productLimit&&<button type="button"
              onClick={()=>setProductLimit(v=>v+12)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">
              Show more shelf products ({matchingProducts.length-productLimit} remaining)
            </button>}
          </div>
        </div>
      </div>

      {/* RIGHT: Detailed Logs Ledger Chronology (7 cols) */}
      <div className="lg:col-span-7 flex flex-col space-y-4">
        {/* Logs Timeline Search Controls */}
        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-xs space-y-4">
          <div>
            <h2 className="text-xl font-heading font-medium tracking-tight text-slate-900">
              Stock Ledger & Movement History
            </h2>
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

        {/* Chronological log feed */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden flex-1">
          <div className="overflow-x-auto">
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
                {filteredLogs.slice(0,logLimit).map((log) => {
                  const qtyVal = Number(log.quantity);
                  const isPos = qtyVal > 0;

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition duration-150 text-[11px]">
                      <td className="p-4 text-slate-400 font-mono">
                        {new Date(log.date).toLocaleDateString()} <br />
                        {new Date(log.date).toLocaleTimeString()}
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
          {filteredLogs.length>logLimit&&<div className="border-t border-slate-100 p-3 text-center">
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
                  onChange={(e) => setSelectedProductId(e.target.value)}
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Difference amount *</label>
                  <input
                    id="adjust-qty-diff"
                    type="number"
                    value={qtyDifference}
                    onChange={(e) => setQtyDifference(Number(e.target.value))}
                    placeholder="e.g. +11 or -4"
                    className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">Use negative values to subtract</span>
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
                    {(products.find((p) => p.id === selectedProductId)?.quantity || 0) + qtyDifference}
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
