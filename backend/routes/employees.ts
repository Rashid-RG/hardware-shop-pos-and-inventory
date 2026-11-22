import { Router } from 'express';
import { requireAuth, requireRole, getActiveShopContext } from '../middleware';
import { insertEmployee, updateEmployee, pool } from '../db';
import { Employee } from '../../src/types';

const router = Router();

router.use(requireAuth);
router.use(requireRole(['Super Admin', 'Store Manager']));

router.post('/', async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);
  const newEmployee: Employee = {
    ...req.body,
    id: 'emp-' + Date.now(),
    shopId: activeShopId,
    salary: Number(req.body.salary) || 2000,
    performanceScore: 85,
  };

  try {
    await insertEmployee(newEmployee);
    res.json(newEmployee);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { activeShopId } = getActiveShopContext(req);

  try {
    const check = await pool.query('SELECT name FROM employees WHERE id = $1 AND shop_id = $2', [id, activeShopId]);
    if (check.rowCount === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const payload = {
      ...req.body,
      salary: Number(req.body.salary),
      performanceScore: Number(req.body.performanceScore) || 85,
    };

    await updateEmployee(id, payload);
    res.json({ id, ...payload });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
