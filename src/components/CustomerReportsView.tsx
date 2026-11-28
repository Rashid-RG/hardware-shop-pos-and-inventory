import { ReportExportMenu } from './ReportExportMenu';
import type { BusinessReport } from '../utils/businessReport';
import { inReportPeriod, reportDay } from '../utils/reporting';
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

  const outstandingRows = [...rows].filter(row=>row.outstanding>0).sort((a,b)=>b.outstanding-a.outstanding||a.customer.name.localeCompare(b.customer.name));
  const positiveOutstanding = outstandingRows.reduce((sum,row)=>sum+cents(row.outstanding),0)/100;
  // Age only reconciled current credit balances, using agreed due dates.
  const today = reportDay(new Date());
  const ageLabels = ['Not due','1–30 days','31–60 days','61–90 days','91+ days','No valid due date','Reconciliation required'];
  const agedRows = outstandingRows.map(row=>{
    const buckets = Array<number>(7).fill(0);
    const ownInvoices = invoices.filter(tx=>tx.customerId===row.customer.id&&tx.shopId===row.customer.shopId);
    const ownPayments = payments.filter(p=>p.customerId===row.customer.id&&p.shopId===row.customer.shopId);
    const credit = ownInvoices.filter(tx=>tx.paymentMethod==='Credit Account'&&tx.status==='Completed');
    const balances = credit.map(tx=>({tx,balance:cents(Number(tx.total))-ownPayments.filter(p=>p.invoiceId===tx.id).reduce((sum,p)=>sum+cents(Number(p.amount)),0)}));
    const account = cents(row.outstanding);
    const uncertain = ownPayments.some(p=>!p.invoiceId||!ownInvoices.some(tx=>tx.id===p.invoiceId)||!Number.isFinite(Number(p.amount))||Number(p.amount)<=0)
      || balances.some(b=>b.balance<0||!Number.isFinite(Number(b.tx.total)))
      || balances.reduce((sum,b)=>sum+b.balance,0)!==account;
    if(uncertain) buckets[6]=account;
    else for(const {tx,balance} of balances){
      if(balance<=0)continue;
      const due=tx.creditDueDate||'';
      const parsed=Date.parse(due+'T00:00:00Z');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==due){buckets[5]+=balance;continue;}
      const days=Math.round((Date.parse(today+'T00:00:00Z')-parsed)/86400000);
      buckets[days<=0?0:days<=30?1:days<=60?2:days<=90?3:4]+=balance;
    }
    return {customer:row.customer,buckets};
  });
  const ageTotals=ageLabels.map((_,i)=>agedRows.reduce((sum,row)=>sum+row.buckets[i],0)/100);
  const ageingReport=():BusinessReport=>({
    title:'Customer receivables ageing',filename:'ars-customer-ageing',
    period:'Current balances as of '+today+' | Agreed due dates; matching customer filters',
    headers:['Customer ID','Customer shop',...ageLabels,'Total (LKR)'],
    rows:agedRows.map(row=>[row.customer.id,row.customer.name,...row.buckets.map(v=>v/100),row.buckets.reduce((sum,v)=>sum+v,0)/100]),
    moneyColumns:[2,3,4,5,6,7,8,9],
    summary:ageLabels.map((label,i)=>({label:label+' (LKR)',value:ageTotals[i]}))
  });
  const outstandingReport = (): BusinessReport => ({
    title: 'Customer outstanding balances', filename: 'ars-customer-outstanding',
    period: 'Current recorded balances | Matching customer filters',
    headers: ['Customer ID','Customer shop','Phone','Outstanding (LKR)','Date / follow-up'],
    rows: outstandingRows.map(row=>[row.customer.id,row.customer.name,row.customer.phone||'',row.outstanding,'']),
    moneyColumns:[3], summary:[{label:'Accounts owing',value:outstandingRows.length},{label:'Total outstanding (LKR)',value:positiveOutstanding}]
  });
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
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2 py-1"><span className="text-xs font-semibold">Outstanding-only report</span><ReportExportMenu report={outstandingReport} settings={settings}/></div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2 py-1"><span className="text-xs font-semibold">Receivables ageing</span><ReportExportMenu report={ageingReport} settings={settings}/></div>
            <span className="self-center text-xs text-slate-600">{rows.length} matching shops</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><span><strong>{outstandingRows.length}</strong> matching accounts owing · <strong className="text-rose-700">{currency(positiveOutstanding)}</strong> positive outstanding</span><button type="button" onClick={()=>{setBalanceFilter('outstanding');setActivityFilter('all');setFrom('');setTo('');setSearch('');}} className="rounded-lg border border-slate-300 px-3 py-2 font-semibold">View all outstanding accounts</button></div>
        <p className="text-xs text-amber-800">Date filters apply to invoices and repayments. Outstanding balances are today's recorded balances, not historical as-of-date balances. Refunded invoices are excluded from net sales.</p>
        <details className="rounded-xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-semibold">Receivables ageing · {today}</summary><p className="mt-2 text-xs text-slate-600">Based on agreed due dates and current balances, not historical date-filter snapshots. Accounts with unmatched payments or balances require reconciliation.</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{ageLabels.map((label,i)=><div key={label} className="rounded-lg border border-slate-200 p-2"><span className="block text-xs text-slate-500">{label}</span><strong className="text-sm">{currency(ageTotals[i])}</strong></div>)}</div></details>
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
        <div className="max-h-[55dvh] overflow-auto overscroll-contain rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600"><tr>
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
