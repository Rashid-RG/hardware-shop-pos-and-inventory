// Monetary totals are shared by billing and quotations. Never propagate NaN,
// Infinity, negative amounts or a discount greater than the taxable subtotal.
export const roundMoney = (value: number) =>
  Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : 0;

const nonNegativeMoney = (value: number) =>
  roundMoney(Number.isFinite(value) ? Math.max(0, value) : 0);

// Preserve the register's existing tax policy: tax is calculated from the
// line-discounted subtotal; the invoice-wide discount reduces amount payable.
// Changing this tax policy requires separate business/accounting validation.
export function invoiceTotals(lineSubtotal: number, taxRatePercent: number, discount = 0) {
  const subtotal = nonNegativeMoney(lineSubtotal);
  const rate = Number.isFinite(taxRatePercent) ? Math.max(0, taxRatePercent) : 0;
  const appliedDiscount = Math.min(subtotal, nonNegativeMoney(discount));
  const tax = roundMoney(subtotal * (rate / 100));
  const total = roundMoney(subtotal - appliedDiscount + tax);
  return { subtotal, tax, total };
}
