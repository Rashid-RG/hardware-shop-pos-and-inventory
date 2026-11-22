import { Pool, PoolClient } from 'pg';
import { purchaseVariant } from './purchaseVariant';
import bcrypt from 'bcryptjs';
import { DATABASE_URL, DB_STATE_KEY } from './config';
import {
  Product,
  ProductVariant,
  Supplier,
  Customer,
  Employee,
  SalesTransaction,
  PurchaseOrder,
  StockLog,
  ActivityLog,
  Role,
  StoreSettings,
  ManualExpense,
  AuthUser,
  UserAccount,
  SupplierPayment,
  Quotation,
  CashShift,
  CustomerCreditPayment,
  InvoicePrintLog,
  InvoiceCopyType,
} from '../src/types';

export const pool = new Pool({ connectionString: DATABASE_URL });

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

// Helper functions for user mapping
export const parseAllowedShops = (value?: string): string[] | undefined => {
  if (!value) return undefined;
  const shops = value.split(',').map((item) => item.trim()).filter(Boolean);
  return shops.length > 0 ? Array.from(new Set(shops)) : undefined;
};

export const parseFixedShopAssignments = (value?: string): Record<string, string> => {
  if (!value) return {};
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const sep = entry.indexOf('=');
      if (sep <= 0) return acc;
      const email = entry.slice(0, sep).trim().toLowerCase();
      const shopId = entry.slice(sep + 1).trim();
      if (email && shopId) acc[email] = shopId;
      return acc;
    }, {});
};

export const FIXED_SHOP_BY_EMAIL = parseFixedShopAssignments(process.env.USER_FIXED_SHOPS);
export const getUserFixedShop = (email: string): string | undefined => {
  return FIXED_SHOP_BY_EMAIL[email.trim().toLowerCase()];
};

export const ROLE_ALLOWED_SHOPS: Partial<Record<Role, string[]>> = {
  'Super Admin': parseAllowedShops(process.env.SUPER_ADMIN_ALLOWED_SHOPS),
  'Store Manager': parseAllowedShops(process.env.MANAGER_ALLOWED_SHOPS),
  'Cashier': parseAllowedShops(process.env.CASHIER_ALLOWED_SHOPS),
  'Inventory Staff': parseAllowedShops(process.env.INVENTORY_ALLOWED_SHOPS),
};

export const getUserAllowedShops = (user: { role: Role }): string[] | undefined => {
  const byRole = ROLE_ALLOWED_SHOPS[user.role];
  return Array.isArray(byRole) && byRole.length > 0 ? byRole : undefined;
};

export const getUserRecordId = (email: string) => `usr-${email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export const toAuthRecordFromUser = (user: UserAccount) => ({
  email: user.email,
  name: user.name,
  role: user.role,
  passwordHash: user.passwordHash,
  allowedShopIds: getUserAllowedShops(user),
  fixedShopId: getUserFixedShop(user.email),
});

export const resolveUserShopAccess = (user: ReturnType<typeof toAuthRecordFromUser>, requestedShopIdRaw?: string, shopProfiles: any[] = []) => {
  const requestedShopId = String(requestedShopIdRaw || '').trim();
  const availableShopIds = shopProfiles.map((shop) => shop.id);
  const fixedShopId = user.fixedShopId;

  if (fixedShopId && !availableShopIds.includes(fixedShopId)) {
    return { error: 'Assigned fixed shop is not available in system settings', status: 400 as const };
  }

  const roleAllowedShopIds = getUserAllowedShops(user)?.filter((id) => availableShopIds.includes(id));
  let allowedShopIds = roleAllowedShopIds && roleAllowedShopIds.length > 0 ? roleAllowedShopIds : undefined;
  if (fixedShopId) {
    if (allowedShopIds && !allowedShopIds.includes(fixedShopId)) {
      return { error: 'Role shop policy conflicts with fixed shop assignment', status: 403 as const };
    }
    allowedShopIds = [fixedShopId];
  }

  if (requestedShopId.length > 0 && !availableShopIds.includes(requestedShopId)) {
    return { error: 'Invalid shop selected at login', status: 400 as const };
  }
  if (fixedShopId && requestedShopId && requestedShopId !== fixedShopId) {
    return { error: 'This account is fixed to another shop', status: 403 as const };
  }
  if (allowedShopIds && requestedShopId && !allowedShopIds.includes(requestedShopId)) {
    return { error: 'Your role is not allowed for the selected shop', status: 403 as const };
  }

  const scopedShopId = fixedShopId || (requestedShopId.length > 0
    ? requestedShopId
    : (allowedShopIds && allowedShopIds.length === 1 ? allowedShopIds[0] : undefined));

  return {
    scopedShopId,
    allowedShopIds,
    fixedShopId,
  };
};

export const initDbTables = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create normalized tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        name TEXT NOT NULL,
        sku TEXT NOT NULL,
        barcode TEXT,
        internal_code TEXT,
        image_url TEXT,
        brand TEXT NOT NULL,
        category TEXT NOT NULL,
        cost_price NUMERIC(12,2) NOT NULL,
        selling_price NUMERIC(12,2) NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        reorder_level INTEGER NOT NULL DEFAULT 0,
        warranty TEXT NOT NULL,
        description TEXT NOT NULL,
        location TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        name TEXT NOT NULL,
        company_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        address TEXT,
        tax_number TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        loyalty_balance INTEGER NOT NULL DEFAULT 0,
        purchase_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        salary NUMERIC(12,2) NOT NULL,
        attendance_status TEXT NOT NULL,
        performance_score INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sales_transactions (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        invoice_number TEXT UNIQUE NOT NULL,
        date TIMESTAMPTZ NOT NULL,
        customer_id TEXT,
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        customer_address TEXT,
        cashier_name TEXT NOT NULL,
        subtotal NUMERIC(12,2) NOT NULL,
        tax NUMERIC(12,2) NOT NULL,
        discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        total NUMERIC(12,2) NOT NULL,
        cash_received NUMERIC(12,2),
        change_due NUMERIC(12,2),
        payment_method TEXT NOT NULL,
        payment_status TEXT,
        wholesale_meta JSONB,
        status TEXT NOT NULL DEFAULT 'Completed',
        refunded_at TIMESTAMPTZ,
        refund_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      );

      CREATE TABLE IF NOT EXISTS sales_transaction_items (
        id BIGSERIAL PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        selling_price NUMERIC(12,2) NOT NULL,
        discount NUMERIC(5,2) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        cost_price NUMERIC(12,2) NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        po_number TEXT UNIQUE NOT NULL,
        date TIMESTAMPTZ NOT NULL,
        supplier_id TEXT NOT NULL REFERENCES suppliers(id),
        supplier_name TEXT NOT NULL,
        total NUMERIC(12,2) NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id BIGSERIAL PRIMARY KEY,
        purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        cost_price NUMERIC(12,2) NOT NULL
      );

      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS variant_id TEXT;

      CREATE TABLE IF NOT EXISTS stock_logs (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        date TIMESTAMPTZ NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        reason TEXT NOT NULL,
        user_name TEXT NOT NULL,
        reference_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        date TIMESTAMPTZ NOT NULL,
        user_name TEXT NOT NULL,
        role TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS store_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        tax_rate NUMERIC(5,2) NOT NULL,
        store_name TEXT NOT NULL,
        currency TEXT NOT NULL,
        invoice_prefix TEXT NOT NULL,
        logo_url TEXT,
        store_address TEXT,
        store_phone TEXT,
        active_shop_id TEXT,
        product_categories JSONB,
        shop_profiles JSONB,
        shop_qr_data TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS manual_expenses (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        date DATE NOT NULL,
        category TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Column extensions/alterations
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS shop_id TEXT;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS shop_id TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS shop_id TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS shop_id TEXT;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS shop_id TEXT;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shop_id TEXT;
      ALTER TABLE stock_logs ADD COLUMN IF NOT EXISTS shop_id TEXT;
      ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS shop_id TEXT;
      ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS logo_url TEXT;
      ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS store_address TEXT;
      ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS store_phone TEXT;
      ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS active_shop_id TEXT;
      ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS product_categories JSONB;
      ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS shop_profiles JSONB;
      ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS shop_qr_data TEXT;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS cash_received NUMERIC(12,2);
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS change_due NUMERIC(12,2);
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS customer_phone TEXT;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS customer_address TEXT;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS payment_status TEXT;
      ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS wholesale_meta JSONB;
      ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
      ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0;
      ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS variant_id TEXT;
      ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS variant_name TEXT;
      ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS variant_unit TEXT;
      ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS variant_sku TEXT;
      ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS variant_barcode TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(12,2) NOT NULL DEFAULT 0;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS internal_code TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS qr_code TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS images_json JSONB;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS long_description TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS dealer_price NUMERIC(12,2) NOT NULL DEFAULT 0;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS variants_json JSONB;
    `);

    // Additional tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_payments (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        supplier_id TEXT NOT NULL,
        supplier_name TEXT NOT NULL,
        purchase_order_id TEXT,
        amount NUMERIC(12,2) NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'Bank Transfer',
        date DATE NOT NULL,
        note TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS quotations (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        quote_number TEXT UNIQUE NOT NULL,
        date TIMESTAMPTZ NOT NULL,
        valid_until DATE,
        customer_id TEXT,
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        items JSONB NOT NULL DEFAULT '[]',
        subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
        tax NUMERIC(12,2) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'Draft',
        notes TEXT,
        created_by TEXT,
        converted_to_tx_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cash_shifts (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        cashier_name TEXT NOT NULL,
        opened_at TIMESTAMPTZ NOT NULL,
        closed_at TIMESTAMPTZ,
        opening_float NUMERIC(12,2) NOT NULL DEFAULT 0,
        closing_cash NUMERIC(12,2),
        expected_cash NUMERIC(12,2),
        cash_difference NUMERIC(12,2),
        status TEXT NOT NULL DEFAULT 'Open',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS customer_credit_payments (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        customer_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        date DATE NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'Cash',
        note TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS invoice_print_logs (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        transaction_id TEXT NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
        invoice_number TEXT NOT NULL,
        copy_type TEXT NOT NULL,
        print_sequence INTEGER NOT NULL,
        printed_by TEXT NOT NULL,
        printed_at TIMESTAMPTZ NOT NULL,
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS app_state (
        id TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      UPDATE products SET shop_id = 'shop-main' WHERE shop_id IS NULL OR shop_id = '';
      ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
      DROP INDEX IF EXISTS products_sku_key;
      CREATE UNIQUE INDEX IF NOT EXISTS products_shop_id_sku_key ON products (shop_id, sku);
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database migration error:', error);
    throw error;
  } finally {
    client.release();
  }
};

export const loadStateFromNormalized = async (): Promise<any> => {
  const [
    usersRes,
    productsRes,
    suppliersRes,
    customersRes,
    employeesRes,
    txRes,
    txItemsRes,
    poRes,
    poItemsRes,
    stockLogsRes,
    activityLogsRes,
    settingsRes,
    expensesRes,
    supplierPaymentsRes,
    quotationsRes,
    cashShiftsRes,
    creditPaymentsRes,
    printLogsRes,
  ] = await Promise.all([
    pool.query('SELECT * FROM users ORDER BY email'),
    pool.query('SELECT * FROM products ORDER BY id'),
    pool.query('SELECT * FROM suppliers ORDER BY id'),
    pool.query('SELECT * FROM customers ORDER BY id'),
    pool.query('SELECT * FROM employees ORDER BY id'),
    pool.query('SELECT * FROM sales_transactions ORDER BY date DESC'),
    pool.query('SELECT * FROM sales_transaction_items ORDER BY id DESC'),
    pool.query('SELECT * FROM purchase_orders ORDER BY date DESC'),
    pool.query('SELECT * FROM purchase_order_items ORDER BY id DESC'),
    pool.query('SELECT * FROM stock_logs ORDER BY date DESC'),
    pool.query('SELECT * FROM activity_logs ORDER BY date DESC'),
    pool.query(`SELECT * FROM store_settings WHERE id = 'default' LIMIT 1`),
    pool.query('SELECT * FROM manual_expenses ORDER BY date DESC'),
    pool.query('SELECT * FROM supplier_payments ORDER BY date DESC'),
    pool.query('SELECT * FROM quotations ORDER BY date DESC'),
    pool.query('SELECT * FROM cash_shifts ORDER BY opened_at DESC'),
    pool.query('SELECT * FROM customer_credit_payments ORDER BY date DESC'),
    pool.query('SELECT * FROM invoice_print_logs ORDER BY printed_at DESC'),
  ]);

  const hasAnyDomainData =
    usersRes.rowCount ||
    productsRes.rowCount ||
    suppliersRes.rowCount ||
    customersRes.rowCount ||
    employeesRes.rowCount ||
    txRes.rowCount ||
    poRes.rowCount;

  if (!hasAnyDomainData) {
    return null;
  }

  const txItemsByTransaction = new Map<string, any[]>();
  for (const row of txItemsRes.rows) {
    const group = txItemsByTransaction.get(row.transaction_id) || [];
    group.push(row);
    txItemsByTransaction.set(row.transaction_id, group);
  }

  const poItemsByOrder = new Map<string, any[]>();
  for (const row of poItemsRes.rows) {
    const group = poItemsByOrder.get(row.purchase_order_id) || [];
    group.push(row);
    poItemsByOrder.set(row.purchase_order_id, group);
  }

  const settingsRow = settingsRes.rows[0] || {
    tax_rate: 18,
    store_name: 'Lanka Smart Hardware',
    currency: 'LKR',
    invoice_prefix: 'SL-INV',
    logo_url: '',
    store_address: '150 Galle Road, Colombo 03, Sri Lanka',
    store_phone: '+94 11 234 5678',
    shop_qr_data: '',
    active_shop_id: 'shop-main',
    shop_profiles: [
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
  };

  return {
    users: usersRes.rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as Role,
      passwordHash: row.password_hash,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : undefined,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : undefined,
    })),
    products: productsRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      qrCode: row.qr_code || undefined,
      internalCode: row.internal_code || undefined,
      imageUrl: row.image_url || undefined,
      images: Array.isArray(row.images_json) ? row.images_json : undefined,
      brand: row.brand,
      category: row.category,
      costPrice: Number(row.cost_price),
      sellingPrice: Number(row.selling_price),
      wholesalePrice: Number(row.wholesale_price || 0),
      dealerPrice: Number(row.dealer_price || 0),
      quantity: Number(row.quantity),
      reorderLevel: Number(row.reorder_level),
      longDescription: row.long_description || undefined,
      status: (row.status === 'Inactive' ? 'Inactive' : 'Active') as 'Active' | 'Inactive',
      warranty: row.warranty,
      description: row.description,
      location: row.location || undefined,
      variants: Array.isArray(row.variants_json) ? row.variants_json as ProductVariant[] : undefined,
    })),
    suppliers: suppliersRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      name: row.name,
      companyName: row.company_name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      taxNumber: row.tax_number,
    })),
    customers: customersRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      loyaltyBalance: Number(row.loyalty_balance),
      purchaseCount: Number(row.purchase_count),
      creditLimit: Number(row.credit_limit || 0),
      creditBalance: Number(row.credit_balance || 0),
    })),
    employees: employeesRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      name: row.name,
      role: row.role,
      phone: row.phone,
      email: row.email,
      salary: Number(row.salary),
      attendanceStatus: row.attendance_status,
      performanceScore: Number(row.performance_score),
    })),
    transactions: txRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      invoiceNumber: row.invoice_number,
      date: row.date,
      customerName: row.customer_name,
      customerPhone: row.customer_phone || undefined,
      customerAddress: row.customer_address || undefined,
      customerId: row.customer_id || undefined,
      cashierName: row.cashier_name,
      items: (txItemsByTransaction.get(row.id) || []).map((item) => ({
        productId: item.product_id,
        productName: item.product_name,
        quantity: Number(item.quantity),
        sellingPrice: Number(item.selling_price),
        costPrice: Number(item.cost_price || 0),
        discount: Number(item.discount),
        discountAmount: Number(item.discount_amount || 0),
      })),
      subtotal: Number(row.subtotal),
      tax: Number(row.tax),
      discountAmount: Number(row.discount_amount),
      total: Number(row.total),
      cashReceived: row.cash_received != null ? Number(row.cash_received) : undefined,
      changeDue: row.change_due != null ? Number(row.change_due) : undefined,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status || undefined,
      wholesaleMeta: row.wholesale_meta || undefined,
      status: row.status,
      refundedAt: row.refunded_at || undefined,
      refundReason: row.refund_reason || undefined,
    })),
    purchaseOrders: poRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      poNumber: row.po_number,
      date: row.date,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      items: (poItemsByOrder.get(row.id) || []).map((item) => ({
        variantId: item.variant_id || undefined,
        productId: item.product_id,
        productName: item.product_name,
        quantity: Number(item.quantity),
        costPrice: Number(item.cost_price),
      })),
      total: Number(row.total),
      status: row.status,
    })),
    stockLogs: stockLogsRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      date: row.date,
      productId: row.product_id,
      productName: row.product_name,
      type: row.type,
      quantity: Number(row.quantity),
      reason: row.reason,
      user: row.user_name,
      referenceId: row.reference_id || undefined,
    })),
    activityLogs: activityLogsRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      date: row.date,
      user: row.user_name,
      role: row.role,
      action: row.action,
      details: row.details,
    })),
    settings: {
      taxRate: Number(settingsRow.tax_rate),
      storeName: settingsRow.store_name,
      currency: settingsRow.currency,
      invoicePrefix: settingsRow.invoice_prefix,
      logoUrl: settingsRow.logo_url || '',
      address: settingsRow.store_address || '',
      phone: settingsRow.store_phone || '',
      activeShopId: settingsRow.active_shop_id || undefined,
      productCategories: Array.isArray(settingsRow.product_categories) ? settingsRow.product_categories : [],
      shopProfiles: Array.isArray(settingsRow.shop_profiles) ? settingsRow.shop_profiles : [],
      shopQRData: settingsRow.shop_qr_data || undefined,
    },
    manualExpenses: expensesRes.rows.map((row) => ({
      id: row.id,
      desc: row.description,
      amount: Number(row.amount),
      date: row.date,
      category: row.category,
    })),
    supplierPayments: supplierPaymentsRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      purchaseOrderId: row.purchase_order_id || undefined,
      amount: Number(row.amount),
      paymentMethod: row.payment_method,
      date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date).split('T')[0],
      note: row.note || undefined,
      createdBy: row.created_by || undefined,
    })),
    quotations: quotationsRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      quoteNumber: row.quote_number,
      date: row.date,
      validUntil: row.valid_until ? String(row.valid_until).split('T')[0] : undefined,
      customerId: row.customer_id || undefined,
      customerName: row.customer_name,
      customerPhone: row.customer_phone || undefined,
      items: Array.isArray(row.items) ? row.items : [],
      subtotal: Number(row.subtotal),
      tax: Number(row.tax),
      discountAmount: Number(row.discount_amount),
      total: Number(row.total),
      status: row.status,
      notes: row.notes || undefined,
      createdBy: row.created_by || undefined,
      convertedToTxId: row.converted_to_tx_id || undefined,
    })),
    cashShifts: cashShiftsRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      cashierName: row.cashier_name,
      openedAt: row.opened_at,
      closedAt: row.closed_at || undefined,
      openingFloat: Number(row.opening_float),
      closingCash: row.closing_cash != null ? Number(row.closing_cash) : undefined,
      expectedCash: row.expected_cash != null ? Number(row.expected_cash) : undefined,
      cashDifference: row.cash_difference != null ? Number(row.cash_difference) : undefined,
      status: row.status,
      notes: row.notes || undefined,
    })),
    customerCreditPayments: creditPaymentsRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      customerId: row.customer_id,
      customerName: row.customer_name,
      amount: Number(row.amount),
      date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date).split('T')[0],
      paymentMethod: row.payment_method,
      note: row.note || undefined,
      createdBy: row.created_by || undefined,
    })),
    invoicePrintLogs: printLogsRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      transactionId: row.transaction_id,
      invoiceNumber: row.invoice_number,
      copyType: row.copy_type as InvoiceCopyType,
      printSequence: Number(row.print_sequence || 0),
      printedBy: row.printed_by,
      printedAt: row.printed_at instanceof Date ? row.printed_at.toISOString() : String(row.printed_at),
      reason: row.reason || undefined,
    })),
  };
};

export const saveAppStateMirror = async (client: PoolClient, state: any) => {
  await client.query(
    `
    INSERT INTO app_state (id, state, updated_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (id)
    DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
    `,
    [DB_STATE_KEY, JSON.stringify(state)]
  );
};

// Seeding DB helper
export const seedDatabase = async (initialState: any) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users
    for (const u of initialState.users) {
      await client.query(
        `INSERT INTO users (id, email, name, role, password_hash)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING`,
        [u.id, u.email, u.name, u.role, u.passwordHash]
      );
    }

    // Products
    for (const p of initialState.products) {
      await client.query(
        `INSERT INTO products (id, shop_id, name, sku, barcode, qr_code, internal_code, image_url, images_json, brand, category, cost_price, selling_price, quantity, reorder_level, warranty, description, location, status, variants_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) ON CONFLICT (id) DO NOTHING`,
        [
          p.id,
          p.shopId || 'shop-main',
          p.name,
          p.sku,
          p.barcode,
          p.qrCode || null,
          p.internalCode || null,
          p.imageUrl || null,
          JSON.stringify(p.images || []),
          p.brand,
          p.category,
          p.costPrice,
          p.sellingPrice,
          p.quantity,
          p.reorderLevel,
          p.warranty,
          p.description,
          p.location || null,
          p.status || 'Active',
          JSON.stringify(p.variants || []),
        ]
      );
    }

    // Suppliers
    for (const s of initialState.suppliers) {
      await client.query(
        `INSERT INTO suppliers (id, shop_id, name, company_name, phone, email, address, tax_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.shopId || 'shop-main', s.name, s.companyName, s.phone, s.email || null, s.address || null, s.taxNumber || null]
      );
    }

    // Customers
    for (const c of initialState.customers) {
      await client.query(
        `INSERT INTO customers (id, shop_id, name, phone, email, address, loyalty_balance, purchase_count, credit_limit, credit_balance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
        [c.id, c.shopId || 'shop-main', c.name, c.phone || null, c.email || null, c.address || null, c.loyaltyBalance, c.purchaseCount, c.creditLimit || 0, c.creditBalance || 0]
      );
    }

    // Employees
    for (const e of initialState.employees) {
      await client.query(
        `INSERT INTO employees (id, shop_id, name, role, phone, email, salary, attendance_status, performance_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
        [e.id, e.shopId || 'shop-main', e.name, e.role, e.phone || null, e.email || null, e.salary, e.attendanceStatus, e.performanceScore]
      );
    }

    // Settings
    const set = initialState.settings;
    await client.query(
      `INSERT INTO store_settings (id, tax_rate, store_name, currency, invoice_prefix, logo_url, store_address, store_phone, active_shop_id, product_categories, shop_profiles, shop_qr_data)
       VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING`,
      [
        set.taxRate,
        set.storeName,
        set.currency,
        set.invoicePrefix,
        set.logoUrl || null,
        set.address || null,
        set.phone || null,
        set.activeShopId || 'shop-main',
        JSON.stringify(set.productCategories || []),
        JSON.stringify(set.shopProfiles || []),
        set.shopQRData || null,
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to seed database:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Incremental Write Helpers
/** Archive instead of deleting product rows referenced by invoices and stock history. */
export const archiveProduct = async (
  productId: string, shopId: string, archivedBy: string, actorRole: string
) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT id, name, status FROM products WHERE id = $1 AND shop_id = $2 FOR UPDATE',
      [productId, shopId]
    );
    if (!result.rowCount) throw new Error('Product not found in this shop.');
    if (result.rows[0].status === 'Inactive') {
      throw new Error('Product is already archived.');
    }
    await client.query(
      "UPDATE products SET status = 'Inactive', updated_at = NOW() WHERE id = $1 AND shop_id = $2",
      [productId, shopId]
    );
    await client.query(
      `INSERT INTO activity_logs (id,shop_id,date,user_name,role,action,details)
       VALUES ($1,$2,NOW(),$3,$4,'Archived Product',$5)`,
      ['archive-' + productId + '-' + Date.now(), shopId, archivedBy, actorRole,
       `Archived ${result.rows[0].name}; historical invoices and stock remain unchanged.`]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/** Atomically edit a single SKU, its stock ledger and its audit record. */
export const updateProductWithAudit = async (
  product: Product, expectedQuantity: number, actor: string, role: string,
  shopName: string, reason: string
) => {
  if (!product.shopId || !Number.isSafeInteger(product.quantity) || product.quantity < 0) {
    throw new Error('Invalid shop or product stock quantity.');
  }
  const variants = product.variants || [];
  if (variants.some((v) => !Number.isSafeInteger(v.quantity) || v.quantity < 0)) {
    throw new Error('Variant stock must be a nonnegative whole number.');
  }
  if (variants.length && variants.reduce((sum, v) => sum + v.quantity, 0) !== product.quantity) {
    throw new Error('Product stock must equal the total of its variants.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT quantity, variants_json FROM products WHERE id = $1 AND shop_id = $2 FOR UPDATE',
      [product.id, product.shopId]
    );
    if (!locked.rowCount) throw new Error('Product not found in this shop.');
    const previousQty = Number(locked.rows[0].quantity);
    if (previousQty !== expectedQuantity) {
      throw new Error('Product stock changed since it was opened. Reload before editing.');
    }
    const oldVariants: ProductVariant[] = Array.isArray(locked.rows[0].variants_json)
      ? locked.rows[0].variants_json : [];
    if (oldVariants.length && !variants.length) {
      throw new Error('Cannot erase variants from an existing product. Use a dedicated migration.');
    }
    if (oldVariants.length && (
      oldVariants.length !== variants.length ||
      oldVariants.some((old) => !variants.some((current) => current.id === old.id))
    )) {
      throw new Error('Cannot remove or replace existing variant IDs during product editing.');
    }

    await client.query(
      `UPDATE products SET
       name=$1,sku=$2,barcode=$3,qr_code=$4,internal_code=$5,image_url=$6,
       images_json=$7::jsonb,brand=$8,category=$9,cost_price=$10,selling_price=$11,
       wholesale_price=$12,dealer_price=$13,quantity=$14,reorder_level=$15,
       warranty=$16,description=$17,long_description=$18,location=$19,status=$20,
       variants_json=$21::jsonb,updated_at=NOW()
       WHERE id=$22 AND shop_id=$23`,
      [product.name, product.sku, product.barcode || null, product.qrCode || null,
       product.internalCode || null, product.imageUrl || null, JSON.stringify(product.images || []),
       product.brand, product.category, product.costPrice, product.sellingPrice,
       product.wholesalePrice || 0, product.dealerPrice || 0, product.quantity,
       product.reorderLevel, product.warranty, product.description, product.longDescription || null,
       product.location || null, product.status || 'Active', JSON.stringify(variants),
       product.id, product.shopId]
    );
    const delta = product.quantity - previousQty;
    if (delta !== 0) {
      await client.query(
        `INSERT INTO stock_logs
         (id,shop_id,date,product_id,product_name,type,quantity,reason,user_name)
         VALUES ($1,$2,NOW(),$3,$4,'Stock Adjust',$5,$6,$7)`,
        ['adjust-' + product.id + '-' + Date.now(), product.shopId, product.id,
         product.name, delta, reason || 'Manual Product Adjustment', actor]
      );
    }
    await client.query(
      `INSERT INTO activity_logs
       (id,shop_id,date,user_name,role,action,details)
       VALUES ($1,$2,NOW(),$3,$4,'Updated Product',$5)`,
      ['edit-' + product.id + '-' + Date.now(), product.shopId, actor, role,
       `Updated ${product.name} in ${shopName}; stock changed by ${delta}.`]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Product intake is a single transaction: catalog row, stock ledger and audit
// either all commit or all roll back. No other normalized tables are rewritten.
export const createProductWithIntake = async (
  product: Product, createdBy: string, role: string, shopName: string
) => {
  if (!product.shopId) throw new Error('Product must belong to a shop.');
  if (!Number.isSafeInteger(product.quantity) || product.quantity < 0) {
    throw new Error('Initial stock must be a nonnegative whole number.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO products
       (id, shop_id, name, sku, barcode, qr_code, internal_code, image_url,
        images_json, brand, category, cost_price, selling_price, wholesale_price,
        dealer_price, quantity, reorder_level, warranty, description,
        long_description, location, status, variants_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb)`,
      [product.id, product.shopId, product.name, product.sku, product.barcode || null,
       product.qrCode || null, product.internalCode || null, product.imageUrl || null,
       JSON.stringify(product.images || []), product.brand, product.category,
       product.costPrice, product.sellingPrice, product.wholesalePrice || 0,
       product.dealerPrice || 0, product.quantity, product.reorderLevel,
       product.warranty, product.description, product.longDescription || null,
       product.location || null, product.status || 'Active',
       JSON.stringify(product.variants || [])]
    );
    if (product.quantity > 0) {
      await client.query(
        `INSERT INTO stock_logs
         (id, shop_id, date, product_id, product_name, type, quantity, reason, user_name)
         VALUES ($1,$2,NOW(),$3,$4,'Stock In',$5,'Initial Product Registration Intake',$6)`,
        ['initial-stock-' + product.id, product.shopId, product.id,
         product.name, product.quantity, createdBy]
      );
    }
    await client.query(
      `INSERT INTO activity_logs
       (id, shop_id, date, user_name, role, action, details)
       VALUES ($1,$2,NOW(),$3,$4,'Added Product',$5)`,
      ['product-created-' + product.id, product.shopId, createdBy, role,
       `Added ${product.name} (SKU: ${product.sku}) to ${shopName}.`]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const insertProduct = async (product: Omit<Product, 'id'> & { id: string }) => {
  await pool.query(
    `INSERT INTO products (id, shop_id, name, sku, barcode, qr_code, internal_code, image_url, images_json, brand, category, cost_price, selling_price, wholesale_price, dealer_price, quantity, reorder_level, warranty, description, long_description, location, status, variants_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb)`,
    [
      product.id,
      product.shopId || null,
      product.name,
      product.sku,
      product.barcode || null,
      product.qrCode || null,
      product.internalCode || null,
      product.imageUrl || null,
      JSON.stringify(product.images || []),
      product.brand,
      product.category,
      product.costPrice,
      product.sellingPrice,
      product.wholesalePrice || 0,
      product.dealerPrice || 0,
      product.quantity,
      product.reorderLevel,
      product.warranty,
      product.description,
      product.longDescription || null,
      product.location || null,
      product.status || 'Active',
      JSON.stringify(product.variants || []),
    ]
  );
};

export const updateProduct = async (id: string, product: Partial<Product>) => {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  const mapping: Record<string, string> = {
    shopId: 'shop_id',
    name: 'name',
    sku: 'sku',
    barcode: 'barcode',
    qrCode: 'qr_code',
    internalCode: 'internal_code',
    imageUrl: 'image_url',
    brand: 'brand',
    category: 'category',
    costPrice: 'cost_price',
    sellingPrice: 'selling_price',
    wholesalePrice: 'wholesale_price',
    dealerPrice: 'dealer_price',
    quantity: 'quantity',
    reorderLevel: 'reorder_level',
    warranty: 'warranty',
    description: 'description',
    longDescription: 'long_description',
    location: 'location',
    status: 'status',
  };

  for (const [key, dbCol] of Object.entries(mapping)) {
    if ((product as any)[key] !== undefined) {
      fields.push(`${dbCol} = $${idx++}`);
      values.push((product as any)[key]);
    }
  }

  if (product.images !== undefined) {
    fields.push(`images_json = $${idx++}`);
    values.push(JSON.stringify(product.images));
  }
  if (product.variants !== undefined) {
    fields.push(`variants_json = $${idx++}`);
    values.push(JSON.stringify(product.variants));
  }

  if (fields.length === 0) return;

  values.push(id);
  const sql = `UPDATE products SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx}`;
  await pool.query(sql, values);
};

export const deleteProduct = async (id: string) => {
  await pool.query('DELETE FROM products WHERE id = $1', [id]);
};

export const insertUser = async (user: UserAccount) => {
  await pool.query(
    `INSERT INTO users (id, email, name, role, password_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, user.email, user.name, user.role, user.passwordHash]
  );
};

export const updateUser = async (id: string, user: Partial<UserAccount>) => {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (user.email !== undefined) { fields.push(`email = $${idx++}`); values.push(user.email); }
  if (user.name !== undefined) { fields.push(`name = $${idx++}`); values.push(user.name); }
  if (user.role !== undefined) { fields.push(`role = $${idx++}`); values.push(user.role); }
  if (user.passwordHash !== undefined) { fields.push(`password_hash = $${idx++}`); values.push(user.passwordHash); }

  if (fields.length === 0) return;
  values.push(id);
  const sql = `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx}`;
  await pool.query(sql, values);
};

export const deleteUser = async (id: string) => {
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
};

export const insertSupplier = async (s: Supplier) => {
  await pool.query(
    `INSERT INTO suppliers (id, shop_id, name, company_name, phone, email, address, tax_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [s.id, s.shopId || null, s.name, s.companyName, s.phone, s.email, s.address, s.taxNumber]
  );
};

export const insertCustomer = async (c: Customer) => {
  await pool.query(
    `INSERT INTO customers (id, shop_id, name, phone, email, address, loyalty_balance, purchase_count, credit_limit, credit_balance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [c.id, c.shopId || null, c.name, c.phone, c.email, c.address, c.loyaltyBalance || 0, c.purchaseCount || 0, c.creditLimit || 0, c.creditBalance || 0]
  );
};

export const updateCustomerCreditLimit = async (customerId: string, shopId: string, creditLimit: number) => {
  if (!Number.isFinite(creditLimit) || creditLimit < 0 || Math.round(creditLimit * 100) !== creditLimit * 100) {
    throw new Error('Invalid credit limit.');
  }
  const result = await pool.query(
    'UPDATE customers SET credit_limit = $1, updated_at = NOW() WHERE id = $2 AND shop_id = $3 RETURNING id',
    [creditLimit, customerId, shopId]
  );
  if (!result.rowCount) throw new Error('Customer not found in this shop.');
};

export const addCustomerCreditPayment = async (p: CustomerCreditPayment) => {
  if (!p.shopId || !Number.isFinite(p.amount) || p.amount <= 0 ||
      !Number.isSafeInteger(Math.round(p.amount * 100)) ||
      Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 0.00001) {
    throw new Error('Payment amount must be positive and have at most two decimal places.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT name, credit_balance FROM customers WHERE id = $1 AND shop_id = $2 FOR UPDATE',
      [p.customerId, p.shopId]
    );
    if (!result.rowCount) throw new Error('Customer not found in this shop.');
    const outstanding = Number(result.rows[0].credit_balance);
    if (!Number.isFinite(outstanding) || outstanding <= 0) {
      throw new Error('Customer has no outstanding credit balance.');
    }
    if (Math.round(p.amount * 100) > Math.round(outstanding * 100)) {
      throw new Error('Payment exceeds the customer outstanding credit balance.');
    }
    await client.query(
      `INSERT INTO customer_credit_payments (id, shop_id, customer_id, customer_name, amount, date, payment_method, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [p.id, p.shopId, p.customerId, result.rows[0].name, p.amount, p.date, p.paymentMethod, p.note || null, p.createdBy || null]
    );
    await client.query(
      `UPDATE customers SET credit_balance = credit_balance - $1, updated_at = NOW()
       WHERE id = $2 AND shop_id = $3`,
      [p.amount, p.customerId, p.shopId]
    );
    await client.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1, $2, NOW(), $3, 'Cashier', 'Credit Payment', $4)`,
      ['credit-payment-' + p.id, p.shopId, p.createdBy || 'Cashier',
       `Customer ${result.rows[0].name} paid Rs.${p.amount.toFixed(2)} towards credit.`]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const insertEmployee = async (e: Employee) => {
  await pool.query(
    `INSERT INTO employees (id, shop_id, name, role, phone, email, salary, attendance_status, performance_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [e.id, e.shopId || null, e.name, e.role, e.phone, e.email, e.salary, e.attendanceStatus, e.performanceScore || 0]
  );
};

export const updateEmployee = async (id: string, e: Partial<Employee>) => {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (e.name !== undefined) { fields.push(`name = $${idx++}`); values.push(e.name); }
  if (e.role !== undefined) { fields.push(`role = $${idx++}`); values.push(e.role); }
  if (e.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(e.phone); }
  if (e.email !== undefined) { fields.push(`email = $${idx++}`); values.push(e.email); }
  if (e.salary !== undefined) { fields.push(`salary = $${idx++}`); values.push(e.salary); }
  if (e.attendanceStatus !== undefined) { fields.push(`attendance_status = $${idx++}`); values.push(e.attendanceStatus); }
  if (e.performanceScore !== undefined) { fields.push(`performance_score = $${idx++}`); values.push(e.performanceScore); }

  if (fields.length === 0) return;
  values.push(id);
  const sql = `UPDATE employees SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx}`;
  await pool.query(sql, values);
};

export const insertManualExpense = async (e: ManualExpense) => {
  await pool.query(
    `INSERT INTO manual_expenses (id, description, amount, date, category)
     VALUES ($1, $2, $3, $4, $5)`,
    [e.id, e.desc, e.amount, e.date, e.category]
  );
};

export const insertSupplierPayment = async (p: SupplierPayment) => {
  if (!p.shopId || !Number.isFinite(p.amount) || p.amount <= 0 ||
      Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 0.00001) {
    throw new Error('Supplier payment amount must be positive with at most two decimal places.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const supplier = await client.query(
      'SELECT id, name, company_name FROM suppliers WHERE id = $1 AND shop_id = $2 FOR UPDATE',
      [p.supplierId, p.shopId]
    );
    if (!supplier.rowCount) throw new Error('Supplier not found in this shop.');

    if (p.purchaseOrderId) {
      const po = await client.query(
        'SELECT id, supplier_id, total FROM purchase_orders WHERE id = $1 AND shop_id = $2 FOR UPDATE',
        [p.purchaseOrderId, p.shopId]
      );
      if (!po.rowCount || po.rows[0].supplier_id !== p.supplierId) {
        throw new Error('Purchase order does not belong to this supplier and shop.');
      }
      const previous = await client.query(
        'SELECT COALESCE(SUM(amount), 0) AS paid FROM supplier_payments WHERE purchase_order_id = $1 AND shop_id = $2',
        [p.purchaseOrderId, p.shopId]
      );
      const available = Number(po.rows[0].total) - Number(previous.rows[0].paid);
      if (!Number.isFinite(available) || Math.round(p.amount * 100) > Math.round(available * 100)) {
        throw new Error('Supplier payment exceeds the remaining purchase order balance.');
      }
    }

    const supplierName = supplier.rows[0].company_name || supplier.rows[0].name;
    await client.query(
      `INSERT INTO supplier_payments
       (id, shop_id, supplier_id, supplier_name, purchase_order_id, amount, payment_method, date, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [p.id, p.shopId, p.supplierId, supplierName, p.purchaseOrderId || null, p.amount,
       p.paymentMethod, p.date, p.note || null, p.createdBy || null]
    );
    await client.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1,$2,NOW(),$3,'Store Manager','Supplier Payment',$4)`,
      ['supplier-payment-' + p.id, p.shopId, p.createdBy || 'Manager',
       `Paid Rs.${p.amount.toFixed(2)} to ${supplierName}.`]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const insertQuotation = async (q: Quotation) => {
  await pool.query(
    `INSERT INTO quotations (id, shop_id, quote_number, date, valid_until, customer_id, customer_name, customer_phone, items, subtotal, tax, discount_amount, total, status, notes, created_by, converted_to_tx_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [q.id, q.shopId || null, q.quoteNumber, q.date, q.validUntil || null, q.customerId || null, q.customerName, q.customerPhone || null, JSON.stringify(q.items), q.subtotal, q.tax, q.discountAmount, q.total, q.status, q.notes || null, q.createdBy || null, q.convertedToTxId || null]
  );
};

export const updateQuotation = async (id: string, q: Partial<Quotation>) => {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (q.status !== undefined) { fields.push(`status = $${idx++}`); values.push(q.status); }
  if (q.convertedToTxId !== undefined) { fields.push(`converted_to_tx_id = $${idx++}`); values.push(q.convertedToTxId); }

  if (fields.length === 0) return;
  values.push(id);
  const sql = `UPDATE quotations SET ${fields.join(', ')} WHERE id = $${idx}`;
  await pool.query(sql, values);
};

export const insertCashShift = async (s: CashShift) => {
  await pool.query(
    `INSERT INTO cash_shifts (id, shop_id, cashier_name, opened_at, opening_float, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [s.id, s.shopId || null, s.cashierName, s.openedAt, s.openingFloat, s.status, s.notes || null]
  );
};

export const updateCashShift = async (id: string, s: Partial<CashShift>) => {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (s.closedAt !== undefined) { fields.push(`closed_at = $${idx++}`); values.push(s.closedAt); }
  if (s.closingCash !== undefined) { fields.push(`closing_cash = $${idx++}`); values.push(s.closingCash); }
  if (s.expectedCash !== undefined) { fields.push(`expected_cash = $${idx++}`); values.push(s.expectedCash); }
  if (s.cashDifference !== undefined) { fields.push(`cash_difference = $${idx++}`); values.push(s.cashDifference); }
  if (s.status !== undefined) { fields.push(`status = $${idx++}`); values.push(s.status); }
  if (s.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(s.notes); }

  if (fields.length === 0) return;
  values.push(id);
  const sql = `UPDATE cash_shifts SET ${fields.join(', ')} WHERE id = $${idx}`;
  await pool.query(sql, values);
};

export const insertInvoicePrintLog = async (l: InvoicePrintLog) => {
  await pool.query(
    `INSERT INTO invoice_print_logs (id, shop_id, transaction_id, invoice_number, copy_type, print_sequence, printed_by, printed_at, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [l.id, l.shopId || null, l.transactionId, l.invoiceNumber, l.copyType, l.printSequence, l.printedBy, l.printedAt, l.reason || null]
  );
};

export const updateStoreSettings = async (s: StoreSettings) => {
  await pool.query(
    `UPDATE store_settings
     SET tax_rate = $1, store_name = $2, currency = $3, invoice_prefix = $4, logo_url = $5, store_address = $6, store_phone = $7, active_shop_id = $8, product_categories = $9::jsonb, shop_profiles = $10::jsonb, shop_qr_data = $11, updated_at = NOW()
     WHERE id = 'default'`,
    [
      s.taxRate,
      s.storeName,
      s.currency,
      s.invoicePrefix,
      s.logoUrl || null,
      s.address || null,
      s.phone || null,
      s.activeShopId || 'shop-main',
      JSON.stringify(s.productCategories || []),
      JSON.stringify(s.shopProfiles || []),
      s.shopQRData || null,
    ]
  );
};

// TRANSACTIONAL ATOMIC EXECUTORS

/**
 * atomic transaction for checking out POS invoice items:
 * 1) SELECT FOR UPDATE lock on products and variants to block race conditions.
 * 2) Check if stock is sufficient, decrease quantity.
 * 3) Save transaction and transaction items.
 * 4) Add StockLogs.
 * 5) Update Customer credit/loyalty balances.
 * 6) Write ActivityLogs.
 */
export const checkoutTransaction = async (tx: SalesTransaction, cashierRole: string, activeShopName: string) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Verify and update stock using SELECT FOR UPDATE to lock rows
    for (const item of tx.items) {
      const productRes = await client.query(
        'SELECT * FROM products WHERE id = $1 AND shop_id = $2 FOR UPDATE',
        [item.productId, tx.shopId]
      );
      if (productRes.rowCount === 0) {
        throw new Error(`Product ${item.productName} not found in catalog.`);
      }

      const dbProduct = productRes.rows[0];
      if (dbProduct.status === 'Inactive') {
        throw new Error(`Product ${dbProduct.name} is archived and cannot be sold.`);
      }
      const variantsList = Array.isArray(dbProduct.variants_json) ? dbProduct.variants_json as ProductVariant[] : [];

      if (item.variantId) {
        const variantIndex = variantsList.findIndex((v) => v.id === item.variantId);
        if (variantIndex === -1) {
          throw new Error(`Variant ${item.variantName} not found for product ${dbProduct.name}.`);
        }
        const targetVariant = variantsList[variantIndex];
        const currentQty = Number(targetVariant.quantity || 0);
        if (currentQty < item.quantity) {
          throw new Error(`Insufficient stock for variant ${dbProduct.name} (${targetVariant.name}). Available: ${currentQty}, requested: ${item.quantity}`);
        }

        // Subtract stock from variant
        targetVariant.quantity = Math.max(0, currentQty - item.quantity);
        // Total product quantity is sum of variant quantities
        const totalProductQty = variantsList.reduce((sum, v) => sum + Math.max(0, Number(v.quantity || 0)), 0);

        // Update database row
        await client.query(
          `UPDATE products SET quantity = $1, variants_json = $2::jsonb, updated_at = NOW() WHERE id = $3`,
          [totalProductQty, JSON.stringify(variantsList), dbProduct.id]
        );
      } else {
        const currentQty = Number(dbProduct.quantity || 0);
        if (currentQty < item.quantity) {
          throw new Error(`Insufficient stock for product ${dbProduct.name}. Available: ${currentQty}, requested: ${item.quantity}`);
        }

        // Subtract stock from product
        await client.query(
          `UPDATE products SET quantity = GREATEST(0, quantity - $1), updated_at = NOW() WHERE id = $2`,
          [item.quantity, dbProduct.id]
        );
      }

      // Add Stock Log
      const logId = 'log-' + Date.now() + Math.random().toString(36).substring(2, 5);
      await client.query(
        `INSERT INTO stock_logs (id, shop_id, date, product_id, product_name, type, quantity, reason, user_name, reference_id)
         VALUES ($1, $2, NOW(), $3, $4, 'Stock Out', $5, 'Invoice Sale Checkout', $6, $7)`,
        [logId, tx.shopId, item.productId, item.productName, -item.quantity, tx.cashierName, tx.id]
      );
    }

    // 2) Save main Transaction row
    await client.query(
      `INSERT INTO sales_transactions (id, shop_id, invoice_number, date, customer_id, customer_name, customer_phone, customer_address, cashier_name, subtotal, tax, discount_amount, total, cash_received, change_due, payment_method, payment_status, wholesale_meta, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, 'Completed')`,
      [
        tx.id,
        tx.shopId || null,
        tx.invoiceNumber,
        tx.date,
        tx.customerId || 'cust-walkin',
        tx.customerName,
        tx.customerPhone || null,
        tx.customerAddress || null,
        tx.cashierName,
        tx.subtotal,
        tx.tax,
        tx.discountAmount,
        tx.total,
        tx.cashReceived != null ? tx.cashReceived : null,
        tx.changeDue != null ? tx.changeDue : null,
        tx.paymentMethod,
        tx.paymentStatus || null,
        tx.wholesaleMeta ? JSON.stringify(tx.wholesaleMeta) : null,
      ]
    );

    // 3) Save Transaction items
    for (const item of tx.items) {
      await client.query(
        `INSERT INTO sales_transaction_items (transaction_id, product_id, product_name, quantity, selling_price, discount, discount_amount, cost_price, variant_id, variant_name, variant_unit, variant_sku, variant_barcode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          tx.id,
          item.productId,
          item.productName,
          item.quantity,
          item.sellingPrice,
          item.discount,
          item.discountAmount || 0,
          item.costPrice || 0,
          item.variantId || null,
          item.variantName || null,
          item.variantUnit || null,
          item.variantSku || null,
          item.variantBarcode || null,
        ]
      );
    }

    // 4) Update Customer credit and loyalty balances
    if (tx.customerId && tx.customerId !== 'cust-walkin') {
      const customerRes = await client.query(
        'SELECT * FROM customers WHERE id = $1 AND shop_id = $2 FOR UPDATE',
        [tx.customerId, tx.shopId]
      );
      if (customerRes.rowCount > 0) {
        const customer = customerRes.rows[0];
        const currentCredit = Number(customer.credit_balance || 0);
        const creditLimit = Number(customer.credit_limit || 0);

        if (tx.paymentMethod === 'Credit Account') {
          if (creditLimit > 0 && Math.round((currentCredit + tx.total) * 100) > Math.round(creditLimit * 100)) {
            throw new Error(`Credit limit exceeded. Outstanding: Rs.${currentCredit.toFixed(2)}, limit: Rs.${creditLimit.toFixed(2)}`);
          }
          await client.query(
            `UPDATE customers SET purchase_count = purchase_count + 1, loyalty_balance = loyalty_balance + $1, credit_balance = credit_balance + $2, updated_at = NOW() WHERE id = $3`,
            [Math.floor(tx.total / 10), tx.total, tx.customerId]
          );
        } else {
          await client.query(
            `UPDATE customers SET purchase_count = purchase_count + 1, loyalty_balance = loyalty_balance + $1, updated_at = NOW() WHERE id = $2`,
            [Math.floor(tx.total / 10), tx.customerId]
          );
        }
      }
    }

    // 5) Log activity
    const activityId = 'act-' + tx.id;
    await client.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1, $2, NOW(), $3, $4, 'Invoice Created', $5)`,
      [activityId, tx.shopId, tx.cashierName, cashierRole, `Billed sales transaction ${tx.invoiceNumber} for ${activeShopName}, total Rs.${tx.total.toFixed(2)}.`]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * atomic transaction for transaction refund/cancellation:
 * 1) Select transaction FOR UPDATE.
 * 2) Check if status is Refunded. If so, fail.
 * 3) Return items to inventory stock (including variants).
 * 4) Write StockLogs.
 * 5) Deduct customer loyalty and credit outstanding if credit account.
 * 6) Mark status as Refunded.
 * 7) Write ActivityLogs.
 */
export const refundTransaction = async (txId: string, shopId: string, reason: string, cashierName: string, cashierRole: string) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Transaction row lock prevents simultaneous/double refunds.
    const txRes = await client.query(
      'SELECT * FROM sales_transactions WHERE id = $1 AND shop_id = $2 FOR UPDATE',
      [txId, shopId]
    );
    if (!txRes.rowCount) throw new Error('Transaction not found in this shop.');
    const tx = txRes.rows[0];
    if (tx.status === 'Refunded') throw new Error('Transaction has already been refunded.');

    const itemsRes = await client.query(
      'SELECT * FROM sales_transaction_items WHERE transaction_id = $1 ORDER BY id',
      [txId]
    );
    if (!itemsRes.rowCount) throw new Error('Cannot refund an invoice with no saved items.');

    // All checks and mutations occur under the same PostgreSQL transaction.
    // Any missing variant/product causes a ROLLBACK, not a partial return.
    for (const item of itemsRes.rows) {
      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error('Cannot refund an invoice with invalid item quantities.');
      }
      const productRes = await client.query(
        'SELECT * FROM products WHERE id = $1 AND shop_id = $2 FOR UPDATE',
        [item.product_id, shopId]
      );
      if (!productRes.rowCount) throw new Error(`Cannot refund: product ${item.product_name} is missing from this shop.`);
      const product = productRes.rows[0];
      const variants: ProductVariant[] = Array.isArray(product.variants_json) ? product.variants_json : [];

      if (item.variant_id) {
        const variant = variants.find((entry) => entry.id === item.variant_id);
        if (!variant) throw new Error(`Cannot refund: product variant ${item.variant_name || item.variant_id} is missing.`);
        variant.quantity = Number(variant.quantity || 0) + quantity;
        const stock = variants.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
        await client.query(
          'UPDATE products SET quantity = $1, variants_json = $2::jsonb, updated_at = NOW() WHERE id = $3 AND shop_id = $4',
          [stock, JSON.stringify(variants), product.id, shopId]
        );
      } else {
        if (variants.length > 0) {
          throw new Error('Cannot refund invoice without recorded variant on a variant-managed product.');
        }
        await client.query(
          'UPDATE products SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2 AND shop_id = $3',
          [quantity, product.id, shopId]
        );
      }

      await client.query(
        `INSERT INTO stock_logs (id, shop_id, date, product_id, product_name, type, quantity, reason, user_name, reference_id)
         VALUES ($1, $2, NOW(), $3, $4, 'Return', $5, $6, $7, $8)`,
        ['return-' + txId + '-' + item.id, shopId, item.product_id, item.product_name, quantity,
          reason ? 'Refund processed: ' + reason : 'Refund of invoice ' + tx.invoice_number, cashierName, txId]
      );
    }

    if (tx.customer_id && tx.customer_id !== 'cust-walkin') {
      const customerRes = await client.query(
        'SELECT * FROM customers WHERE id = $1 AND shop_id = $2 FOR UPDATE',
        [tx.customer_id, shopId]
      );
      if (tx.payment_method === 'Credit Account' && !customerRes.rowCount) {
        throw new Error('Cannot refund credit sale: customer account is missing.');
      }
      if (customerRes.rowCount) {
        const total = Number(tx.total);
        const loyalty = Math.floor(total / 10);
        if (tx.payment_method === 'Credit Account') {
          const outstanding = Number(customerRes.rows[0].credit_balance);
          if (!Number.isFinite(outstanding) || outstanding + 0.005 < total) {
            throw new Error('Credit balance is below this invoice total. Reconcile customer payments before refunding.');
          }
          await client.query(
            `UPDATE customers
             SET purchase_count = GREATEST(0, purchase_count - 1),
                 loyalty_balance = GREATEST(0, loyalty_balance - $1),
                 credit_balance = credit_balance - $2, updated_at = NOW()
             WHERE id = $3 AND shop_id = $4`,
            [loyalty, total, tx.customer_id, shopId]
          );
        } else {
          await client.query(
            `UPDATE customers SET purchase_count = GREATEST(0, purchase_count - 1),
              loyalty_balance = GREATEST(0, loyalty_balance - $1), updated_at = NOW()
              WHERE id = $2 AND shop_id = $3`,
            [loyalty, tx.customer_id, shopId]
          );
        }
      }
    }

    await client.query(
      `UPDATE sales_transactions SET status = 'Refunded', refunded_at = NOW(), refund_reason = $1
       WHERE id = $2 AND shop_id = $3`,
      [reason || 'Refund Requested', txId, shopId]
    );
    await client.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1, $2, NOW(), $3, $4, 'Invoice Refunded', $5)`,
      ['refund-' + txId, shopId, cashierName, cashierRole,
        `Refunded invoice ${tx.invoice_number}. Total: Rs.${Number(tx.total).toFixed(2)}. Reason: ${reason || 'Not supplied'}`]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * atomic transaction for issuing a purchase order
 */
export const createPurchaseOrder = async (po: PurchaseOrder) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const supplierRes = await client.query(
      'SELECT id FROM suppliers WHERE id = $1 AND shop_id = $2',
      [po.supplierId, po.shopId]
    );
    if (!supplierRes.rowCount) throw new Error('Supplier is not available in this shop.');
    await client.query(
      `INSERT INTO purchase_orders (id, shop_id, po_number, date, supplier_id, supplier_name, total, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [po.id, po.shopId || null, po.poNumber, po.date, po.supplierId, po.supplierName, po.total, po.status]
    );

    for (const item of po.items) {
      const product = await client.query('SELECT name, variants_json FROM products WHERE id = $1 AND shop_id = $2', [item.productId, po.shopId]);
      if (!product.rowCount) throw new Error('Product unavailable in this shop.');
      purchaseVariant(product.rows[0].variants_json || [], item.variantId, product.rows[0].name);
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, quantity, cost_price, variant_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [po.id, item.productId, item.productName, item.quantity, item.costPrice, item.variantId || null]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * atomic transaction for receiving a purchase order and incrementing stock quantities
 */
export const receivePurchaseOrder = async (poId: string, shopId: string, receiveUser: string) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Verify and lock purchase order
    const poRes = await client.query(
      'SELECT * FROM purchase_orders WHERE id = $1 AND shop_id = $2 FOR UPDATE',
      [poId, shopId]
    );
    if (poRes.rowCount === 0) {
      throw new Error('Purchase order not found.');
    }
    const po = poRes.rows[0];
    if (po.status === 'Received') throw new Error('Purchase order already received.');

    if (po.status !== 'Pending' && po.status !== 'Ordered') throw new Error('Only open orders can be received.');

    // Load items
    const itemsRes = await client.query(
      'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1',
      [poId]
    );
    const poItems = itemsRes.rows;
    if (!poItems.length) throw new Error('Cannot receive an empty purchase order.');

    // 2) Acknowledge receipt and increase stock
    for (const item of poItems) {
      const productRes = await client.query(
        'SELECT * FROM products WHERE id = $1 AND shop_id = $2 FOR UPDATE',
        [item.product_id, shopId]
      );
      if (!productRes.rowCount) throw new Error('Ordered product unavailable in this shop.');
      if (!Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0) throw new Error('Invalid purchase quantity.');
      const dbProduct = productRes.rows[0];
      const variantsList: ProductVariant[] = dbProduct.variants_json || [];
      const variant = purchaseVariant(variantsList, item.variant_id, dbProduct.name, true);
      if (variant) {
        variant.quantity = Number(variant.quantity || 0) + Number(item.quantity);
        const totalProductQty = variantsList.reduce((sum, v) => sum + Math.max(0, Number(v.quantity || 0)), 0);
        await client.query(
          `UPDATE products SET quantity = $1, variants_json = $2::jsonb, updated_at = NOW() WHERE id = $3`,
          [totalProductQty, JSON.stringify(variantsList), dbProduct.id]
        );
      } else {
        await client.query(
          `UPDATE products SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2`,
          [item.quantity, dbProduct.id]
        );
      }

      // Add Stock Log
      const logId = 'received-' + poId + '-line-' + item.id;
      await client.query(
        `INSERT INTO stock_logs (id, shop_id, date, product_id, product_name, type, quantity, reason, user_name, reference_id)
         VALUES ($1, $2, NOW(), $3, $4, 'Stock In', $5, 'Purchase Order Receipt', $6, $7)`,
        [logId, shopId, item.product_id, item.product_name, item.quantity, receiveUser, poId]
      );
    }

    await client.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1, $2, NOW(), $3, 'Inventory Staff', 'Received Materials', $4)`,
      ['received-' + poId, shopId, receiveUser, 'Received purchase order ' + po.po_number]
    );
    // 3) Update status to Received
    await client.query(
      `UPDATE purchase_orders SET status = 'Received' WHERE id = $1 AND shop_id = $2`,
      [poId, shopId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/** Set an open PO status, without writing unrelated business tables. */
export const updatePurchaseOrderStatus = async (
  poId: string, shopId: string, status: 'Pending' | 'Ordered' | 'Cancelled', userName: string
) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT po_number, status FROM purchase_orders WHERE id = $1 AND shop_id = $2 FOR UPDATE',
      [poId, shopId]
    );
    if (!result.rowCount) throw new Error('Purchase order not found in this shop.');
    const po = result.rows[0];
    if (po.status === 'Received' || po.status === 'Cancelled' || po.status === 'Partially Received') {
      throw new Error('Cannot modify a received or cancelled purchase order.');
    }
    if (status === 'Pending' && po.status !== 'Pending') {
      throw new Error('Cannot move an ordered purchase back to Pending.');
    }
    if (po.status !== status) {
      await client.query(
        'UPDATE purchase_orders SET status = $1 WHERE id = $2 AND shop_id = $3',
        [status, poId, shopId]
      );
      await client.query(
        `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
         VALUES ($1, $2, NOW(), $3, 'Inventory Staff', 'PO Status Updated', $4)`,
        ['po-status-' + poId + '-' + Date.now(), shopId, userName,
          `Purchase order ${po.po_number} changed to ${status}`]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
