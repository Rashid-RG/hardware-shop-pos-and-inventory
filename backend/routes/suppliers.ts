import { Router } from 'express';
import { requireAuth, requireRole, getActiveShopContext } from '../middleware';
import { insertSupplier } from '../db';
import { Supplier } from '../../src/types';

const router = Router();

router.use(requireAuth);
router.use(requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']));

router.post('/', async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);
  const newSupplier: Supplier = {
    ...req.body,
    id: 'sup-' + Date.now(),
    shopId: activeShopId,
  };

  try {
    await insertSupplier(newSupplier);
    res.json(newSupplier);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
