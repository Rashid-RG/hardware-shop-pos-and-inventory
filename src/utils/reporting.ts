import type { SalesTransaction } from '../types';

const zone = 'Asia/Colombo';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function reportDay(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dayFormat.format(date) : '';
}

export function reportTime(value: string): string {
  const day = reportDay(value);
  if (!day || day === value) return day;
  return day + ' ' + timeFormat.format(new Date(value)) + ' +05:30';
}

export function inReportPeriod(value: string, from: string, to: string): boolean {
  const day = reportDay(value);
  return !!day && (!from || day >= from) && (!to || day <= to);
}

type SaleLine = SalesTransaction['items'][number];
export function lineRevenue(item: SaleLine): number {
  return item.sellingPrice * item.quantity * (1 - (item.discount || 0) / 100) - (item.discountAmount || 0);
}

export function lineProfit(item: SaleLine, costs: ReadonlyMap<string, number>): number {
  const unitCost = item.costPrice ?? costs.get(item.productId) ?? item.sellingPrice;
  return lineRevenue(item) - unitCost * item.quantity;
}

export function saleProfit(tx: SalesTransaction, costs: ReadonlyMap<string, number>): number {
  if (tx.status === 'Refunded') return 0;
  const gross = tx.items.reduce((sum, item) => sum + lineProfit(item, costs), 0);
  return Math.round((gross - (tx.discountAmount || 0)) * 100) / 100;
}
