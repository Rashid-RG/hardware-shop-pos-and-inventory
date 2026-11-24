import { baseQuantity, validateSharedStock, type SharedStockUnits } from './unitConversion';

export type LegacyPackagingInput = {
  quantity: number;
  reorderLevel: number;
  costPrice: number;
  sellingPrice: number;
  legacyUnitId: string;
  configuration: SharedStockUnits;
};

/** Read-only calculation. Never infer the legacy stock unit from a description. */
export function previewLegacyPackaging(input: LegacyPackagingInput) {
  validateSharedStock(input.configuration);
  if (input.configuration.units.filter(u => u.baseUnits === 1).length !== 1) throw new Error('Exactly one base selling unit is required.');
  const legacy = input.configuration.units.find(u => u.id === input.legacyUnitId);
  if (!legacy) throw new Error('Explicitly select the unit represented by current inventory.');
  const whole = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!whole(input.quantity) || !whole(input.reorderLevel)) throw new Error('Invalid existing inventory quantities.');
  const cents = (n: number) => {
    const value = Math.round(n * 100);
    if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(value) || Math.abs(n * 100 - value) > 0.00001) throw new Error('Invalid currency value.');
    return value;
  };
  const costCents = cents(input.costPrice);
  const oldPriceCents = cents(input.sellingPrice);
  const newQuantity = input.quantity === 0 ? 0 : baseQuantity(input.quantity, legacy.baseUnits);
  const newReorderLevel = input.reorderLevel === 0 ? 0 : baseQuantity(input.reorderLevel, legacy.baseUnits);
  if (newQuantity > 2147483647 || newReorderLevel > 2147483647) throw new Error('Converted quantity exceeds database range.');
  const valueBeforeCents = input.quantity * costCents;
  if (!Number.isSafeInteger(valueBeforeCents)) throw new Error('Inventory valuation exceeds safe range.');
  const exactCost = costCents % legacy.baseUnits === 0;
  const newCostCents = Math.round(costCents / legacy.baseUnits);
  const valueAfterCents = newQuantity * newCostCents;
  if (!Number.isSafeInteger(valueAfterCents)) throw new Error('Converted valuation exceeds safe range.');
  const reasons: string[] = [];
  if (!exactCost) reasons.push('Existing cost cannot be represented exactly per base unit at two decimal places; reconcile valuation before conversion.');
  if (cents(legacy.sellingPrice) !== oldPriceCents) reasons.push('The configured legacy-unit selling price differs from the current selling price; review before conversion.');
  return {
    legacyUnit: legacy.label, baseUnit: input.configuration.baseUnit, factor: legacy.baseUnits,
    oldQuantity: input.quantity, newQuantity, oldReorderLevel: input.reorderLevel, newReorderLevel,
    oldCostPrice: input.costPrice, newCostPrice: newCostCents / 100,
    valueBefore: valueBeforeCents / 100, valueAfter: valueAfterCents / 100,
    valuationDifference: (valueAfterCents - valueBeforeCents) / 100,
    eligible: reasons.length === 0, reasons,
  };
}
