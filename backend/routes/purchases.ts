import { Router } from 'express';
import { requireAuth, requireRole, getActiveShopContext, AppRequest } from '../middleware';
import { pool, createPurchaseOrder, receivePurchaseOrder } from '../db';
import { PurchaseOrder } from '../../src/types';

const router = Router();

router.use(requireAuth);
router.use(requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']));

router.post('/', async (req, res) => {
  const { supplierId, supplierName, items, orderUser } = req.body;
  const { activeShopId } = getActiveShopContext(req);

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Purchase items list cannot be empty' });
  }

  let totalWeightCost = 0;
  const parts = items.map((itm: any) => {
    totalWeightCost += itm.costPrice * itm.quantity;
    return {
      productId: itm.productId,
      productName: itm.productName,
      quantity: Number(itm.quantity),
      costPrice: Number(itm.costPrice),
    };
  });

  const newPO: PurchaseOrder = {
    id: 'po-' + Date.now(),
    shopId: activeShopId,
    poNumber: 'PO-2026-' + Math.floor(1000 + Math.random() * 9000),
    date: new Date().toISOString(),
    supplierId: supplierId,
    supplierName: supplierName,
    items: parts,
    total: Math.round(totalWeightCost * 100) / 100,
    status: 'Pending',
  };

  try {
    await createPurchaseOrder(newPO);

    // Log Activity
    const actId = 'act-' + Date.now();
    await pool.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1, $2, NOW(), $3, 'Inventory Staff', 'Created PO', $4)`,
      [actId, activeShopId, orderUser || 'Inventory Officer', `Drafted request ${newPO.poNumber} with supplier ${newPO.supplierName} for shop ${activeShopId} (Rs.${newPO.total.toFixed(2)}).`]
    );

    res.json(newPO);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/status', async (req, res) => {
  const { status, receiveUser } = req.body;
  const { activeShopId } = getActiveShopContext(req);
  const poId = req.params.id;

  try {
    const poRes = await pool.query('SELECT status, po_number, supplier_name FROM purchase_orders WHERE id = $1 AND shop_id = $2', [poId, activeShopId]);
    if (poRes.rowCount === 0) {
      return res.status(404).json({ error: 'Purchase Order not found' });
    }
    const po = poRes.rows[0];
    const oldStatus = po.status;

    if (status === 'Received' && oldStatus !== 'Received') {
      await receivePurchaseOrder(poId, activeShopId, receiveUser || 'Inventory Officer');

      const actId = 'act-' + Date.now();
      await pool.query(
        `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
         VALUES ($1, $2, NOW(), $3, 'Inventory Staff', 'Received Materials', $4)`,
        [actId, activeShopId, receiveUser || 'Inventory Officer', `Confirmed delivery receipt for ${po.po_number} and restocked products.`]
      );
    } else {
      await pool.query('UPDATE purchase_orders SET status = $1 WHERE id = $2', [status, poId]);

      const actId = 'act-' + Date.now();
      await pool.query(
        `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
         VALUES ($1, $2, NOW(), $3, 'Inventory Staff', 'PO Status Updated', $4)`,
        [actId, activeShopId, receiveUser || 'Inventory Officer', `Transitioned purchase order ${po.po_number} state to ${status}.`]
      );
    }

    res.json({ id: poId, status });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
