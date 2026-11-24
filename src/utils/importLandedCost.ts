/**
 * Pure import cost estimator. No inventory or accounting writes occur here.
 * Currency and exchange rate are explicit so historical rates are preserved
 * in any estimates a user exports or records separately.
 */
export type ImportLine = {
  sku: string;
  description: string;
  quantity: number;
  unitForeign: number;
};
export type ImportEstimateInput = {
  currency: 'CNY' | 'USD' | 'LKR';
  exchangeRateLkr: number;
  freightLkr: number;
  dutiesLkr: number;
  clearanceLkr: number;
  otherLkr: number;
  lines: ImportLine[];
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const valid = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1_000_000_000;

export function estimateImportLandedCost(input: ImportEstimateInput) {
  if (!['CNY', 'USD', 'LKR'].includes(input.currency)) throw new Error('Choose CNY, USD or LKR.');
  if (!Number.isFinite(input.exchangeRateLkr) || input.exchangeRateLkr <= 0 || input.exchangeRateLkr > 100000) throw new Error('Enter a valid LKR exchange rate.');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) throw new Error('Enter 1 to 100 import items.');
  const charges = [input.freightLkr, input.dutiesLkr, input.clearanceLkr, input.otherLkr];
  if (!charges.every(valid)) throw new Error('Enter nonnegative LKR costs.');
  const rows = input.lines.map((line) => {
    const quantity = Number(line.quantity);
    if (!String(line.sku).trim() || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000 || !valid(line.unitForeign)) {
      throw new Error('Enter a valid SKU, quantity and foreign unit cost.');
    }
    const lineForeign = line.unitForeign * quantity;
    const baseLkr = round2(lineForeign * input.exchangeRateLkr);
    if (!valid(lineForeign) || !valid(baseLkr)) throw new Error('Import line exceeds maximum value.');
    return { sku: String(line.sku).trim(), description: String(line.description || '').trim(), quantity, lineForeign: round2(lineForeign), baseLkr };
  });
  const goodsTotalLkr = round2(rows.reduce((sum, row) => sum + row.baseLkr, 0));
  if (goodsTotalLkr <= 0) throw new Error('Goods value must be greater than zero.');
  const chargesTotalLkr = round2(charges.reduce((sum, value) => sum + value, 0));
  if (!valid(chargesTotalLkr) || !valid(goodsTotalLkr + chargesTotalLkr)) throw new Error('Import total is too large.');
  // Allocate in integer cents by largest remainder. BigInt keeps exact
  // proportional shares even for large supported invoice totals.
  const totalCents=BigInt(Math.round(chargesTotalLkr*100));
  const goodsCents=BigInt(Math.round(goodsTotalLkr*100));
  const allocations=rows.map((row,index)=>{
    const numerator=totalCents*BigInt(Math.round(row.baseLkr*100));
    return {index,cents:numerator/goodsCents,remainder:numerator%goodsCents};
  });
  let remaining=totalCents-allocations.reduce((sum,row)=>sum+row.cents,0n);
  const ranked=[...allocations].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
  for(const row of ranked){if(remaining===0n)break;row.cents++;remaining--;}
  const detail=rows.map((row,index)=>{
    const allocatedChargesLkr=Number(allocations[index].cents)/100;
    const landedTotalLkr=round2(row.baseLkr+allocatedChargesLkr);
    return {...row,allocatedChargesLkr,landedTotalLkr,landedUnitCostLkr:round2(landedTotalLkr/row.quantity)};
  });
  return { currency: input.currency, exchangeRateLkr: input.exchangeRateLkr,
    goodsTotalLkr, chargesTotalLkr, grandTotalLkr: round2(goodsTotalLkr + chargesTotalLkr), detail };
}
