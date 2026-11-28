import type { Pool, PoolClient } from 'pg';
import { baseQuantity, deductSharedStock, restoreSharedStock, type SharedStockUnits } from '../src/utils/unitConversion';
import { parsePackagingDraft } from './packagingDrafts';

// Additive schema. NULL keeps all historical invoice lines in their original stock mode.
export async function initSharedStockSchema(pool: Pool) {
  await pool.query(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS shared_stock_units JSONB;
    ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS selling_unit_id TEXT;
    ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS selling_unit_label TEXT;
    ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS base_units_per_sale_unit INTEGER;
  `);
}

export type SharedSaleSnapshot = {
  sellingUnitId: string;
  sellingUnitLabel: string;
  baseUnitsPerSaleUnit: number;
  sellingPrice: number;
  costPrice: number;
  baseQuantity: number;
};

// Must run inside the caller's checkout transaction. No public endpoint activates this model.
export async function deductSharedSale(client: PoolClient, shopId: string, productId: string, unitId: string, quantity: number): Promise<SharedSaleSnapshot> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Invalid sale quantity.');
  const result = await client.query(
    'SELECT quantity,cost_price,status,variants_json,shared_stock_units FROM products WHERE id=$1 AND shop_id=$2 FOR UPDATE',
    [productId,shopId]);
  const product = result.rows[0];
  if (!product || product.status === 'Inactive') throw new Error('Product unavailable.');
  if (!product.shared_stock_units || product.variants_json?.length) throw new Error('Product is not eligible for shared-stock sales.');
  const configuration: SharedStockUnits = parsePackagingDraft(product.shared_stock_units);
  const unit = configuration.units.find(entry => entry.id === unitId);
  if (!unit) throw new Error('Selling unit unavailable.');
  const costPrice = Math.round(Number(product.cost_price) * unit.baseUnits * 100) / 100;
  if (!Number.isFinite(costPrice) || costPrice < 0) throw new Error('Invalid product cost.');
  const remaining = deductSharedStock(Number(product.quantity), [{quantity,baseUnits:unit.baseUnits}]);
  await client.query('UPDATE products SET quantity=$1,updated_at=NOW() WHERE id=$2 AND shop_id=$3',
    [remaining,productId,shopId]);
  return {sellingUnitId:unit.id,sellingUnitLabel:unit.label,baseUnitsPerSaleUnit:unit.baseUnits,
    sellingPrice:unit.sellingPrice,costPrice,baseQuantity:baseQuantity(quantity,unit.baseUnits)};
}

// Historical returns must use the immutable factor saved on the invoice, not today's packaging definition.
export async function restoreSharedSale(client: PoolClient, shopId: string, productId: string, quantity: number, savedFactor: number): Promise<number> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Invalid return quantity.');
  const result = await client.query('SELECT quantity,variants_json,shared_stock_units FROM products WHERE id=$1 AND shop_id=$2 FOR UPDATE',[productId,shopId]);
  const product = result.rows[0];
  if (!product || !product.shared_stock_units || product.variants_json?.length) throw new Error('Cannot restore shared stock to an incompatible product.');
  const restored = restoreSharedStock(Number(product.quantity),quantity,savedFactor);
  if (restored > 2147483647) throw new Error('Stock exceeds database quantity range.');
  await client.query('UPDATE products SET quantity=$1,updated_at=NOW() WHERE id=$2 AND shop_id=$3',[restored,productId,shopId]);
  return baseQuantity(quantity,savedFactor);
}
