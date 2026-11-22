export const roundMoney = (value: number) => Math.round(value * 100) / 100;

// Preserve the register's existing policy: line discounts reduce taxable value,
// then the invoice-wide discount reduces the amount payable.
export function invoiceTotals(lineSubtotal: number, taxRatePercent: number, discount = 0) {
  const subtotal = roundMoney(lineSubtotal);
  const tax = roundMoney(subtotal * (Math.max(0, taxRatePercent) / 100));
  const total = roundMoney(Math.max(0, subtotal - Math.max(0, discount)) + tax);
  return { subtotal, tax, total };
}
