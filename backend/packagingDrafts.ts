import type { Pool } from 'pg';
import { validateSharedStock, type SharedStockUnits } from '../src/utils/unitConversion';

// Draft only: never changes inventory mode or enables selling-unit transactions.
export async function initPackagingDrafts(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ars_packaging_drafts (
    shop_id TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id),
    configuration JSONB NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(shop_id, product_id)
  )`);
}

export function parsePackagingDraft(raw: unknown): SharedStockUnits {
  if (!raw || typeof raw !== 'object') throw new Error('Packaging configuration required.');
  const value = raw as Record<string, unknown>;
  if (typeof value.baseUnit !== 'string' || value.baseUnit.length > 40 ||
      !Array.isArray(value.units) || !value.units.length || value.units.length > 30)
    throw new Error('Enter a base unit and 1–30 selling units.');
  const config = { baseUnit: value.baseUnit.trim(), units: value.units.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid selling unit.');
    const unit = entry as Record<string, unknown>;
    if (typeof unit.id !== 'string' || unit.id.length > 100 ||
        typeof unit.label !== 'string' || unit.label.length > 40 ||
        typeof unit.baseUnits !== 'number' || unit.baseUnits > 2147483647 ||
        typeof unit.sellingPrice !== 'number') throw new Error('Invalid selling unit fields.');
    return { id: unit.id.trim(), label: unit.label.trim(), baseUnits: unit.baseUnits, sellingPrice: unit.sellingPrice };
  }) };
  validateSharedStock(config);
  if (new Set(config.units.map(unit => unit.label.toLowerCase())).size !== config.units.length)
    throw new Error('Selling unit labels must be unique.');
  return config;
}

export async function getPackagingDraft(pool: Pool, shopId: string, productId: string) {
  const result = await pool.query(`SELECT d.configuration FROM products p
    LEFT JOIN ars_packaging_drafts d ON d.product_id=p.id AND d.shop_id=p.shop_id
    WHERE p.id=$1 AND p.shop_id=$2`, [productId, shopId]);
  if (!result.rowCount) throw new Error('Product not found in this shop.');
  return result.rows[0].configuration ?? null;
}

export async function savePackagingDraft(pool: Pool, shopId: string, productId: string, actor: string, raw: unknown) {
  const config = parsePackagingDraft(raw);
  const result = await pool.query(`INSERT INTO ars_packaging_drafts(shop_id,product_id,configuration,updated_by)
    SELECT shop_id,id,$3::jsonb,$4 FROM products WHERE id=$1 AND shop_id=$2
    ON CONFLICT(shop_id,product_id) DO UPDATE SET configuration=EXCLUDED.configuration,
    updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING configuration`,
    [productId,shopId,JSON.stringify(config),actor]);
  if (!result.rowCount) throw new Error('Product not found in this shop.');
  return result.rows[0].configuration;
}
