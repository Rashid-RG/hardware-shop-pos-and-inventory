import { reportDay, lineRevenue, saleProfit } from '../utils/reporting';
import React from 'react';
import {
  TrendingUp,
  AlertTriangle,
  Package,
  DollarSign,
  Activity,
  Users,
  Backpack,
  ShoppingCart,
  Calendar,
  TrendingDown,
  Layers,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  CartesianGrid,
} from 'recharts';
import { Product, SalesTransaction, Customer, Supplier, Employee, ActivityLog, CustomerCreditPayment } from '../types';

interface DashboardViewProps {
  customerCreditPayments: CustomerCreditPayment[];
  products: Product[];
  transactions: SalesTransaction[];
  customers: Customer[];
  suppliers: Supplier[];
  employees: Employee[];
  activityLogs: ActivityLog[];
  taxConfig?: { taxRate: number; storeName: string; currency: string; invoicePrefix: string };
  onNavigateToTab: (tab: string) => void;
}

export default function DashboardView({
  customerCreditPayments,
  products,
  transactions,
  customers,
  suppliers,
  employees,
  activityLogs,
  taxConfig,
  onNavigateToTab,
}: DashboardViewProps) {
  const currencySymbol = 'Rs.';
  // Metric Calculations
  const completedSales = transactions.filter(t => t.status !== 'Refunded');
  const totalRevenue = completedSales.reduce((sum, t) => sum + t.total, 0);

  // Compute the current Sri Lanka business date rather than a demo date.
  const todayStr = reportDay(new Date());
  const todayTransactions = completedSales.filter(t => reportDay(t.date) === todayStr);
  const todayRevenue = todayTransactions.reduce((sum, t) => sum + t.total, 0);

  const inventoryValue = products.reduce((sum, p) => sum + p.quantity * p.costPrice, 0);
  const lowStockCount = products.filter((p) => p.quantity <= p.reorderLevel).length;

  // Profit calculations
  // Gross profit per transaction = sum of (sellingPrice * qty * (1 - disc/100)) - cost per item
  const productCostMap = new Map(products.map((p) => [p.id, p.costPrice]));
  const grossProfit = completedSales.reduce((sum, tx) => sum + saleProfit(tx, productCostMap), 0);
  const todayProfit = todayTransactions.reduce((sum, tx) => sum + saleProfit(tx, productCostMap), 0);
  const stockPotentialProfit = products.reduce((sum, p) => sum + (p.sellingPrice - p.costPrice) * p.quantity, 0);

  // Pie chart mapping - Category sales distribution
  const salesByCategoryRecord: Record<string, number> = {};
  completedSales.forEach((t) => {
    t.items.forEach((item) => {
      // Find category from catalog matching product
      const product = products.find((p) => p.id === item.productId);
      const cat = product ? product.category : 'General Hardware';
      const itemRev = lineRevenue(item);
      salesByCategoryRecord[cat] = (salesByCategoryRecord[cat] || 0) + itemRev;
    });
  });

  const COLORS = ['#6366f1', '#60a5fa', '#10b981', '#f59e0b', '#8b5cf6', '#64748b'];
  const categoryData = Object.entries(salesByCategoryRecord).map(([name, value]) => ({
    name,
    value: Math.round(value),
  }));

  // Trend line mapping - past 14 days
  const dateRecord: Record<string, { revenue: number; profit: number }> = {};
  for (let i = 13; i >= 0; i--) {
    const dateStr = reportDay(new Date(Date.now() - i * 86400000));
    dateRecord[dateStr] = { revenue: 0, profit: 0 };
  }
  completedSales.forEach((t) => {
    const dateStr = reportDay(t.date);
    if (dateRecord[dateStr] !== undefined) {
      dateRecord[dateStr].revenue += t.total;
      dateRecord[dateStr].profit += saleProfit(t, productCostMap);
    }
  });

  const salesTrendData = Object.entries(dateRecord).map(([date, vals]) => {
    const day = new Date(date).toLocaleDateString('en-US', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short' });
    return {
      name: day,
      Revenue: Math.round(vals.revenue * 100) / 100,
      Profit: Math.round(vals.profit * 100) / 100,
    };
  });

  // Recent transactions
  const recentTransactions = [...transactions].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);

  // Low stock listing
  const criticalLowStock = products.filter((p) => p.quantity <= p.reorderLevel).slice(0, 4);

  return (
    <div className="space-y-3 motion-safe:animate-fade-in">
      {/* Title block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-gradient-to-r from-[#152945] to-[#294664] text-white p-3 sm:px-4 rounded-xl border border-slate-800 shadow-sm">
        <div>
          <h2 className="text-lg font-heading font-bold tracking-tight text-white">
            Business Overview
          </h2>
          <p className="text-xs text-slate-200 mt-0.5">
            Sales activity, inventory health and the numbers that matter to your business.
          </p>
        </div>
        <div id="timestamp-tag" className="flex items-center gap-2 text-xs font-semibold bg-white/10 text-slate-100 px-3 py-2 rounded-xl border border-white/15">
          <Calendar className="w-3.5 h-3.5 text-slate-400" />
          <span>{new Intl.DateTimeFormat('en-LK', { timeZone: 'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</span>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Customer collections">
        {[
          ['Today’s credit collections',customerCreditPayments.filter(p=>reportDay(p.date)===todayStr).reduce((s,p)=>s+Number(p.amount),0),'Recorded repayments only'],
          ['All recorded credit collections',customerCreditPayments.reduce((s,p)=>s+Number(p.amount),0),'Not additional sales revenue'],
          ['Current customer receivables',customers.reduce((s,c)=>s+Number(c.creditBalance||0),0),'Outstanding across customer accounts']
        ].map(([label,value,description])=><div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs font-semibold text-slate-600">{label}</p><p className="mt-1 text-xl font-bold">Rs. {Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</p><p className="mt-1 text-xs text-slate-500">{description}</p></div>)}
      </section>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-2">
        {/* Total Revenue */}
        <div id="kpi-total-revenue" className="min-w-0 bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Sales</p>
            <h3 className="text-lg xl:text-xl font-bold font-sans text-slate-950 mt-1 break-words leading-tight">
              {currencySymbol}{totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-emerald-600 mt-1 flex items-center gap-1 font-mono">
              <span className="font-bold">Based on recorded sales</span>
            </p>
          </div>
          <div className="shrink-0 p-2 bg-indigo-50 rounded-lg text-indigo-500">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        {/* Today's Sales */}
        <div id="kpi-today-revenue" className="min-w-0 bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Today's Billing</p>
            <h3 className="text-lg xl:text-xl font-bold font-sans text-slate-950 mt-1 break-words leading-tight">
              {currencySymbol}{todayRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-slate-500 mt-1 font-mono">
              {todayTransactions.length} receipts today
            </p>
          </div>
          <div className="shrink-0 p-2 bg-blue-50 rounded-lg text-blue-500">
            <ShoppingCart className="w-5 h-5" />
          </div>
        </div>

        {/* Gross Profit (all sales) */}
        <div id="kpi-gross-profit" className="min-w-0 bg-white p-3 rounded-xl border border-emerald-100 shadow-2xs flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Gross Profit</p>
            <h3 className={`text-lg xl:text-xl font-bold font-sans mt-1 break-words leading-tight ${grossProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {grossProfit >= 0 ? '+' : '-'}{currencySymbol}{Math.abs(grossProfit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-slate-500 mt-1 font-mono">
              Today: {todayProfit >= 0 ? '+' : '-'}{currencySymbol}{Math.abs(todayProfit).toFixed(2)}
            </p>
          </div>
          <div className="shrink-0 p-2 bg-emerald-50 rounded-lg text-emerald-500">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        {/* Stock Potential Profit */}
        <div id="kpi-stock-profit" className="min-w-0 bg-white p-3 rounded-xl border border-indigo-100 shadow-2xs flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Stock Potential</p>
            <h3 className="text-lg xl:text-xl font-bold font-sans text-indigo-600 mt-1 break-words leading-tight">
              {currencySymbol}{stockPotentialProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-slate-500 mt-1 font-mono">
              If all stock is sold today
            </p>
          </div>
          <div className="shrink-0 p-2 bg-indigo-50 rounded-lg text-indigo-500">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        {/* Inventory capital value */}
        <div id="kpi-inventory-value" className="min-w-0 bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm hover:shadow-md transition-shadow flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Stock Capital</p>
            <h3 className="text-lg xl:text-xl font-bold font-sans text-slate-950 mt-1 break-words leading-tight">
              {currencySymbol}{inventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-slate-500 mt-1 font-mono">
              {products.length} items in catalog
            </p>
          </div>
          <div className="shrink-0 p-2 bg-emerald-50 rounded-lg text-emerald-500">
            <Package className="w-5 h-5" />
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div
          id="kpi-low-stock"
          onClick={() => onNavigateToTab('inventory')}
          className={`min-w-0 p-3 rounded-xl border shadow-2xs flex items-start justify-between gap-3 cursor-pointer transition-all ${
            lowStockCount > 0
              ? 'bg-rose-50/60 border-rose-100 text-rose-950 hover:bg-rose-50'
              : 'bg-white border-slate-100 text-slate-950'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Low Stock SKUs</p>
            <h3 className={`text-lg xl:text-xl font-bold font-sans mt-1 break-words leading-tight ${lowStockCount > 0 ? 'text-rose-600' : 'text-slate-950'}`}>
              {lowStockCount} Items
            </h3>
            <p className="text-[10px] mt-1 font-mono text-slate-500">
              Needs purchase refills
            </p>
          </div>
          <div className={`shrink-0 p-2 rounded-lg ${lowStockCount > 0 ? 'bg-rose-100 text-rose-500' : 'bg-slate-100 text-slate-400'}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Critical Alert Warning Bar */}
      {lowStockCount > 0 && (
        <div id="critical-stock-alert-bar" className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-slate-900 text-sm">Stock requires attention</p>
              <p className="text-xs text-slate-600 mt-0.5">
                There are {lowStockCount} hardware products that have fallen below their warning reorder safety limit. Refill suggestions have been generated by AI.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigateToTab('ai-insights')}
            className="text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 px-4 py-2 rounded-lg transition"
          >
            Refill Advisor
          </button>
        </div>
      )}

      {/* Recharts visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Trend Area Chart */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="font-medium text-slate-900 text-sm">Sales trend</h4>
              <p className="text-[11px] text-slate-400">Daily invoice values</p>
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1 font-sans">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              <span>Fortnightly Data</span>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value, name) => [`${currencySymbol}${value}`, name]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="Revenue" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
                <Area type="monotone" dataKey="Profit" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorProfit)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie Chart Department Distribution */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm flex flex-col justify-between">
          <div>
            <h4 className="font-medium text-slate-900 text-sm">Department Sales Breakdown</h4>
            <p className="text-[11px] text-slate-400">Sales volume percentage across hardware categories.</p>
          </div>
          <div className="h-40 my-2 flex items-center justify-center">
            {categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${currencySymbol}${value}`, 'Contribution']} contentStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-slate-400 text-xs text-center border border-dashed border-slate-200 p-6 rounded">No current transactions</div>
            )}
          </div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {categoryData.map((data, index) => {
              const totalVal = categoryData.reduce((acc, c) => acc + c.value, 0) || 1;
              const pct = ((data.value / totalVal) * 100).toFixed(0);
              return (
                <div key={data.name} className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                    <span className="text-slate-600 truncate max-w-32">{data.name}</span>
                  </div>
                  <span className="font-mono font-medium text-slate-800">{currencySymbol}{data.value} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Lower Details Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Recent Checkout Invoice Feed */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm lg:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-slate-900 text-sm">Recent Invoices</h4>
              <p className="text-[11px] text-slate-400">Latest recorded invoices.</p>
            </div>
            <button
              onClick={() => onNavigateToTab('pos')}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded transition"
            >
              Open Register
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-medium">
                  <th className="pb-2">Invoice #</th>
                  <th className="pb-2">Customer</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2 text-right">Revenue</th>
                  <th className="pb-2 text-right">Profit</th>
                  <th className="pb-2 text-right">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentTransactions.map((tx) => {
                  const txProfit = tx.status !== 'Refunded'
                    ? saleProfit(tx, productCostMap)
                    : null;
                  return (
                  <tr key={tx.id} className="hover:bg-slate-50/50">
                    <td className="py-1.5 font-mono text-indigo-600 font-semibold">{tx.invoiceNumber}</td>
                    <td className="py-1.5 font-medium text-slate-800">{tx.customerName}</td>
                    <td className="py-1.5 text-slate-500">
                      {new Date(tx.date).toLocaleDateString('en-US', { timeZone: 'Asia/Colombo', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-1.5 text-right font-mono font-bold text-slate-900">{currencySymbol}{tx.total}</td>
                    <td className={`py-1.5 text-right font-mono font-bold ${txProfit != null && txProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {txProfit == null
                        ? <span className="text-slate-400">—</span>
                        : <>{txProfit >= 0 ? '+' : '-'}{currencySymbol}{Math.abs(txProfit).toFixed(2)}</>
                      }
                    </td>
                    <td className="py-1.5 text-right">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-mono bg-slate-100 text-slate-600 border border-slate-200">
                        {tx.paymentMethod}
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Stock Watchlist */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm space-y-2">
          <div>
            <h4 className="font-medium text-slate-900 text-sm">Critical Inventory Alerts</h4>
            <p className="text-[11px] text-slate-400">Items immediately requiring restock.</p>
          </div>
          <div className="space-y-3">
            {criticalLowStock.length > 0 ? (
              criticalLowStock.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-rose-50/20 border border-transparent hover:border-rose-100 transition">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate" title={p.name}>{p.name}</p>
                    <p className="text-[9px] font-mono text-slate-400">{p.sku} | Level: {p.reorderLevel}</p>
                  </div>
                  <div className="text-right ml-2">
                    <span className="inline-block px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-rose-100 text-rose-700">
                      Qty: {p.quantity}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-slate-400 text-xs text-center border border-dashed border-slate-200 p-8 rounded">No products below the configured stock threshold.</p>
            )}
          </div>
          <button
            onClick={() => onNavigateToTab('purchases')}
            className="w-full text-center block text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-lg py-2 transition"
          >
            Create Supplier Purchase Order
          </button>
        </div>
      </div>

      {/* Business Employee Performance & Activity Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Activity Logs */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm space-y-2">
          <div>
            <h4 className="font-medium text-slate-900 text-sm">Active Audit Feed</h4>
            <p className="text-[11px] text-slate-400">Chronological system operations timeline.</p>
          </div>
          <div className="space-y-3.5 max-h-48 overflow-y-auto pr-1">
            {activityLogs.map((log) => (
              <div key={log.id} className="flex gap-3 text-xs leading-none">
                <div className="p-1.5 bg-slate-100 rounded-lg h-7 w-7 flex items-center justify-center shrink-0">
                  <Activity className="w-3.5 h-3.5 text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-800 truncate">{log.user}</p>
                    <span className="text-[9px] font-mono text-slate-400">{new Date(log.date).toLocaleDateString('en-US', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-[10px] font-mono text-amber-600 font-bold mt-0.5 uppercase tracking-wide">{log.action}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{log.details}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Staff Shift tracker */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/70 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-slate-900 text-sm">Staff Attendance & Scorecard</h4>
              <p className="text-[11px] text-slate-400">Daily attendance and efficiency metrics.</p>
            </div>
            <button
              onClick={() => onNavigateToTab('relationships')}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 font-sans transition"
            >
              Manage
            </button>
          </div>
          <div className="space-y-3 max-h-48 overflow-y-auto">
            {employees.map((emp) => (
              <div key={emp.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className={`w-2.5 h-2.5 rounded-full ${emp.attendanceStatus === 'Present' ? 'bg-emerald-500' : emp.attendanceStatus === 'On Leave' ? 'bg-amber-400' : 'bg-slate-300'}`}></div>
                  <div>
                    <p className="text-[11px] font-semibold text-slate-900">{emp.name}</p>
                    <p className="text-[9px] font-mono text-slate-400">{emp.role}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-mono font-medium block text-slate-700">Efficiency</span>
                  <div className="w-20 bg-slate-200 h-1 rounded overflow-hidden mt-1">
                    <div
                      className="h-1"
                      style={{
                        width: `${emp.performanceScore}%`,
                        background: 'linear-gradient(to right, #6366f1, #8b5cf6)',
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
