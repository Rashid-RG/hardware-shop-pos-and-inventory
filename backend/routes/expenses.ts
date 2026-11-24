import { reportDay } from '../../src/utils/reporting';
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware';
import { pool } from '../db';
import { ManualExpense } from '../../src/types';

const router = Router();

router.use(requireAuth);

router.get('/', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM manual_expenses ORDER BY date DESC');
    const expenses: ManualExpense[] = result.rows.map((row) => ({
      id: row.id,
      desc: row.description,
      amount: Number(row.amount),
      date: row.date,
      category: row.category,
    }));
    res.json(expenses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  const { desc, amount, category } = req.body || {};
  if (!desc || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Description and positive amount are required' });
  }

  const expense = {
    id: `exp-${Date.now()}`,
    description: String(desc),
    amount: Number(amount),
    category: String(category || 'Other'),
    date: reportDay(new Date()),
  };

  try {
    await pool.query(
      `INSERT INTO manual_expenses (id, description, amount, date, category)
       VALUES ($1, $2, $3, $4, $5)`,
      [expense.id, expense.description, expense.amount, expense.date, expense.category]
    );

    res.json({
      id: expense.id,
      desc: expense.description,
      amount: expense.amount,
      date: expense.date,
      category: expense.category,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
