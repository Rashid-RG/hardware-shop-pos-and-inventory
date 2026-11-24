import { reportDay } from './reporting.ts';
import type { Customer, CustomerCreditPayment, SalesTransaction } from '../types';

export type CustomerLedgerEntry = {
  id: string;
  kind: 'Credit invoice' | 'Credit repayment' | 'Credit refund';
  date: string;
  reference: string;
  details: string;
  debit: number;
  credit: number;
  balance: number;
};

export type CustomerLedger = {
  openingBalance: number;
  closingBalance: number;
  recordedChange: number;
  hasOpeningDifference: boolean;
  entries: CustomerLedgerEntry[];
};

export const toCents = (value: number): number => {
  if (!Number.isFinite(value)) throw new Error('Invalid customer financial amount.');
  return Math.round(value * 100);
};
const fromCents = (value: number) => value / 100;

type PendingEntry = Omit<CustomerLedgerEntry, 'balance'>;

/**
 * Reconstruct known credit movements and anchor them to the authoritative
 * customer credit_balance. An unexplained starting difference is displayed,
 * NEVER silently labelled zero or treated as a new invoice/repayment.
 * Dates on imported credit repayments may only have day precision.
 */
export function buildCustomerLedger(
  customer: Customer,
  invoices: SalesTransaction[],
  payments: CustomerCreditPayment[],
): CustomerLedger {
  const events: PendingEntry[] = [];
  const safeDate = (value: string | undefined) => String(value || '');
  for (const invoice of invoices) {
    if (invoice.customerId !== customer.id || invoice.shopId !== customer.shopId) continue;
    if (invoice.paymentMethod !== 'Credit Account') continue;
    const cents = toCents(Number(invoice.total));
    if (cents < 0) throw new Error('Credit invoice cannot be negative.');
    events.push({
      id: 'invoice:' + invoice.id,
      kind: 'Credit invoice',
      date: safeDate(invoice.date),
      reference: invoice.invoiceNumber,
      details: 'Credit sale',
      debit: fromCents(cents), credit: 0,
    });
    if (invoice.status === 'Refunded') {
      if (!invoice.refundedAt) {
        throw new Error('Refund date missing for credit invoice ' + invoice.invoiceNumber);
      }
      events.push({
        id: 'refund:' + invoice.id,
        kind: 'Credit refund',
        date: safeDate(invoice.refundedAt),
        reference: invoice.invoiceNumber,
        details: 'Credit invoice refunded' + (invoice.refundReason ? ': ' + invoice.refundReason : ''),
        debit: 0, credit: fromCents(cents),
      });
    }
  }
  for (const payment of payments) {
    if (payment.customerId !== customer.id || payment.shopId !== customer.shopId) continue;
    const cents = toCents(Number(payment.amount));
    if (cents <= 0) throw new Error('Credit repayment must be positive.');
    events.push({
      id: 'payment:' + payment.id,
      kind: 'Credit repayment',
      date: safeDate(payment.date),
      reference: payment.paymentMethod,
      details: payment.note || 'Customer credit repayment',
      debit: 0, credit: fromCents(cents),
    });
  }

  // Stable sorting is necessary when older payment records have only a date.
  // Identical-day order is for presentation; it does not establish timestamps.
  const priority: Record<PendingEntry['kind'], number> = {
    'Credit invoice': 0, 'Credit repayment': 1, 'Credit refund': 2,
  };
  events.sort((a, b) =>
    reportDay(a.date).localeCompare(reportDay(b.date))
    || priority[a.kind] - priority[b.kind]
    || a.id.localeCompare(b.id));
  const closingCents = toCents(Number(customer.creditBalance || 0));
  const changeCents = events.reduce((sum, item) =>
    sum + toCents(item.debit) - toCents(item.credit), 0);
  const openingCents = closingCents - changeCents;
  let running = openingCents;
  const entries = events.map((entry) => {
    running += toCents(entry.debit) - toCents(entry.credit);
    return { ...entry, balance: fromCents(running) };
  });
  if (running !== closingCents) throw new Error('Customer ledger did not reconcile.');
  return {
    openingBalance: fromCents(openingCents),
    closingBalance: fromCents(closingCents),
    recordedChange: fromCents(changeCents),
    hasOpeningDifference: openingCents !== 0,
    entries,
  };
}

export function filterCustomerLedger(
  ledger: CustomerLedger,
  options: { from?: string; to?: string; search?: string; kind?: 'all' | CustomerLedgerEntry['kind'] },
) {
  const search = (options.search || '').trim().toLowerCase();
  const entries = ledger.entries.filter((entry) => {
    const date = reportDay(entry.date);
    return (!options.from || date >= options.from)
      && (!options.to || date <= options.to)
      && (!options.kind || options.kind === 'all' || entry.kind === options.kind)
      && (!search || [entry.reference, entry.details, entry.kind]
        .some((value) => value.toLowerCase().includes(search)));
  });
  const filteredDebit = entries.reduce((sum, entry) => sum + toCents(entry.debit), 0);
  const filteredCredit = entries.reduce((sum, entry) => sum + toCents(entry.credit), 0);
  // Full-ledger balances are intentionally preserved even when filtering rows.
  // Summing only matching rows must never be represented as a true closing balance.
  return {
    entries,
    filteredDebit: fromCents(filteredDebit),
    filteredCredit: fromCents(filteredCredit),
    isFiltered: Boolean(options.from || options.to || search || (options.kind && options.kind !== 'all')),
  };
}
