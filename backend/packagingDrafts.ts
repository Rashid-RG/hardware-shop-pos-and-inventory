import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { previewLegacyPackaging } from '../src/utils/legacyPackagingConversion';
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
  // Separate immutable return factors keep historical financial documents untouched.
  await pool.query(`CREATE TABLE IF NOT EXISTS ars_legacy_sale_return_units (
    sale_item_id BIGINT PRIMARY KEY REFERENCES sales_transaction_items(id),
    shop_id TEXT NOT NULL,
    product_id TEXT NOT NULL REFERENCES products(id),
    legacy_unit_label TEXT NOT NULL,
    base_units INTEGER NOT NULL CHECK(base_units > 0),
    recorded_by TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  const result = await pool.query(`SELECT COALESCE(p.shared_stock_units,d.configuration) AS configuration FROM products p
    LEFT JOIN ars_packaging_drafts d ON d.product_id=p.id AND d.shop_id=p.shop_id
    WHERE p.id=$1 AND p.shop_id=$2`, [productId, shopId]);
  if (!result.rowCount) throw new Error('Product not found in this shop.');
  return result.rows[0].configuration ?? null;
}

export async function savePackagingDraft(pool: Pool, shopId: string, productId: string, actor: string, raw: unknown) {
  const config = parsePackagingDraft(raw);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const product=await client.query('SELECT shared_stock_units,status FROM products WHERE id=$1 AND shop_id=$2 FOR UPDATE',[productId,shopId]);
    if(!product.rowCount)throw new Error('Product not found in this shop.');
    if(product.rows[0].shared_stock_units)throw new Error('Active packaging cannot be changed through drafts. Use price management.');
    if(product.rows[0].status==='Inactive')throw new Error('Product is inactive.');
    const result=await client.query(`INSERT INTO ars_packaging_drafts(shop_id,product_id,configuration,updated_by)
      VALUES($1,$2,$3::jsonb,$4)
      ON CONFLICT(shop_id,product_id) DO UPDATE SET configuration=EXCLUDED.configuration,
      updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING configuration`,
      [shopId,productId,JSON.stringify(config),actor]);
    await client.query('COMMIT');
    return result.rows[0].configuration;
  } catch(error) { await client.query('ROLLBACK');throw error; }
  finally {client.release();}
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

/** Only prices may change. Require the previously observed configuration to prevent lost updates. */
export async function updatePackagingPrices(pool: Pool, shopId: string, productId: string, actor: string, role: string, expected: unknown, proposed: unknown) {
  if (!['Super Admin','Store Manager'].includes(role)) throw new Error('Manager authorization required.');
  const before=parsePackagingDraft(expected), after=parsePackagingDraft(proposed);
  const canonical=(config:SharedStockUnits)=>JSON.stringify({baseUnit:config.baseUnit,units:[...config.units].sort((a,b)=>a.id.localeCompare(b.id))});
  const structure=(config:SharedStockUnits)=>canonical({...config,units:config.units.map(u=>({...u,sellingPrice:0}))});
  if(structure(before)!==structure(after))throw new Error('Only selling prices may be changed.');
  if(after.units.some(u=>u.sellingPrice>9999999999.99 || Math.abs(u.sellingPrice*100-Math.round(u.sellingPrice*100))>0.00001))throw new Error('Prices must fit the currency range and have at most two decimal places.');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const result=await client.query('SELECT shared_stock_units,status FROM products WHERE id=$1 AND shop_id=$2 FOR UPDATE',[productId,shopId]);
    const row=result.rows[0];
    if(!row?.shared_stock_units || row.status==='Inactive')throw new Error('Active shared-stock product required.');
    const current=parsePackagingDraft(row.shared_stock_units);
    if(canonical(current)!==canonical(before))throw new Error('Packaging prices changed. Reload before saving.');
    await client.query('UPDATE products SET shared_stock_units=$1::jsonb, selling_price=$2,updated_at=NOW() WHERE id=$3 AND shop_id=$4',[JSON.stringify(after),after.units.find(u=>u.baseUnits===1)!.sellingPrice,productId,shopId]);
    await client.query(`INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details) VALUES($1,$2,NOW(),$3,$4,'Updated Packaging Prices',$5)`,['packaging-price-'+randomUUID(),shopId,actor,role,JSON.stringify({productId,before:current.units.map(u=>({id:u.id,price:u.sellingPrice})),after:after.units.map(u=>({id:u.id,price:u.sellingPrice}))})]);
    await client.query('COMMIT');return after;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Conservative conversion of stocked SKUs with no invoice, PO or quotation history.
 * Existing stock logs are preserved; the unit boundary is recorded in the audit.
 * No conversion of independently stocked variants or historical financial records.
 */
export async function convertLegacyPackaging(pool: Pool, shopId: string, productId: string, actor: string, role: string, request: {confirmed?:unknown;legacyUnitId?:unknown;expected?:unknown;configuration?:unknown}) {
  if(process.env.ARS_SHARED_STOCK_PILOT!=='true')throw Error('Shared-stock conversion is disabled.');
  if(!['Super Admin','Store Manager'].includes(role)||request.confirmed!==true)throw Error('Manager confirmation required.');
  if(typeof request.legacyUnitId!=='string')throw Error('Select the current stock unit.');
  const config=parsePackagingDraft(request.configuration);
  const expected=request.expected as Record<string,unknown>|null;
  if(!expected || typeof expected!=='object')throw Error('Current inventory snapshot required.');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const result=await client.query(`SELECT p.*,
      EXISTS(SELECT 1 FROM sales_transaction_items s WHERE s.product_id=p.id) AS has_sales,
      EXISTS(SELECT 1 FROM purchase_order_items i WHERE i.product_id=p.id) AS has_purchases,
      EXISTS(SELECT 1 FROM quotations q WHERE q.shop_id=p.shop_id AND q.items @> jsonb_build_array(jsonb_build_object('productId',p.id))) AS has_quotes
      FROM products p WHERE p.id=$1 AND p.shop_id=$2 FOR UPDATE OF p`,[productId,shopId]);
    const p=result.rows[0];
    if(!p || p.status==='Inactive'||p.shared_stock_units||p.variants_json?.length)throw Error('Product is not eligible for legacy conversion.');
    if(p.has_sales||p.has_purchases||p.has_quotes)throw Error('Historical transactions require a separate reconciliation workflow.');
    if(Number(p.wholesale_price||0)!==0||Number(p.dealer_price||0)!==0)throw Error('Reconcile existing wholesale and dealer price tiers before conversion.');
    const snapshot={quantity:Number(p.quantity),reorderLevel:Number(p.reorder_level),costPrice:Number(p.cost_price),sellingPrice:Number(p.selling_price)};
    if(Object.entries(snapshot).some(([key,value])=>expected[key]!==value))throw Error('Product stock or prices changed. Reload before conversion.');
    const draft=await client.query('SELECT configuration FROM ars_packaging_drafts WHERE product_id=$1 AND shop_id=$2 FOR UPDATE',[productId,shopId]);
    if(!draft.rowCount||JSON.stringify(parsePackagingDraft(draft.rows[0].configuration))!==JSON.stringify(config))throw Error('Save the current packaging draft before conversion.');
    const preview=previewLegacyPackaging({...snapshot,legacyUnitId:request.legacyUnitId,configuration:config});
    if(!preview.eligible)throw Error(preview.reasons.join(' '));
    const base=config.units.find(u=>u.baseUnits===1)!;
    if(base.sellingPrice>9999999999.99 || Math.abs(base.sellingPrice*100-Math.round(base.sellingPrice*100))>0.00001)throw Error('Base selling price exceeds currency precision.');
    await client.query('UPDATE products SET quantity=$1,reorder_level=$2,cost_price=$3,selling_price=$4,shared_stock_units=$5::jsonb,updated_at=NOW() WHERE id=$6 AND shop_id=$7',[preview.newQuantity,preview.newReorderLevel,preview.newCostPrice,base.sellingPrice,JSON.stringify(config),productId,shopId]);
    await client.query(`INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details) VALUES($1,$2,NOW(),$3,$4,'Converted Legacy Packaging',$5)`,['packaging-convert-'+randomUUID(),shopId,actor,role,JSON.stringify({productId,...preview,configuration:config})]);
    await client.query('COMMIT');
    return preview;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}


/** Only a confirmed, per-invoice mapping can authorize a legacy refund. */
export async function getLegacyReturnFactor(client: PoolClient, shopId: string, productId: string, saleItemId: string | number) {
  const result=await client.query(`SELECT base_units FROM ars_legacy_sale_return_units
    WHERE sale_item_id=$1 AND shop_id=$2 AND product_id=$3`,[saleItemId,shopId,productId]);
  const factor=Number(result.rows[0]?.base_units);
  if(!Number.isSafeInteger(factor)||factor<=0)throw Error('Legacy invoice requires a verified stock migration before refund.');
  return factor;
}
