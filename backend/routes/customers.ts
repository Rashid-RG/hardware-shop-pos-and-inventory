import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth, requireRole, getActiveShopContext, AppRequest } from '../middleware';
import { pool, insertCustomer, updateCustomerCreditLimit, addCustomerCreditPayment } from '../db';
import { Customer, CustomerCreditPayment } from '../../src/types';

const router = Router();

router.use(requireAuth);

router.post('/', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);
  const name = String(req.body?.name || '').trim();
  const limit = Number(req.body?.creditLimit ?? 0);
  if (!name || !Number.isFinite(limit) || limit < 0 ||
      Math.abs(limit * 100 - Math.round(limit * 100)) > 0.00001) {
    return res.status(400).json({ error: 'Customer name and a valid credit limit are required.' });
  }
  const customer: Customer = {
    id: 'cust-' + randomUUID(),
    shopId: activeShopId,
    name,
    phone: String(req.body?.phone || '').trim(),
    email: String(req.body?.email || '').trim(),
    address: String(req.body?.address || '').trim(),
    loyaltyBalance: 0,
    purchaseCount: 0,
    creditLimit: (req as AppRequest).authUser?.role === 'Cashier' ? 0 : limit,
    creditBalance: 0,
  };
  try {
    await insertCustomer(customer);
    res.json(customer);
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

router.put('/:id/credit', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  const { creditLimit } = req.body;
  const { activeShopId } = getActiveShopContext(req);
  const customerId = req.params.id;

  try {
    const check = await pool.query('SELECT name FROM customers WHERE id = $1 AND shop_id = $2', [customerId, activeShopId]);
    if (check.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const limit = Number(creditLimit);
    if (!Number.isFinite(limit) || limit < 0 || Math.abs(limit * 100 - Math.round(limit * 100)) > 0.00001) {
      return res.status(400).json({ error: 'Invalid credit limit' });
    }
    await updateCustomerCreditLimit(customerId, activeShopId, limit);

    res.json({ id: customerId, creditLimit: limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/credit-payment', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);
  const authUser = (req as AppRequest).authUser;
  const { amount, paymentMethod, note } = req.body;
  const customerId = req.params.id;

  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 ||
      Math.abs(Number(amount) * 100 - Math.round(Number(amount) * 100)) > 0.00001) {
    return res.status(400).json({ error: 'Amount must be positive with at most two decimal places' });
  }

  try {
    const check = await pool.query('SELECT name, credit_balance FROM customers WHERE id = $1 AND shop_id = $2', [customerId, activeShopId]);
    if (check.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const customer = check.rows[0];

    const payment: CustomerCreditPayment = {
      id: `cpay-${randomUUID()}`,
      shopId: activeShopId,
      customerId,
      customerName: customer.name,
      amount: Number(amount),
      date: new Date().toISOString().split('T')[0],
      paymentMethod: String(paymentMethod || 'Cash'),
      note: note || undefined,
      createdBy: authUser?.name,
    };

    await addCustomerCreditPayment(payment);

    res.json({
      success: true,
      payment,
      newCreditBalance: Math.max(0, Number(customer.credit_balance || 0) - payment.amount),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
