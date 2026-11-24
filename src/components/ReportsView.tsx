import { inReportPeriod, lineProfit, lineRevenue, reportDay, saleProfit } from '../utils/reporting';
import React, { useState, useMemo } from 'react';
import {
  BarChart2,
  Download,
  TrendingUp,
  ShoppingBag,
  Calendar,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { SalesTransaction, Product, ManualExpense, StoreSettings } from '../types';
import { ReportExportMenu } from './ReportExportMenu';
import type { BusinessReport } from '../utils/businessReport';

interface ReportsViewProps {
  transactions: SalesTransaction[];
  products: Product[];
  manualExpenses: ManualExpense[];
  authToken: string;
  taxConfig: StoreSettings;
}

export default function ReportsView({ transactions, products, manualExpenses, authToken, taxConfig }: ReportsViewProps) {
  const currencySymbol = 'Rs.';
  const today = reportDay(new Date());
  const thirtyDaysAgo = reportDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  const [fromDate, setFromDate] = useState(thirtyDaysAgo);
  const [toDate, setToDate] = useState(today);
  const [activeTab, setActiveTab] = useState<'sales' | 'products' | 'expenses'>('sales');
  const [visibleRows, setVisibleRows] = useState(20);

  const productCostMap = useMemo(() => new Map(products.map((p) => [p.id, p.costPrice])), [products]);

  const filteredTx = useMemo(() => {
    return transactions.filter(t => inReportPeriod(t.date, fromDate, toDate));
  }, [transactions, fromDate, toDate]);

  const filteredExpenses = useMemo(() => {
    return manualExpenses.filter((e) => inReportPeriod(e.date, fromDate, toDate));
  }, [manualExpenses, fromDate, toDate]);

  const calcProfit = (tx: SalesTransaction) => saleProfit(tx, productCostMap);

  const totalRevenue = filteredTx.filter((t) => t.status !== 'Refunded').reduce((s, t) => s + t.total, 0);
  const totalProfit = filteredTx.reduce((s, t) => s + calcProfit(t), 0);
  const totalExpenses = filteredExpenses.reduce((s, e) => s + e.amount, 0);
  const netProfit = totalProfit - totalExpenses;
  const refundCount = filteredTx.filter((t) => t.status === 'Refunded').length;

  // Product performance
  const productSales = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; factor: number | null; qty: number; revenue: number; profit: number }>();
    filteredTx.filter((t) => t.status !== 'Refunded').forEach((t) => {
      t.items.forEach((item) => {
        const unit = item.sellingUnitLabel || item.variantUnit || 'Not recorded';
        const factor = item.sellingUnitId && Number.isSafeInteger(item.baseUnitsPerSaleUnit) && Number(item.baseUnitsPerSaleUnit)>0 ? Number(item.baseUnitsPerSaleUnit) : null;
        const key = JSON.stringify([item.productId,item.variantId ?? null,item.sellingUnitId ?? null,unit,factor]);
        const existing = map.get(key) || { name: item.productName, unit, factor, qty: 0, revenue: 0, profit: 0 };
        const rev = lineRevenue(item);
        map.set(key, {
          name: item.productName, unit, factor,
          qty: existing.qty + item.quantity,
          revenue: existing.revenue + rev,
          profit: existing.profit + lineProfit(item, productCostMap),
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredTx, productCostMap]);

  const paymentMethodBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filteredTx.filter((t) => t.status !== 'Refunded').forEach((t) => {
      map[t.paymentMethod] = (map[t.paymentMethod] || 0) + t.total;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filteredTx]);

  const buildReport = (): BusinessReport => {
    const base = {filename:'ars-'+activeTab+'-'+fromDate+'-to-'+toDate,period:fromDate+' to '+toDate};
    if(activeTab==='sales') return {...base,title:'Sales performance report',headers:['Invoice','Date','Customer','Sales Representative','Items','Subtotal (LKR)','Tax (LKR)','Discount (LKR)','Total (LKR)','Profit (LKR)','Payment','Status'],rows:filteredTx.map(t=>[t.invoiceNumber,reportDay(t.date),t.customerName,t.salesRepName||'Not recorded',t.items.length,t.subtotal,t.tax,t.discountAmount,t.total,calcProfit(t),t.paymentMethod,t.status||'Completed']),moneyColumns:[5,6,7,8,9],summary:[{label:'Revenue (LKR, excluding refunds)',value:totalRevenue},{label:'Gross profit (LKR)',value:totalProfit},{label:'Refunded invoices',value:refundCount},{label:'Invoices in report',value:filteredTx.length}]};
    if(activeTab==='products')return {...base,title:'Product performance report',headers:['Product','U/M','Qty Sold','Base Qty','Revenue (LKR)','Profit (LKR)'],rows:productSales.map(p=>[p.name,p.unit,p.qty,p.factor===null?'Not recorded':p.qty*p.factor,p.revenue,p.profit]),moneyColumns:[4,5],summary:[{label:'Product / unit groups',value:productSales.length},{label:'Product revenue before invoice discounts (LKR)',value:productSales.reduce((s,p)=>s+p.revenue,0)}]};
    return {...base,title:'Expense report',headers:['Date','Description','Category','Amount (LKR)'],rows:filteredExpenses.map(e=>[reportDay(e.date),e.desc,e.category,e.amount]),moneyColumns:[3],summary:[{label:'Total expenses (LKR)',value:totalExpenses},{label:'Expense records',value:filteredExpenses.length}]};
  };

  const setPreset = (days: number) => {
    setVisibleRows(20);
    setToDate(today);
    setFromDate(reportDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000)));
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-white px-4 py-3 rounded-xl border border-slate-100 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-heading font-semibold text-slate-900 flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-indigo-500" /> Business Reports
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Sales analysis, product performance and expense tracking.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setPreset(d)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition">
              Last {d}d
            </button>
          ))}
          <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input type="date" value={fromDate} onChange={(e) => {setFromDate(e.target.value);setVisibleRows(20);}} className="text-xs text-slate-700 outline-none bg-transparent" />
            <span className="text-slate-400 text-xs">–</span>
            <input type="date" value={toDate} onChange={(e) => {setToDate(e.target.value);setVisibleRows(20);}} className="text-xs text-slate-700 outline-none bg-transparent" />
          </div>
          <ReportExportMenu report={buildReport} settings={taxConfig}/>
        </div>
      </div>

      {/* KPI summary row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          { label: 'Total Revenue', value: `${currencySymbol}${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Gross Profit', value: `${totalProfit >= 0 ? '+' : ''}${currencySymbol}${totalProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: totalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600', bg: 'bg-emerald-50' },
          { label: 'Total Expenses', value: `${currencySymbol}${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Net Profit', value: `${netProfit >= 0 ? '+' : ''}${currencySymbol}${netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600', bg: netProfit >= 0 ? 'bg-emerald-50' : 'bg-rose-50' },
          { label: 'Transactions', value: `${filteredTx.length} (${refundCount} refunded)`, color: 'text-slate-700', bg: 'bg-slate-50' },
        ].map((kpi) => (
          <div key={kpi.label} className={`${kpi.bg} border border-slate-100 rounded-xl p-3`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{kpi.label}</p>
            <p className={`text-lg font-bold ${kpi.color} mt-1 leading-tight`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-xs overflow-hidden">
        <div className="flex border-b border-slate-100">
          {[
            { id: 'sales', label: 'Sales Transactions', icon: FileText },
            { id: 'products', label: 'Product Performance', icon: ShoppingBag },
            { id: 'expenses', label: 'Expenses', icon: TrendingUp },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {setActiveTab(id as any);setVisibleRows(20);}}
              className={`flex items-center gap-1.5 px-5 py-3 text-xs font-semibold transition border-b-2 ${activeTab === id ? 'border-indigo-500 text-indigo-600 bg-indigo-50/40' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {activeTab === 'sales' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Sales Representative</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Profit</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredTx.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-10 text-slate-400">No transactions in selected range</td></tr>
                )}
                {filteredTx.slice(0,visibleRows).map((t) => {
                  const p = calcProfit(t);
                  return (
                    <tr key={t.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-2.5 font-mono text-indigo-600 font-semibold">{t.invoiceNumber}</td>
                      <td className="px-4 py-2.5 text-slate-500">{reportDay(t.date)}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{t.customerName}</td>
                      <td className="px-4 py-2.5 text-slate-500">{t.salesRepName || 'Not recorded'}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">Rs.{t.total.toFixed(2)}</td>
                      <td className={`px-4 py-2.5 text-right font-mono font-bold ${p >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {t.status === 'Refunded' ? '—' : `${p >= 0 ? '+' : ''}Rs.${p.toFixed(2)}`}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-slate-100 text-slate-600">{t.paymentMethod}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-semibold ${t.status === 'Refunded' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-700'}`}>
                          {t.status || 'Completed'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {activeTab === 'products' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">U/M</th><th className="px-4 py-3 text-right">Qty Sold</th><th className="px-4 py-3 text-right">Base Qty</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Profit</th>
                  <th className="px-4 py-3 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {productSales.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-10 text-slate-400">No sales in selected range</td></tr>
                )}
                {productSales.slice(0,visibleRows).map((p, i) => {
                  const margin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0;
                  return (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{p.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{p.unit}</td><td className="px-4 py-2.5 text-right font-mono text-slate-700">{p.qty}</td><td className="px-4 py-2.5 text-right font-mono text-slate-700">{p.factor===null?"—":p.qty*p.factor}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">Rs.{p.revenue.toFixed(2)}</td>
                      <td className={`px-4 py-2.5 text-right font-mono font-bold ${p.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {p.profit >= 0 ? '+' : ''}Rs.{p.profit.toFixed(2)}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono ${margin >= 20 ? 'text-emerald-600' : margin >= 10 ? 'text-amber-600' : 'text-rose-500'}`}>
                        {margin.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {activeTab === 'expenses' && (
            <div>
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredExpenses.length === 0 && (
                    <tr><td colSpan={4} className="text-center py-10 text-slate-400">No expenses in selected range</td></tr>
                  )}
                  {filteredExpenses.slice(0,visibleRows).map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-2.5 text-slate-500">{e.date}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{e.desc}</td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-[9px] bg-amber-100 text-amber-700 font-semibold">{e.category}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-amber-600">Rs.{e.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredExpenses.length > 0 && (
                <div className="flex justify-end px-4 py-3 border-t border-slate-100 bg-amber-50/50">
                  <span className="text-xs font-bold text-amber-700">Total: Rs.{totalExpenses.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {(() => {
          const count=activeTab==='sales'?filteredTx.length:activeTab==='products'?productSales.length:filteredExpenses.length;
          return count>visibleRows ? (
            <div className="flex justify-center border-t border-slate-100 bg-white p-3">
              <button type="button" onClick={()=>setVisibleRows(countNow=>countNow+20)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Show 20 more records ({count-visibleRows} remaining)
              </button>
            </div>
          ):null;
        })()}

        {/* Payment method breakdown */}
        {activeTab === 'sales' && paymentMethodBreakdown.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-4 bg-slate-50/50">
            <p className="text-[10px] font-semibold text-slate-500 uppercase mb-3">Payment Method Breakdown</p>
            <div className="flex flex-wrap gap-3">
              {paymentMethodBreakdown.map(([method, total]) => (
                <div key={method} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs">
                  <span className="font-semibold text-slate-700">{method}</span>
                  <span className="font-mono font-bold text-indigo-600">Rs.{total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
