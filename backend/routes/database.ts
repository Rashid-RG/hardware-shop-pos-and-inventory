import { Router } from 'express';
import { requireAuth, requireRole, getActiveShopContext } from '../middleware';
import { pool, loadStateFromNormalized, seedDatabase } from '../db';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);
  try {
    const state = await loadStateFromNormalized();
    if (!state) {
      return res.json({
        users: [],
        products: [],
        suppliers: [],
        customers: [],
        employees: [],
        transactions: [],
        purchaseOrders: [],
        stockLogs: [],
        activityLogs: [],
        settings: {
          taxRate: 18,
          storeName: 'Lanka Smart Hardware',
          currency: 'LKR',
          invoicePrefix: 'SL-INV',
          logoUrl: '',
          address: '',
          phone: '',
          shopQRData: '',
          activeShopId,
          productCategories: [],
          shopProfiles: [],
        },
        manualExpenses: [],
        supplierPayments: [],
        quotations: [],
        cashShifts: [],
        customerCreditPayments: [],
        invoicePrintLogs: [],
      });
    }

    const byActiveShop = <T extends { shopId?: string }>(items: T[]) =>
      items.filter((item) => item.shopId === activeShopId);

    res.json({
      users: state.users,
      products: byActiveShop(state.products),
      suppliers: byActiveShop(state.suppliers),
      customers: byActiveShop(state.customers),
      employees: byActiveShop(state.employees),
      transactions: byActiveShop(state.transactions),
      purchaseOrders: byActiveShop(state.purchaseOrders),
      stockLogs: byActiveShop(state.stockLogs),
      activityLogs: byActiveShop(state.activityLogs),
      settings: {
        ...state.settings,
        activeShopId,
      },
      manualExpenses: state.manualExpenses,
      supplierPayments: state.supplierPayments.filter((sp) => sp.shopId === activeShopId),
      quotations: state.quotations.filter((q) => q.shopId === activeShopId),
      cashShifts: state.cashShifts.filter((s) => s.shopId === activeShopId),
      customerCreditPayments: state.customerCreditPayments.filter((p) => p.shopId === activeShopId),
      invoicePrintLogs: state.invoicePrintLogs.filter((log) => log.shopId === activeShopId),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset', requireRole(['Super Admin']), async (req, res) => {
  try {
    // Basic defaults seed state
    const defaultState = {
      users: [],
      products: [],
      suppliers: [],
      customers: [],
      employees: [],
      settings: {
        taxRate: 18,
        storeName: 'Lanka Smart Hardware',
        currency: 'LKR',
        invoicePrefix: 'SL-INV',
        logoUrl: '',
        address: '',
        phone: '',
        activeShopId: 'shop-main',
        productCategories: [],
        shopProfiles: [
          {
            id: 'shop-main',
            name: 'Lanka Smart Hardware',
            logoUrl: '',
            address: '150 Galle Road, Colombo 03, Sri Lanka',
            phone: '+94 11 234 5678',
            taxRate: 18,
            invoicePrefix: 'SL-INV',
          },
        ],
      },
    };
    await seedDatabase(defaultState);
    const state = await loadStateFromNormalized();
    res.json({ success: true, message: 'Database reset and seeded', data: state });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
