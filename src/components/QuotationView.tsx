import React, { useState, useMemo } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  Printer,
  ArrowRight,
  Search,
  X,
  Check,
  Clock,
} from 'lucide-react';
import { Product, Customer, Quotation, QuotationItem, StoreSettings } from '../types';

interface QuotationViewProps {
  products: Product[];
  customers: Customer[];
  quotations: Quotation[];
  taxConfig: StoreSettings;
  cashierName: string;
  authToken: string;
  onRefreshDb: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-600',
  Sent: 'bg-blue-100 text-blue-700',
  Accepted: 'bg-emerald-100 text-emerald-700',
  Expired: 'bg-amber-100 text-amber-700',
  Converted: 'bg-indigo-100 text-indigo-700',
};

export default function QuotationView({
  products,
  customers,
  quotations,
  taxConfig,
  cashierName,
  authToken,
  onRefreshDb,
}: QuotationViewProps) {
  const currencySymbol = 'Rs.';
  const activeShopProfile = (taxConfig.shopProfiles || []).find((s) => s.id === taxConfig.activeShopId) || taxConfig.shopProfiles?.[0];
  const shopName = activeShopProfile?.name || taxConfig.storeName;
  const shopAddress = activeShopProfile?.address || '';
  const shopPhone = activeShopProfile?.phone || '';

  const authFetch = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${authToken}`);
    if (!headers.has('Content-Type') && init?.body) headers.set('Content-Type', 'application/json');
    return fetch(url, { ...init, headers });
  };

  const [isComposing, setIsComposing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // Form state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [quoteItems, setQuoteItems] = useState<QuotationItem[]>([]);
  const [quoteDiscount, setQuoteDiscount] = useState(0);
  const [quoteNotes, setQuoteNotes] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const taxRate = (activeShopProfile?.taxRate ?? taxConfig.taxRate) / 100;

  const filteredProducts = useMemo(() =>
    prodSearch.length > 1
      ? products.filter((p) =>
          p.name.toLowerCase().includes(prodSearch.toLowerCase()) ||
          p.sku.toLowerCase().includes(prodSearch.toLowerCase())
        ).slice(0, 8)
      : [],
    [products, prodSearch]
  );

  const addItem = (product: Product) => {
    setQuoteItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) return prev.map((i) => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { productId: product.id, productName: product.name, quantity: 1, sellingPrice: product.sellingPrice, discount: 0 }];
    });
    setProdSearch('');
  };

  const updateItem = (idx: number, patch: Partial<QuotationItem>) => {
    setQuoteItems((prev) => prev.map((item, i) => i === idx ? { ...item, ...patch } : item));
  };

  const removeItem = (idx: number) => setQuoteItems((prev) => prev.filter((_, i) => i !== idx));

  const { subtotal, tax, total } = useMemo(() => {
    const sub = quoteItems.reduce((sum, item) => {
      const line = item.sellingPrice * item.quantity * (1 - item.discount / 100) - (item.discountAmount || 0);
      return sum + Math.max(0, line);
    }, 0);
    const disc = Math.min(sub, quoteDiscount);
    const discountedSub = sub - disc;
    const t = discountedSub * taxRate;
    return { subtotal: Math.round(sub * 100) / 100, tax: Math.round(t * 100) / 100, total: Math.round((discountedSub + t) * 100) / 100 };
  }, [quoteItems, quoteDiscount, taxRate]);

  const handleSave = async () => {
    if (quoteItems.length === 0) return alert('Add at least one product to the quote.');
    setIsSaving(true);
    try {
      await authFetch('/api/quotations', {
        method: 'POST',
        body: JSON.stringify({
          customerName: selectedCustomer?.name || 'Walk-in Customer',
          customerId: selectedCustomer?.id,
          customerPhone: selectedCustomer?.phone,
          items: quoteItems,
          subtotal, tax,
          discountAmount: quoteDiscount,
          total, validUntil: validUntil || undefined,
          notes: quoteNotes,
        }),
      });
      setIsComposing(false);
      setQuoteItems([]);
      setSelectedCustomer(null);
      setQuoteNotes('');
      setQuoteDiscount(0);
      setValidUntil('');
      onRefreshDb();
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    await authFetch(`/api/quotations/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    onRefreshDb();
  };

  const handleConvert = async (q: Quotation) => {
    if (!confirm(`Convert quote ${q.quoteNumber} to a sale? This will reduce stock.`)) return;
    setConvertingId(q.id);
    try {
      await authFetch(`/api/quotations/${q.id}/convert`, { method: 'POST', body: JSON.stringify({ paymentMethod: 'Cash' }) });
      onRefreshDb();
    } finally {
      setConvertingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this quotation?')) return;
    await authFetch(`/api/quotations/${id}`, { method: 'DELETE' });
    onRefreshDb();
  };

  const printQuote = (q: Quotation) => {
    const win = window.open('', '_blank', 'width=800,height=700');
    if (!win) return;
    const html = `<!DOCTYPE html><html><head><title>${q.quoteNumber}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 30px; color: #1e293b; font-size: 13px; }
      h1 { font-size: 22px; margin: 0; } .meta { color: #64748b; font-size: 11px; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th { background: #f1f5f9; padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
      td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
      .totals { margin-top: 20px; text-align: right; }
      .totals div { margin-bottom: 4px; }
      .total-line { font-size: 16px; font-weight: bold; }
      @media print { body { padding: 12mm; } }
    </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div><h1>${shopName}</h1><div class="meta">${shopAddress} | ${shopPhone}</div></div>
      <div style="text-align:right;"><div style="font-size:20px;font-weight:bold;color:#6366f1">QUOTATION</div>
        <div class="meta">${q.quoteNumber}</div>
        <div class="meta">Date: ${q.date.split('T')[0]}</div>
        ${q.validUntil ? `<div class="meta">Valid Until: ${q.validUntil}</div>` : ''}
      </div>
    </div>
    <div style="margin-top:16px;"><strong>To:</strong> ${q.customerName}${q.customerPhone ? ` | ${q.customerPhone}` : ''}</div>
    <table><thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Disc%</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${q.items.map((item) => {
      const line = item.sellingPrice * item.quantity * (1 - item.discount / 100);
      return `<tr><td>${item.productName}</td><td>${item.quantity}</td><td>Rs.${item.sellingPrice.toFixed(2)}</td><td>${item.discount}%</td><td style="text-align:right">Rs.${line.toFixed(2)}</td></tr>`;
    }).join('')}</tbody></table>
    <div class="totals">
      <div>Subtotal: Rs.${q.subtotal.toFixed(2)}</div>
      ${q.discountAmount > 0 ? `<div>Discount: -Rs.${q.discountAmount.toFixed(2)}</div>` : ''}
      <div>Tax: Rs.${q.tax.toFixed(2)}</div>
      <div class="total-line">TOTAL: Rs.${q.total.toFixed(2)}</div>
    </div>
    ${q.notes ? `<div style="margin-top:20px;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;"><strong>Notes:</strong> ${q.notes}</div>` : ''}
    <div style="margin-top:30px;font-size:11px;color:#94a3b8;text-align:center;">This is a quotation only — not a tax invoice. Prices valid until ${q.validUntil || 'further notice'}.</div>
    <script>window.onload=()=>{window.print();}</script></body></html>`;
    win.document.write(html);
    win.document.close();
  };

  const displayed = quotations.filter((q) => {
    const matchSearch = !searchTerm || q.quoteNumber.toLowerCase().includes(searchTerm.toLowerCase()) || q.customerName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = statusFilter === 'All' || q.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-heading font-semibold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-500" /> Quotations & Estimates
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Create and manage price quotes before finalising sales.</p>
        </div>
        <button
          onClick={() => setIsComposing(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          <Plus className="w-4 h-4" /> New Quote
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search quote # or customer..." className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200" />
        </div>
        {['All', 'Draft', 'Sent', 'Accepted', 'Expired', 'Converted'].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{s}</button>
        ))}
      </div>

      {/* Quotations list */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-xs overflow-hidden">
        {displayed.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            No quotations yet. Create one to get started.
          </div>
        ) : (
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Quote #</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Valid Until</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayed.map((q) => (
                <tr key={q.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-mono font-semibold text-indigo-600">{q.quoteNumber}</td>
                  <td className="px-4 py-3 text-slate-500">{q.date.split('T')[0]}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{q.customerName}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">Rs.{q.total.toFixed(2)}</td>
                  <td className="px-4 py-3 text-slate-500">{q.validUntil || '—'}</td>
                  <td className="px-4 py-3">
                    <select
                      value={q.status}
                      onChange={(e) => handleUpdateStatus(q.id, e.target.value)}
                      disabled={q.status === 'Converted'}
                      className={`text-[10px] font-semibold px-2 py-1 rounded-full border-0 outline-none cursor-pointer ${STATUS_COLORS[q.status] || 'bg-slate-100 text-slate-600'}`}
                    >
                      {['Draft', 'Sent', 'Accepted', 'Expired'].map((s) => <option key={s}>{s}</option>)}
                      {q.status === 'Converted' && <option>Converted</option>}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => printQuote(q)} title="Print" className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition">
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                      {q.status !== 'Converted' && (
                        <button
                          onClick={() => handleConvert(q)}
                          disabled={convertingId === q.id}
                          title="Convert to Sale"
                          className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {['Draft', 'Expired'].includes(q.status) && (
                        <button onClick={() => handleDelete(q.id)} title="Delete" className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Compose Modal */}
      {isComposing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900">New Quotation</h3>
              <button onClick={() => setIsComposing(false)} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-5">
              {/* Customer picker */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Customer</label>
                <select
                  value={selectedCustomer?.id || ''}
                  onChange={(e) => setSelectedCustomer(customers.find((c) => c.id === e.target.value) || null)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="">Walk-in Customer</option>
                  {customers.filter((c) => c.id !== 'cust-walkin').map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {/* Valid Until */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Valid Until</label>
                  <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-200" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Discount (Rs.)</label>
                  <input type="number" min="0" value={quoteDiscount} onChange={(e) => setQuoteDiscount(Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-200" />
                </div>
              </div>
              {/* Product search + add */}
              <div className="relative">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Add Product</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} placeholder="Search product name or SKU..." className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200" />
                </div>
                {filteredProducts.length > 0 && (
                  <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {filteredProducts.map((p) => (
                      <button key={p.id} onClick={() => addItem(p)} className="w-full text-left px-3 py-2 hover:bg-indigo-50 text-xs flex justify-between items-center">
                        <span className="font-medium text-slate-800">{p.name}</span>
                        <span className="text-slate-500 font-mono">Rs.{p.sellingPrice.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Items table */}
              {quoteItems.length > 0 && (
                <div className="border border-slate-100 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
                      <tr><th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2">Qty</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Disc%</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2"></th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {quoteItems.map((item, idx) => {
                        const lineTotal = item.sellingPrice * item.quantity * (1 - item.discount / 100);
                        return (
                          <tr key={idx}>
                            <td className="px-3 py-2 font-medium text-slate-800">{item.productName}</td>
                            <td className="px-3 py-2"><input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(idx, { quantity: Math.max(1, Number(e.target.value)) })} className="w-14 border border-slate-200 rounded px-1 py-0.5 text-center outline-none" /></td>
                            <td className="px-3 py-2 font-mono text-slate-700">Rs.{item.sellingPrice.toFixed(2)}</td>
                            <td className="px-3 py-2"><input type="number" min="0" max="100" value={item.discount} onChange={(e) => updateItem(idx, { discount: Math.min(100, Number(e.target.value)) })} className="w-14 border border-slate-200 rounded px-1 py-0.5 text-center outline-none" /></td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">Rs.{lineTotal.toFixed(2)}</td>
                            <td className="px-3 py-2"><button onClick={() => removeItem(idx)} className="text-rose-400 hover:text-rose-600"><X className="w-3 h-3" /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="text-right px-3 py-3 bg-slate-50/50 space-y-1 text-xs">
                    <div className="text-slate-600">Subtotal: Rs.{subtotal.toFixed(2)}</div>
                    {quoteDiscount > 0 && <div className="text-slate-500">Discount: -Rs.{quoteDiscount.toFixed(2)}</div>}
                    <div className="text-slate-600">Tax ({activeShopProfile?.taxRate ?? taxConfig.taxRate}%): Rs.{tax.toFixed(2)}</div>
                    <div className="font-bold text-slate-900 text-sm">Total: Rs.{total.toFixed(2)}</div>
                  </div>
                </div>
              )}
              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Notes (optional)</label>
                <textarea rows={2} value={quoteNotes} onChange={(e) => setQuoteNotes(e.target.value)} placeholder="Terms, conditions, delivery notes..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-200 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100">
              <button onClick={() => setIsComposing(false)} className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition">Cancel</button>
              <button onClick={handleSave} disabled={isSaving || quoteItems.length === 0} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50">
                <Check className="w-3.5 h-3.5" /> {isSaving ? 'Saving...' : 'Save Quotation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
