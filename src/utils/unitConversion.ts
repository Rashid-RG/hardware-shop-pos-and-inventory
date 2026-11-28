/** Shared-stock packaging model. Legacy independently stocked variants are not converted implicitly. */
export interface SellingUnit {
  id: string;
  label: string;
  baseUnits: number;
  sellingPrice: number;
}
export interface SharedStockUnits {
  baseUnit: string;
  units: SellingUnit[];
}
export function validateSharedStock(config: SharedStockUnits): void {
  if (!config.baseUnit.trim() || !config.units.length) throw new Error('A base unit and selling units are required.');
  const ids = new Set<string>();
  for (const unit of config.units) {
    if (!unit.id.trim() || !unit.label.trim() || ids.has(unit.id)) throw new Error('Selling units must have unique IDs and labels.');
    ids.add(unit.id);
    if (!Number.isSafeInteger(unit.baseUnits) || unit.baseUnits <= 0) throw new Error('Conversion must be a positive whole number.');
    if (!Number.isFinite(unit.sellingPrice) || unit.sellingPrice < 0) throw new Error('Invalid selling price.');
  }
  if (!config.units.some(unit => unit.baseUnits === 1)) throw new Error('A base selling unit is required.');
}
export function baseQuantity(quantity: number, factor: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 0 || !Number.isSafeInteger(factor) || factor < 1)
    throw new Error('Invalid unit quantity or conversion.');
  const total = quantity * factor;
  if (!Number.isSafeInteger(total)) throw new Error('Stock quantity exceeds supported range.');
  return total;
}
export function availableSellingUnits(stock: number, factor: number): number {
  baseQuantity(stock, 1);
  baseQuantity(1, factor);
  return Math.floor(stock / factor);
}
export function deductSharedStock(stock: number, lines: readonly {quantity:number; baseUnits:number}[]): number {
  baseQuantity(stock,1);
  let remaining = stock;
  for (const line of lines) {
    const required = baseQuantity(line.quantity,line.baseUnits);
    if (required > remaining) throw new Error('Insufficient shared stock.');
    remaining -= required;
  }
  return remaining;
}
export function restoreSharedStock(stock: number, quantity: number, savedFactor: number): number {
  baseQuantity(stock,1);
  return baseQuantity(stock + baseQuantity(quantity,savedFactor),1);
}
