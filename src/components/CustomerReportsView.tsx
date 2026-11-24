import { ReportExportMenu } from './ReportExportMenu';
import type { BusinessReport } from '../utils/businessReport';
import { inReportPeriod } from '../utils/reporting';
import React, { useMemo, useState } from 'react';
import { Customer, CustomerCreditPayment, SalesTransaction, StoreSettings } from '../types';

interface Props {
  settings: StoreSettings;
  customers: Customer[];
  invoices: SalesTransaction[];
  payments: CustomerCreditPayment[];
  onClose: () => void;
}

const currency = (amount: number) => 'Rs. ' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (amount: number) => Math.round((Number.isFinite(amount) ? amount : 0) * 100);
export function CustomerReportsView({ settings, customers, invoices, payments, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'outstanding' | 'clear'>('all');
  const [activityFilter, setActivityFilter] = useState<'all' | 'with-sales' | 'with-credit' | 'with-payments'>('all');
  const rows = useMemo(() => customers.filter(customer => customer.id !== 'cust-walkin').map(customer => {
    const ownInvoice = invoices.filter(tx =>
      tx.customerId === customer.id && tx.shopId === customer.shopId
      && inReportPeriod(tx.date, from, to));
    const ownPayment = payments.filter(payment =>
      payment.customerId === customer.id && payment.shopId === customer.shopId
      && inReportPeriod(payment.date, from, to));
    const active = ownInvoice.filter(tx => tx.status !== 'Refunded');
    const credit = active.filter(tx => tx.paymentMethod === 'Credit Account');
    return {
      customer,
      invoiceCount: ownInvoice.length,
      refundedCount: ownInvoice.length - active.length,
      sales: active.reduce((sum, tx) => sum + cents(Number(tx.total)), 0) / 100,
      creditSales: credit.reduce((sum, tx) => sum + cents(Number(tx.total)), 0) / 100,
      repayments: ownPayment.reduce((sum, payment) => sum + cents(Number(payment.amount)), 0) / 100,
      outstanding: Number(customer.creditBalance || 0),
    };
  }).filter(row => {
    const value = search.trim().toLowerCase();
    const text = [row.customer.id, row.customer.name, row.customer.phone, row.customer.email, row.customer.address].join(' ').toLowerCase();
    return (!value || text.includes(value))
      && (balanceFilter === 'all' || (balanceFilter === 'outstanding' ? row.outstanding > 0 : row.outstanding <= 0))
      && (activityFilter === 'all'
        || (activityFilter === 'with-sales' && row.invoiceCount > 0)
        || (activityFilter === 'with-credit' && row.creditSales > 0)
        || (activityFilter === 'with-payments' && row.repayments > 0));
  }), [customers, invoices, payments, search, from, to, balanceFilter, activityFilter]);

  const totals = rows.reduce((acc, row) => ({
    sales: acc.sales + cents(row.sales),
    creditSales: acc.creditSales + cents(row.creditSales),
    repayments: acc.repayments + cents(row.repayments),
    outstanding: acc.outstanding + cents(row.outstanding),
  }), { sales: 0, creditSales: 0, repayments: 0, outstanding: 0 });

  const report = (): BusinessReport => ({
    title: 'Customer activity and outstanding balances',
    filename: 'ars-customer-report',
    period: (from || 'All dates') + ' to ' + (to || 'today') + ' | Outstanding is the current account balance.',
    csvPreamble: [
      ['Customer report from', from || 'All dates', 'To', to || 'All dates'],
      ['Note', 'Sales and repayment figures reflect date filters; outstanding is the current account snapshot.'],
    ],
    headers: ['Customer ID', 'Shop', 'Phone', 'Invoices', 'Refunded invoices', 'Net sales (LKR)', 'Credit sales (LKR)', 'Repayments (LKR)', 'Current outstanding (LKR)'],
    rows: rows.map(row => [row.customer.id, row.customer.name, row.customer.phone || '', row.invoiceCount,
      row.refundedCount, row.sales, row.creditSales, row.repayments, row.outstanding]),
    moneyColumns: [5, 6, 7, 8],
    summary: [
      {label:'Net sales (LKR)', value:totals.sales / 100},
      {label:'Credit sales (LKR)', value:totals.creditSales / 100},
      {label:'Repayments (LKR)', value:totals.repayments / 100},
      {label:'Current outstanding (LKR)', value:totals.outstanding / 100},
    ],
  });

  return <div role="dialog" aria-modal="true" aria-label="Customer reporting workspace"
    id="ars-customer-reports" className="fixed inset-0 z-40 flex flex-col bg-slate-50">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white p-4 sm:px-8">
      <div><p className="text-xs font-bold uppercase tracking-wide text-indigo-700">ARS Wholesale</p>
        <h2 className="text-xl font-bold text-slate-900">Customer reports</h2>
        <p className="text-xs text-slate-500">See every matching shop and export all results. No preview-only limit.</p>
      </div>
      <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-bold">
        Close reports
      </button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-bold">Find customer
            <input id="ars-report-search" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Shop, phone or ID" className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
          </label>
          <label className="text-xs font-bold">From
            <input id="ars-report-from" type="date" value={from} onChange={e=>setFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
          </label>
          <label className="text-xs font-bold">To
            <input id="ars-report-to" type="date" value={to} onChange={e=>setTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
          </label>
          <label className="text-xs font-bold">Outstanding
            <select id="ars-report-balance" value={balanceFilter} onChange={e=>setBalanceFilter(e.target.value as typeof balanceFilter)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm">
              <option value="all">All accounts</option><option value="outstanding">With debt</option><option value="clear">Clear accounts</option>
            </select>
          </label>
          <label className="text-xs font-bold">Activity in period
            <select id="ars-report-activity" value={activityFilter} onChange={e=>setActivityFilter(e.target.value as typeof activityFilter)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm">
              <option value="all">All shops</option><option value="with-sales">With invoices</option>
              <option value="with-credit">With credit sales</option><option value="with-payments">With repayments</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-5">
            <button type="button" onClick={()=>{setSearch('');setFrom('');setTo('');setBalanceFilter('all');setActivityFilter('all');}}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold">Clear filters</button>
            <div id="ars-report-export"><ReportExportMenu report={report} settings={settings}/></div>
            <span className="self-center text-xs text-slate-600">{rows.length} matching shops</span>
          </div>
        </div>
        <p className="text-xs text-amber-800">Date filters apply to invoices and repayments. Outstanding balances are today's recorded balances, not historical as-of-date balances. Refunded invoices are excluded from net sales.</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Net sales in period', totals.sales],
            ['Credit sales in period', totals.creditSales],
            ['Repayments in period', totals.repayments],
            ['Current outstanding', totals.outstanding],
          ].map(([label, amount]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-600">{label}</p>
            <p className="mt-1 text-base font-bold text-slate-900">{currency(Number(amount)/100)}</p>
          </div>)}
        </div>
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr>
              <th className="p-3">Customer shop</th><th className="p-3">Phone</th>
              <th className="p-3 text-right">Invoices</th><th className="p-3 text-right">Refunded</th>
              <th className="p-3 text-right">Net sales</th><th className="p-3 text-right">Credit sales</th>
              <th className="p-3 text-right">Repayments</th><th className="p-3 text-right">Current outstanding</th>
            </tr></thead>
            <tbody>{rows.map(row => <tr key={row.customer.id} className="border-t border-slate-100">
              <td className="p-3"><strong>{row.customer.name}</strong><p className="text-xs text-slate-500">{row.customer.id}</p></td>
              <td className="p-3">{row.customer.phone}</td><td className="p-3 text-right">{row.invoiceCount}</td>
              <td className="p-3 text-right">{row.refundedCount}</td><td className="p-3 text-right">{currency(row.sales)}</td>
              <td className="p-3 text-right">{currency(row.creditSales)}</td>
              <td className="p-3 text-right">{currency(row.repayments)}</td>
              <td className="p-3 text-right font-bold">{currency(row.outstanding)}</td>
            </tr>)}</tbody>
          </table>
          {rows.length === 0 && <p className="p-6 text-center text-sm text-slate-600">No customers match these filters.</p>}
        </div>
      </div>
    </div>
  </div>;
}
