import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
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

/** Conservative first-release eligibility. No inventory or history is modified. */
export async function checkPackagingActivation(pool: Pool | PoolClient, shopId: string, productId: string) {
  const result = await pool.query(`
    SELECT p.quantity,p.status,p.variants_json,p.shared_stock_units,d.configuration,
      EXISTS(SELECT 1 FROM sales_transaction_items s WHERE s.product_id=p.id) AS has_sales,
      EXISTS(SELECT 1 FROM purchase_order_items i WHERE i.product_id=p.id) AS has_purchases,
      EXISTS(SELECT 1 FROM stock_logs l WHERE l.product_id=p.id) AS has_stock_history,
      EXISTS(SELECT 1 FROM quotations q WHERE q.shop_id=p.shop_id
        AND q.items @> jsonb_build_array(jsonb_build_object('productId',p.id))) AS has_quotes
    FROM products p LEFT JOIN ars_packaging_drafts d ON d.product_id=p.id AND d.shop_id=p.shop_id
    WHERE p.id=$1 AND p.shop_id=$2`,[productId,shopId]);
  const row=result.rows[0];
  if (!row) throw new Error('Product not found in this shop.');
  const reasons:string[]=[];
  if (row.shared_stock_units) reasons.push('Shared stock already active.');
  if (row.status==='Inactive') reasons.push('Product is inactive.');
  if (Number(row.quantity)!==0) reasons.push('Existing stock requires a separate conversion and reconciliation.');
  if (row.variants_json?.length) reasons.push('Independent variants cannot be converted automatically.');
  if (row.has_sales || row.has_purchases || row.has_stock_history || row.has_quotes) reasons.push('Existing transaction or stock history requires manual reconciliation.');
  if (!row.configuration) reasons.push('Save a packaging draft first.');
  else {
    try { const config=parsePackagingDraft(row.configuration);
      if (config.units.filter(u=>u.baseUnits===1).length!==1) reasons.push('Exactly one base selling unit is required.');
    } catch { reasons.push('Packaging configuration is invalid.'); }
  }
  return {eligible:reasons.length===0,reasons,active:Boolean(row.shared_stock_units)};
}

/** Pilot-only activation: no stock is changed and configuration becomes immutable. */
export async function activatePackaging(pool: Pool, shopId: string, productId: string, actor: string, role: string, confirmed: unknown) {
  if (process.env.ARS_SHARED_STOCK_PILOT !== 'true') throw new Error('Shared-stock activation is disabled pending integration verification.');
  if (!['Super Admin','Store Manager'].includes(role) || confirmed !== true) throw new Error('Manager confirmation required.');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const product=await client.query('SELECT id FROM products WHERE id=$1 AND shop_id=$2 FOR UPDATE',[productId,shopId]);
    if (!product.rowCount) throw new Error('Product not found in this shop.');
    const draft=await client.query('SELECT configuration FROM ars_packaging_drafts WHERE product_id=$1 AND shop_id=$2 FOR UPDATE',[productId,shopId]);
    const eligibility=await checkPackagingActivation(client,shopId,productId);
    if (!eligibility.eligible || !draft.rowCount) throw new Error(eligibility.reasons.join(' ') || 'Packaging draft required.');
    const config=parsePackagingDraft(draft.rows[0].configuration);
    await client.query('UPDATE products SET shared_stock_units=$1::jsonb,updated_at=NOW() WHERE id=$2 AND shop_id=$3',[JSON.stringify(config),productId,shopId]);
    await client.query(`INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details)
      VALUES($1,$2,NOW(),$3,$4,'Activated Shared Stock',$5)`,
      ['packaging-'+randomUUID(),shopId,actor,role,'Activated base unit '+config.baseUnit+' for '+productId+'; stock unchanged.']);
    await client.query('COMMIT');
    return config;
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally {client.release();}
}
