import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { purchaseVariant } from './purchaseVariant';
import { baseQuantity } from '../src/utils/unitConversion';
import type { ProductVariant } from '../src/types';

// Additive schema; does not rewrite legacy business tables.
export const initPartialReceivingTables = async (pool: Pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ars_receipt_batches (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
      request_key TEXT NOT NULL,
      received_by TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(shop_id, purchase_order_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS ars_receipt_batch_items (
      batch_id TEXT NOT NULL REFERENCES ars_receipt_batches(id),
      purchase_order_item_id BIGINT NOT NULL REFERENCES purchase_order_items(id),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      PRIMARY KEY(batch_id, purchase_order_item_id)
    );
    CREATE INDEX IF NOT EXISTS ars_receipt_items_lookup_idx
      ON ars_receipt_batch_items(purchase_order_item_id);
  `);
};

type ReceiptLine = { purchaseOrderItemId: number; quantity: number };

export const receivePartialOrder = async (
  pool: Pool,
  options: { shopId: string; poId: string; requestKey: string; user: string; note?: string; items: ReceiptLine[] }
) => {
  const { shopId, poId, requestKey, user, note = '', items } = options;
  if (!shopId || !poId || !user.trim() || !requestKey || requestKey.length > 120) {
    throw new Error('Shop, order, receiver and unique request key are required.');
  }
  if (!Array.isArray(items) || !items.length || items.length > 200 || note.length > 1000) {
    throw new Error('Enter 1–200 receipt lines and a note under 1000 characters.');
  }
  const seen = new Set<number>();
  for (const line of items) {
    if (!Number.isSafeInteger(line.purchaseOrderItemId) || line.purchaseOrderItemId < 1 ||
        !Number.isSafeInteger(line.quantity) || line.quantity < 1 ||
        seen.has(line.purchaseOrderItemId)) throw new Error('Receipt lines must have unique valid IDs and positive whole quantities.');
    seen.add(line.purchaseOrderItemId);
  }
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const poResult = await client.query(
      'SELECT * FROM purchase_orders WHERE id=$1 AND shop_id=$2 FOR UPDATE',
      [poId, shopId]);
    const po = poResult.rows[0];
    if (!po) throw new Error('Purchase order not found in this shop.');
    const previous = await client.query(
      'SELECT id FROM ars_receipt_batches WHERE shop_id=$1 AND purchase_order_id=$2 AND request_key=$3',
      [shopId, poId, requestKey]);
    if (previous.rowCount) {
      await client.query('COMMIT');
      return { batchId: previous.rows[0].id, repeated: true, status: po.status };
    }
    if (!['Pending', 'Ordered', 'Partially Received'].includes(po.status)) throw new Error('Order is not open for receiving.');
    const ordered = await client.query(
      `SELECT i.id,i.product_id,i.product_name,i.variant_id,i.quantity,i.selling_unit_id,i.base_units_per_purchase_unit,
              COALESCE((SELECT SUM(r.quantity) FROM ars_receipt_batch_items r WHERE r.purchase_order_item_id=i.id),0)::integer AS received
         FROM purchase_order_items i WHERE i.purchase_order_id=$1 ORDER BY i.id`, [poId]);
    if (!ordered.rowCount) throw new Error('Order has no items.');
    const orderedById = new Map(ordered.rows.map(row => [Number(row.id), row]));
    for (const line of items) {
      const row = orderedById.get(line.purchaseOrderItemId);
      if (!row) throw new Error('Receipt line does not belong to this purchase order.');
      if (Number(row.received) + line.quantity > Number(row.quantity)) throw new Error('Received quantity exceeds ordered quantity.');
    }
    const batchId = 'grn-' + randomUUID();
    await client.query(
      `INSERT INTO ars_receipt_batches(id,shop_id,purchase_order_id,request_key,received_by,note)
       VALUES($1,$2,$3,$4,$5,$6)`, [batchId,shopId,poId,requestKey,user.trim(),note]);
    for (const line of items) {
      const row = orderedById.get(line.purchaseOrderItemId);
      const productRes = await client.query(
        'SELECT * FROM products WHERE id=$1 AND shop_id=$2 FOR UPDATE',
        [row.product_id,shopId]);
      if (!productRes.rowCount) throw new Error('Ordered product unavailable in this shop.');
      const product = productRes.rows[0];
      const variants: ProductVariant[] = product.variants_json || [];
      let stockIn = line.quantity;
      if (product.shared_stock_units || row.selling_unit_id || row.base_units_per_purchase_unit != null) {
        if (!product.shared_stock_units || !row.selling_unit_id || !row.base_units_per_purchase_unit || variants.length || row.variant_id) throw new Error('Incompatible purchasing unit snapshot.');
        stockIn = baseQuantity(line.quantity,Number(row.base_units_per_purchase_unit));
      }
      const variant = purchaseVariant(variants,row.variant_id,product.name,true);
      if (variant) {
        variant.quantity = Number(variant.quantity || 0) + line.quantity;
        const total = variants.reduce((sum,v) => sum + Number(v.quantity || 0),0);
        await client.query(
          'UPDATE products SET quantity=$1,variants_json=$2::jsonb,updated_at=NOW() WHERE id=$3 AND shop_id=$4',
          [total,JSON.stringify(variants),product.id,shopId]);
      } else {
        await client.query(
          'UPDATE products SET quantity=quantity+$1,updated_at=NOW() WHERE id=$2 AND shop_id=$3',
          [stockIn,product.id,shopId]);
      }
      await client.query(
        'INSERT INTO ars_receipt_batch_items(batch_id,purchase_order_item_id,quantity) VALUES($1,$2,$3)',
        [batchId,line.purchaseOrderItemId,line.quantity]);
      await client.query(
        `INSERT INTO stock_logs(id,shop_id,date,product_id,product_name,type,quantity,reason,user_name,reference_id)
         VALUES($1,$2,NOW(),$3,$4,'Stock In',$5,'ARS Partial Goods Receipt',$6,$7)`,
        ['stock-'+batchId+'-'+line.purchaseOrderItemId,shopId,row.product_id,row.product_name,stockIn,user,batchId]);
      row.received = Number(row.received) + line.quantity;
    }
    const fullyReceived = ordered.rows.every(row => Number(row.received) === Number(row.quantity));
    const status = fullyReceived ? 'Received' : 'Partially Received';
    await client.query('UPDATE purchase_orders SET status=$1 WHERE id=$2 AND shop_id=$3',[status,poId,shopId]);
    await client.query(
      `INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details)
       VALUES($1,$2,NOW(),$3,'Inventory Staff','Goods Received',$4)`,
       ['activity-'+batchId,shopId,user,`Goods receipt ${batchId} for ${po.po_number}`]);
    await client.query('COMMIT');
    return { batchId, repeated: false, status };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
};
