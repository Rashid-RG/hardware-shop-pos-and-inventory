import { ReportExportMenu } from './ReportExportMenu';
import type { BusinessReport } from '../utils/businessReport';
import { reportDay } from '../utils/reporting';
import React, { useMemo, useState } from 'react';
import { Customer, CustomerCreditPayment, SalesTransaction, StoreSettings } from '../types';
import { buildCustomerLedger, filterCustomerLedger, toCents, customerStatementPeriod } from '../utils/customerLedger';
import type { CustomerLedgerEntry } from '../utils/customerLedger';

interface Props {
  settings: StoreSettings;
  customer: Customer;
  invoices: SalesTransaction[];
  payments: CustomerCreditPayment[];
}

const money = (amount: number) => 'Rs. ' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function CustomerLedgerPanel({ settings, customer, invoices, payments }: Props) {
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'all' | CustomerLedgerEntry['kind']>('all');
  const outcome = useMemo(() => {
    try {
      return { ledger: buildCustomerLedger(customer, invoices, payments), error: '' };
    } catch (error) {
      return { ledger: null, error: error instanceof Error ? error.message : 'Ledger data is invalid.' };
    }
  }, [customer, invoices, payments]);

  if (!outcome.ledger) {
    return <section id="ars-customer-ledger" className="rounded-xl border border-red-200 bg-white p-4" role="alert">
      <h3 className="font-bold text-red-800">Customer statement cannot be verified</h3>
      <p className="mt-2 text-sm text-red-700">{outcome.error}</p>
      <p className="mt-2 text-xs text-slate-600">The stored outstanding balance has not been changed. Please have a manager reconcile this account.</p>
    </section>;
  }

  const ledger = outcome.ledger;
  const filtered = filterCustomerLedger(ledger, { from, to, search, kind });
  const credits = filtered.entries.reduce((sum, entry) => sum + toCents(entry.credit), 0) / 100;
  const debits = filtered.entries.reduce((sum, entry) => sum + toCents(entry.debit), 0) / 100;
  let period:ReturnType<typeof customerStatementPeriod>|null=null;let periodError='';
  try{period=customerStatementPeriod(ledger,from,to);}catch(e){periodError=e instanceof Error?e.message:'Invalid statement period.';}
  const report = (): BusinessReport => {
    if(!period)throw Error(periodError);
    return ({
    title: 'Customer credit statement',
    filename: 'ars-credit-statement-' + customer.id.replace(/[^a-zA-Z0-9_-]/g, ''),
    period: customer.name + ' | ' + (from || 'Earliest recorded') + ' to ' + (to || 'Latest recorded') + (search.trim()||kind!=='all'?' | Selected movement rows only':'') + (ledger.hasOpeningDifference?' | Historical opening unverified':''),
    csvPreamble: [
      ['Customer ID', customer.id], ['Customer Shop', customer.name],
      ['Authoritative closing balance (LKR)', ledger.closingBalance],
      ['Unverified historical opening difference (LKR)', ledger.openingBalance],
      ['Period opening',period.opening],['Period debits',period.debit],['Period credits',period.credit],['Period closing',period.closing],
      ['Filters', JSON.stringify({ from, to, search, kind })],
    ],
    headers: ['Date', 'Type', 'Reference', 'Details', 'Debit (LKR)', 'Credit (LKR)', 'Full ledger running balance (LKR)'],
    rows: filtered.entries.map(entry => [reportDay(entry.date), entry.kind, entry.reference, entry.details, entry.debit, entry.credit, entry.balance]),
    moneyColumns: [4, 5, 6],
    summary: [
      {label:'Current closing balance (LKR)', value:ledger.closingBalance},
      {label:'Unverified opening difference (LKR)', value:ledger.openingBalance},
      {label:'Period opening (LKR)',value:period.opening},{label:'Period debits (LKR)',value:period.debit},
      {label:'Period credits (LKR)',value:period.credit},{label:'Period closing (LKR)',value:period.closing},
      {label:'Filtered debits (LKR)', value:debits}, {label:'Filtered credits (LKR)', value:credits},
    ],
  });};
  return <section id="ars-customer-ledger" aria-label="Reconciled customer credit statement"
    className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-lg font-bold text-slate-900">Customer credit account statement</h3>
        <p className="mt-1 text-xs text-slate-600">Credit invoices increase debt. Repayments and credit refunds reduce debt. Paid cash/bank invoices are not customer debt.</p>
      </div>
      <div id="ars-credit-statement-export">{period?<ReportExportMenu report={report} settings={settings}/>:<p role="alert" className="text-xs text-rose-700">{periodError}</p>}</div>
    </div>
    {ledger.hasOpeningDifference && <div role="status" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <strong>Historical difference: {money(ledger.openingBalance)}.</strong>
      {' '}The stored balance reconciles with these known movements only after accounting for this unexplained starting difference.
      Earlier activity may be missing. This is not a confirmed opening invoice or payment.
    </div>}
    {!ledger.hasOpeningDifference && <p className="mt-3 text-xs font-semibold text-emerald-700">
      Recorded credit movements reconcile to the stored outstanding balance.
    </p>}
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-600">Opening difference</p><strong>{money(ledger.openingBalance)}</strong></div>
      <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-600">Recorded change</p><strong>{money(ledger.recordedChange)}</strong></div>
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs text-indigo-700">Current outstanding</p><strong>{money(ledger.closingBalance)}</strong></div>
    </div>
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs font-semibold">Search references
        <input id="ars-credit-ledger-search" value={search} onChange={e=>setSearch(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" placeholder="Invoice or repayment note" />
      </label>
      <label className="text-xs font-semibold">Movement
        <select id="ars-credit-ledger-kind" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm">
          <option value="all">All credit movements</option><option value="Credit invoice">Credit invoices</option>
          <option value="Credit repayment">Repayments</option><option value="Credit refund">Refunds</option>
        </select>
      </label>
      <label className="text-xs font-semibold">From
        <input id="ars-credit-ledger-from" type="date" value={from} onChange={e=>setFrom(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
      </label>
      <label className="text-xs font-semibold">To
        <input id="ars-credit-ledger-to" type="date" value={to} onChange={e=>setTo(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
      </label>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
      <p>{filtered.entries.length} matching movement(s) · Debits {money(debits)} · Credits {money(credits)}</p>
      <button type="button" onClick={()=>{setSearch('');setFrom('');setTo('');setKind('all');}}
        className="rounded-lg border border-slate-300 px-3 py-2 font-semibold">Clear statement filters</button>
    </div>
    {period&&(from||to)&&<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-lg border border-slate-200 p-3 text-xs">{[['Period opening',period.opening],['Period debits',period.debit],['Period credits',period.credit],['Period closing',period.closing]].map(([label,value])=><div key={String(label)}><p>{label}</p><strong>{money(Number(value))}</strong></div>)}<p className="col-span-full text-slate-600">Period balances include all movements in the date range, regardless of search or movement filters. {ledger.hasOpeningDifference?'Historical opening remains unverified.':''}</p></div>}
    {filtered.isFiltered && <p className="mb-2 mt-1 text-xs text-amber-800">
      Running balances are from the full account history, not recalculated from filtered rows.
    </p>}
    <div className="mt-2 max-h-[480px] overflow-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[800px] text-left text-xs">
        <thead className="sticky top-0 bg-slate-100"><tr>
          <th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Reference</th>
          <th className="p-3">Details</th><th className="p-3 text-right">Debit</th>
          <th className="p-3 text-right">Credit</th><th className="p-3 text-right">Balance</th>
        </tr></thead>
        <tbody>{filtered.entries.map(entry => <tr key={entry.id} className="border-t border-slate-100">
          <td className="p-3">{reportDay(entry.date)}</td><td className="p-3">{entry.kind}</td>
          <td className="p-3">{entry.reference}</td><td className="p-3">{entry.details}</td>
          <td className="p-3 text-right">{entry.debit ? money(entry.debit) : '—'}</td>
          <td className="p-3 text-right">{entry.credit ? money(entry.credit) : '—'}</td>
          <td className="p-3 text-right font-bold">{money(entry.balance)}</td>
        </tr>)}</tbody>
      </table>
      {filtered.entries.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No matching credit movements.</p>}
    </div>
  </section>;
}
