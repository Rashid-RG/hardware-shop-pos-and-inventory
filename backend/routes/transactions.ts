import { Router } from 'express';
import { requireAuth, requireRole, getActiveShopContext, AppRequest } from '../middleware';
import { pool, checkoutTransaction, refundTransaction, loadStateFromNormalized, insertInvoicePrintLog } from '../db';
import { buildInvoicePdfBuffer } from '../services/pdf';
import { sendInvoiceEmail, sendInvoiceWhatsApp } from '../services/share';
import { SalesTransaction, InvoiceCopyType, InvoicePrintLog, PaymentStatus } from '../../src/types';

const router = Router();

const INVOICE_COPY_TYPES = [
  'Original Copy',
  'Duplicate Copy',
  'Office Copy',
  'Accounts Copy',
  'Delivery Copy',
  'Store Copy',
  'Reprinted Invoice',
];

const normalizeInvoiceCopyType = (value?: string): InvoiceCopyType | undefined => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return undefined;
  }
  return INVOICE_COPY_TYPES.includes(normalized)
    ? (normalized as InvoiceCopyType)
    : undefined;
};

const normalizePaymentStatus = (value?: string): PaymentStatus | undefined => {
  const normalized = String(value || '').trim().toUpperCase();
  const allowed = ['PAID', 'PARTIALLY PAID', 'UNPAID', 'CREDIT SALE', 'CANCELLED'];
  return allowed.includes(normalized) ? normalized as PaymentStatus : undefined;
};

const validateCheckoutPayload = (cartItems: any[]): string | null => {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return 'Cart is empty';
  }

  for (let i = 0; i < cartItems.length; i += 1) {
    const item = cartItems[i];
    const label = `Cart item ${i + 1}`;
    if (!item || !item.product || !String(item.product.id || '').trim()) {
      return `${label} is missing product reference`;
    }
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return `${label} quantity must be greater than 0`;
    }
    const discountPct = Number(item.discount || 0);
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
      return `${label} discount percent must be between 0 and 100`;
    }
    const amountDiscount = Number(item.discountAmount || 0);
    if (!Number.isFinite(amountDiscount) || amountDiscount < 0) {
      return `${label} discount amount cannot be negative`;
    }
  }

  return null;
};

router.use(requireAuth);

// POS Transaction Checkout Route
router.post('/', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(req);
  const { cartItems, customerId, customerName, customerPhone, customerAddress, cashierName, paymentMethod, paymentStatus, wholesaleMeta, discountAmount, cashReceived } = req.body;

  const checkoutError = validateCheckoutPayload(cartItems || []);
  if (checkoutError) {
    return res.status(400).json({ error: checkoutError });
  }

  // Load current settings to compute prefix & tax
  const settingsRes = await pool.query(`SELECT * FROM store_settings WHERE id = 'default' LIMIT 1`);
  const settingsRow = settingsRes.rows[0] || {
    tax_rate: 18,
    store_name: 'Lanka Smart Hardware',
    currency: 'LKR',
    invoice_prefix: 'SL-INV',
  };

  const activeShopProfile = Array.isArray(settingsRow.shop_profiles)
    ? settingsRow.shop_profiles.find((p: any) => p.id === activeShopId)
    : null;
  const activeShopName = activeShopProfile?.name || settingsRow.store_name;

  const txId = `tx-${Date.now()}`;
  const invoiceNum = `${activeShopProfile?.invoicePrefix || settingsRow.invoice_prefix}-${Date.now()}`;

  // Build items payload
  const completedItems = [];
  let subtotal = 0;

  for (const item of cartItems) {
    const discountPct = Math.min(100, Math.max(0, Number(item.discount) || 0));
    const unitSellingPrice = Number(item.unitPrice ?? item.product.sellingPrice) || 0;
    const unitCostPrice = Number(item.unitCostPrice ?? item.product.costPrice) || 0;
    const baseItemCost = unitSellingPrice * item.quantity;
    const percentAdjustedLineTotal = baseItemCost * (1 - discountPct / 100);
    const lineDiscountAmount = Math.min(percentAdjustedLineTotal, Math.max(0, Number(item.discountAmount) || 0));
    const lineTotal = Math.max(0, percentAdjustedLineTotal - lineDiscountAmount);

    completedItems.push({
      productId: item.product.id,
      productName: item.variantName ? `${item.product.name} (${item.variantName})` : item.product.name,
      variantId: item.variantId || undefined,
      variantName: item.variantName || undefined,
      variantUnit: item.variantUnit || undefined,
      variantSku: item.variantSku || undefined,
      variantBarcode: item.variantBarcode || undefined,
      quantity: item.quantity,
      sellingPrice: unitSellingPrice,
      costPrice: unitCostPrice,
      discount: discountPct,
      discountAmount: Math.round(lineDiscountAmount * 100) / 100,
    });

    subtotal += Math.round(lineTotal * 100) / 100;
  }

  const taxRate = Math.max(0, Number(activeShopProfile?.taxRate ?? settingsRow.tax_rate) || 0) / 100;
  const tax = Math.round((subtotal * taxRate) * 100) / 100;
  const discountedSub = Math.max(0, subtotal - (discountAmount || 0));
  const total = Math.round((discountedSub + tax) * 100) / 100;
  const cashPaid = paymentMethod === 'Cash' ? Math.round(Number(cashReceived ?? total) * 100) / 100 : undefined;
  const cashChange = paymentMethod === 'Cash' ? Math.round(Math.max(0, (cashPaid ?? 0) - total) * 100) / 100 : undefined;
  const normalizedPaymentStatus = normalizePaymentStatus(paymentStatus)
    || (paymentMethod === 'Credit Account'
      ? 'CREDIT SALE'
      : ((cashPaid ?? total) <= 0
        ? 'UNPAID'
        : ((cashPaid ?? total) < total ? 'PARTIALLY PAID' : 'PAID')));

  if (paymentMethod === 'Cash' && (cashPaid ?? 0) < total) {
    return res.status(400).json({ error: `Cash received must be at least Rs.${total.toFixed(2)}.` });
  }

  const tx: SalesTransaction = {
    id: txId,
    shopId: activeShopId,
    invoiceNumber: invoiceNum,
    date: new Date().toISOString(),
    customerName: customerName || 'Walk-in Customer',
    customerPhone: customerPhone || undefined,
    customerAddress: customerAddress || undefined,
    customerId: customerId || 'cust-walkin',
    cashierName: cashierName || 'Cashier',
    items: completedItems,
    subtotal: Math.round(subtotal * 100) / 100,
    tax: tax,
    discountAmount: Number(discountAmount) || 0,
    total: total,
    cashReceived: cashPaid,
    changeDue: cashChange,
    paymentMethod: paymentMethod || 'Cash',
    paymentStatus: normalizedPaymentStatus as any,
    wholesaleMeta: wholesaleMeta && typeof wholesaleMeta === 'object' ? wholesaleMeta : undefined,
    status: 'Completed',
  };

  try {
    await checkoutTransaction(tx, authUser?.role || 'Cashier', activeShopName);
    res.json(tx);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Print Invoice Logging Route
router.post('/:id/print', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(req);
  const transactionId = req.params.id;
  const copyType = normalizeInvoiceCopyType(String(req.body?.copyType || '')) || 'Duplicate Copy';

  try {
    const txRes = await pool.query('SELECT invoice_number FROM sales_transactions WHERE id = $1 AND shop_id = $2', [transactionId, activeShopId]);
    if (txRes.rowCount === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const tx = txRes.rows[0];

    const logsRes = await pool.query('SELECT COUNT(*) FROM invoice_print_logs WHERE transaction_id = $1', [transactionId]);
    const totalPrints = Number(logsRes.rows[0].count || 0) + 1;

    const printLog: InvoicePrintLog = {
      id: `prn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      shopId: activeShopId,
      transactionId,
      invoiceNumber: tx.invoice_number,
      copyType,
      printSequence: totalPrints,
      printedBy: authUser?.name || 'System',
      printedAt: new Date().toISOString(),
      reason: req.body?.reason || undefined,
    };

    await insertInvoicePrintLog(printLog);

    const isReprint = totalPrints > 1 || copyType === 'Reprinted Invoice';
    const watermarkText = isReprint ? 'REPRINTED' : copyType.toUpperCase();
    const secondaryWatermarkText = isReprint ? 'DUPLICATE COPY' : '';

    res.json({
      success: true,
      printLog,
      printSummary: {
        watermarkText,
        secondaryWatermarkText,
        totalPrints,
        isReprint,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Print History endpoint
router.get('/:id/print-logs', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);
  try {
    const logsRes = await pool.query(
      `SELECT copy_type AS "copyType", print_sequence AS "printSequence", printed_by AS "printedBy", printed_at AS "printedAt", reason
       FROM invoice_print_logs
       WHERE transaction_id = $1 AND shop_id = $2
       ORDER BY printed_at DESC`,
      [req.params.id, activeShopId]
    );
    res.json({ logs: logsRes.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PDF Export endpoint
router.get('/:id/pdf', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);

  try {
    const txRes = await pool.query('SELECT * FROM sales_transactions WHERE id = $1 AND shop_id = $2', [req.params.id, activeShopId]);
    if (txRes.rowCount === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const txDb = txRes.rows[0];

    const itemsRes = await pool.query('SELECT * FROM sales_transaction_items WHERE transaction_id = $1', [txDb.id]);
    const items = itemsRes.rows.map((itm) => ({
      productId: itm.product_id,
      productName: itm.product_name,
      variantId: itm.variant_id || undefined,
      variantName: itm.variant_name || undefined,
      variantUnit: itm.variant_unit || undefined,
      variantSku: itm.variant_sku || undefined,
      variantBarcode: itm.variant_barcode || undefined,
      quantity: Number(itm.quantity),
      sellingPrice: Number(itm.selling_price),
      costPrice: Number(itm.cost_price || 0),
      discount: Number(itm.discount),
      discountAmount: Number(itm.discount_amount || 0),
    }));

    const tx: SalesTransaction = {
      id: txDb.id,
      shopId: txDb.shop_id,
      invoiceNumber: txDb.invoice_number,
      date: txDb.date,
      customerName: txDb.customer_name,
      customerPhone: txDb.customer_phone || undefined,
      customerAddress: txDb.customer_address || undefined,
      customerId: txDb.customer_id || undefined,
      cashierName: txDb.cashier_name,
      items,
      subtotal: Number(txDb.subtotal),
      tax: Number(txDb.tax),
      discountAmount: Number(txDb.discount_amount),
      total: Number(txDb.total),
      cashReceived: txDb.cash_received != null ? Number(txDb.cash_received) : undefined,
      changeDue: txDb.change_due != null ? Number(txDb.change_due) : undefined,
      paymentMethod: txDb.payment_method,
      paymentStatus: txDb.payment_status || undefined,
      wholesaleMeta: txDb.wholesale_meta || undefined,
      status: txDb.status,
      refundedAt: txDb.refunded_at || undefined,
      refundReason: txDb.refund_reason || undefined,
    };

    const copyType = normalizeInvoiceCopyType(String(req.query.copyType)) || 'Duplicate Copy';
    const printSequence = Number(req.query.printSequence) || 1;
    const watermarkText = String(req.query.watermark || copyType.toUpperCase());
    const secondaryWatermarkText = String(req.query.secondaryWatermark || '');
    const printedBy = String(req.query.printedBy || 'System');
    const printedAt = String(req.query.printedAt || new Date().toISOString());

    const settingsRes = await pool.query(`SELECT * FROM store_settings WHERE id = 'default' LIMIT 1`);
    const settings = settingsRes.rows[0] || {};
    const activeShopProfile = Array.isArray(settings.shop_profiles)
      ? settings.shop_profiles.find((p: any) => p.id === activeShopId)
      : null;
    const activeShopName = activeShopProfile?.name || settings.store_name;

    const pdfBuffer = await buildInvoicePdfBuffer(
      tx,
      activeShopName,
      { copyType, printSequence, watermarkText, secondaryWatermarkText, printedBy, printedAt },
      activeShopProfile?.logoUrl || settings.logo_url || '',
      activeShopProfile?.invoiceCompanyMeta
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${tx.invoiceNumber}.pdf`);
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Email share route
router.post('/:id/share/email', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(req);
  const to = String(req.body?.to || '').trim();
  if (!to) {
    return res.status(400).json({ error: 'Recipient email is required' });
  }

  try {
    const txRes = await pool.query('SELECT * FROM sales_transactions WHERE id = $1 AND shop_id = $2', [req.params.id, activeShopId]);
    if (txRes.rowCount === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const txDb = txRes.rows[0];

    const itemsRes = await pool.query('SELECT * FROM sales_transaction_items WHERE transaction_id = $1', [txDb.id]);
    const items = itemsRes.rows.map((itm) => ({
      productId: itm.product_id,
      productName: itm.product_name,
      variantId: itm.variant_id || undefined,
      variantName: itm.variant_name || undefined,
      variantUnit: itm.variant_unit || undefined,
      variantSku: itm.variant_sku || undefined,
      variantBarcode: itm.variant_barcode || undefined,
      quantity: Number(itm.quantity),
      sellingPrice: Number(itm.selling_price),
      costPrice: Number(itm.cost_price || 0),
      discount: Number(itm.discount),
      discountAmount: Number(itm.discount_amount || 0),
    }));

    const tx: SalesTransaction = {
      id: txDb.id,
      shopId: txDb.shop_id,
      invoiceNumber: txDb.invoice_number,
      date: txDb.date,
      customerName: txDb.customer_name,
      customerPhone: txDb.customer_phone || undefined,
      customerAddress: txDb.customer_address || undefined,
      customerId: txDb.customer_id || undefined,
      cashierName: txDb.cashier_name,
      items,
      subtotal: Number(txDb.subtotal),
      tax: Number(txDb.tax),
      discountAmount: Number(txDb.discount_amount),
      total: Number(txDb.total),
      cashReceived: txDb.cash_received != null ? Number(txDb.cash_received) : undefined,
      changeDue: txDb.change_due != null ? Number(txDb.change_due) : undefined,
      paymentMethod: txDb.payment_method,
      paymentStatus: txDb.payment_status || undefined,
      wholesaleMeta: txDb.wholesale_meta || undefined,
      status: txDb.status,
    };

    const copyType = normalizeInvoiceCopyType(String(req.body?.copyType || '')) || 'Duplicate Copy';
    const subject = String(req.body?.subject || '').trim() || `Invoice ${tx.invoiceNumber} - ${copyType}`;
    const customMessage = String(req.body?.message || '').trim();

    const settingsRes = await pool.query(`SELECT * FROM store_settings WHERE id = 'default' LIMIT 1`);
    const settings = settingsRes.rows[0] || {};
    const activeShopProfile = Array.isArray(settings.shop_profiles)
      ? settings.shop_profiles.find((p: any) => p.id === activeShopId)
      : null;
    const activeShopName = activeShopProfile?.name || settings.store_name;

    const printSequence = Math.max(1, Number(req.body?.printSequence) || 1);
    const pdfFileName = `${tx.invoiceNumber}-${copyType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;

    const pdfBuffer = await buildInvoicePdfBuffer(
      tx,
      activeShopName,
      {
        copyType,
        printSequence,
        watermarkText: copyType === 'Reprinted Invoice' ? 'REPRINTED' : copyType.toUpperCase(),
        secondaryWatermarkText: copyType === 'Reprinted Invoice' ? 'DUPLICATE COPY' : '',
      },
      activeShopProfile?.logoUrl || settings.logo_url || '',
      activeShopProfile?.invoiceCompanyMeta
    );

    await sendInvoiceEmail(to, subject, customMessage, pdfBuffer, pdfFileName, activeShopName, tx, copyType);

    // Write Activity Log
    const actId = `act-${Date.now()}`;
    await pool.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1, $2, NOW(), $3, $4, 'Invoice Shared via Email', $5)`,
      [actId, activeShopId, authUser?.name || 'System', authUser?.role || 'Store Manager', `Invoice ${tx.invoiceNumber} (${copyType}) emailed to ${to}.`]
    );

    res.json({ success: true, channel: 'email', invoiceNumber: tx.invoiceNumber, to, copyType });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// WhatsApp share route
router.post('/:id/share/whatsapp', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(req);
  const to = String(req.body?.to || '').trim();
  if (!to) {
    return res.status(400).json({ error: 'Recipient WhatsApp number is required' });
  }

  try {
    const txRes = await pool.query('SELECT * FROM sales_transactions WHERE id = $1 AND shop_id = $2', [req.params.id, activeShopId]);
    if (txRes.rowCount === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const txDb = txRes.rows[0];

    const itemsRes = await pool.query('SELECT * FROM sales_transaction_items WHERE transaction_id = $1', [txDb.id]);
    const items = itemsRes.rows.map((itm) => ({
      productId: itm.product_id,
      productName: itm.product_name,
      variantId: itm.variant_id || undefined,
      variantName: itm.variant_name || undefined,
      variantUnit: itm.variant_unit || undefined,
      variantSku: itm.variant_sku || undefined,
      variantBarcode: itm.variant_barcode || undefined,
      quantity: Number(itm.quantity),
      sellingPrice: Number(itm.selling_price),
      costPrice: Number(itm.cost_price || 0),
      discount: Number(itm.discount),
      discountAmount: Number(itm.discount_amount || 0),
    }));

    const tx: SalesTransaction = {
      id: txDb.id,
      shopId: txDb.shop_id,
      invoiceNumber: txDb.invoice_number,
      date: txDb.date,
      customerName: txDb.customer_name,
      customerPhone: txDb.customer_phone || undefined,
      customerAddress: txDb.customer_address || undefined,
      customerId: txDb.customer_id || undefined,
      cashierName: txDb.cashier_name,
      items,
      subtotal: Number(txDb.subtotal),
      tax: Number(txDb.tax),
      discountAmount: Number(txDb.discount_amount),
      total: Number(txDb.total),
      cashReceived: txDb.cash_received != null ? Number(txDb.cash_received) : undefined,
      changeDue: txDb.change_due != null ? Number(txDb.change_due) : undefined,
      paymentMethod: txDb.payment_method,
      paymentStatus: txDb.payment_status || undefined,
      wholesaleMeta: txDb.wholesale_meta || undefined,
      status: txDb.status,
    };

    const copyType = normalizeInvoiceCopyType(String(req.body?.copyType || '')) || 'Duplicate Copy';
    const settingsRes = await pool.query(`SELECT * FROM store_settings WHERE id = 'default' LIMIT 1`);
    const settings = settingsRes.rows[0] || {};
    const activeShopProfile = Array.isArray(settings.shop_profiles)
      ? settings.shop_profiles.find((p: any) => p.id === activeShopId)
      : null;
    const activeShopName = activeShopProfile?.name || settings.store_name;

    const printSequence = Math.max(1, Number(req.body?.printSequence) || 1);
    const watermarkText = copyType === 'Reprinted Invoice' ? 'REPRINTED' : copyType.toUpperCase();
    const caption = String(req.body?.message || '').trim() || [
      `Invoice ${tx.invoiceNumber}`,
      `Customer: ${tx.customerName}`,
      `Total: Rs.${Number(tx.total).toFixed(2)}`,
      `Copy Type: ${copyType}`,
      `From: ${activeShopName}`,
    ].join('\n');

    const pdfFileName = `${tx.invoiceNumber}-${copyType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
    const pdfBuffer = await buildInvoicePdfBuffer(
      tx,
      activeShopName,
      {
        copyType,
        printSequence,
        watermarkText,
        secondaryWatermarkText: copyType === 'Reprinted Invoice' ? 'DUPLICATE COPY' : '',
      },
      activeShopProfile?.logoUrl || settings.logo_url || '',
      activeShopProfile?.invoiceCompanyMeta
    );

    const providerResponse = await sendInvoiceWhatsApp(to, pdfBuffer, pdfFileName, caption);

    // Write Activity Log
    const actId = `act-${Date.now()}`;
    await pool.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1, $2, NOW(), $3, $4, 'Invoice Shared via WhatsApp PDF', $5)`,
      [actId, activeShopId, authUser?.name || 'System', authUser?.role || 'Store Manager', `Invoice ${tx.invoiceNumber} (${copyType}) PDF sent to WhatsApp ${to}.`]
    );

    res.json({ success: true, channel: 'whatsapp', invoiceNumber: tx.invoiceNumber, to, copyType, providerResponse });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoice-print-audit
router.get('/invoice-print-audit', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);
  const { fromDate, toDate, copyType, status, printedBy, invoiceNumber } = req.query;

  try {
    let sql = `
      SELECT 
        l.id, l.shop_id, l.transaction_id, l.invoice_number, l.copy_type AS copy_type, l.print_sequence AS print_sequence, l.printed_by AS printed_by, l.printed_at AS printed_at, l.reason,
        t.status AS transaction_status,
        t.payment_method,
        t.date AS transaction_date,
        t.customer_name,
        t.total AS total_amount
      FROM invoice_print_logs l
      JOIN sales_transactions t ON l.transaction_id = t.id
      WHERE l.shop_id = $1
    `;
    const values: any[] = [activeShopId];
    let idx = 2;

    if (fromDate) {
      sql += ` AND l.printed_at >= $${idx++}`;
      values.push(new Date(String(fromDate)));
    }
    if (toDate) {
      const end = new Date(String(toDate));
      end.setHours(23, 59, 59, 999);
      sql += ` AND l.printed_at <= $${idx++}`;
      values.push(end);
    }
    if (copyType) {
      sql += ` AND l.copy_type = $${idx++}`;
      values.push(copyType);
    }
    if (status) {
      sql += ` AND t.status = $${idx++}`;
      values.push(status);
    }
    if (printedBy) {
      sql += ` AND l.printed_by ILIKE $${idx++}`;
      values.push(`%${printedBy}%`);
    }
    if (invoiceNumber) {
      sql += ` AND l.invoice_number ILIKE $${idx++}`;
      values.push(`%${invoiceNumber}%`);
    }

    sql += ' ORDER BY l.printed_at DESC, l.print_sequence DESC';

    const result = await pool.query(sql, values);
    const rows = result.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id,
      transactionId: row.transaction_id,
      invoiceNumber: row.invoice_number,
      copyType: row.copy_type,
      printSequence: row.print_sequence,
      printedBy: row.printed_by,
      printedAt: row.printed_at instanceof Date ? row.printed_at.toISOString() : String(row.printed_at),
      reason: row.reason || undefined,
      transactionStatus: row.transaction_status,
      paymentMethod: row.payment_method,
      transactionDate: row.transaction_date,
      customerName: row.customer_name,
      totalAmount: Number(row.total_amount),
    }));

    const uniqueInvoices = Array.from(new Set(rows.map((r) => r.transactionId))).length;
    const uniquePrintedBy = Array.from(new Set(rows.map((r) => r.printedBy))).sort((a, b) => a.localeCompare(b));

    res.json({
      filters: {
        fromDate,
        toDate,
        invoiceNumber,
        printedBy,
        status,
        copyType,
        page: 1,
        pageSize: 20,
      },
      summary: {
        totalRows: rows.length,
        uniqueInvoices,
        uniquePrintedByCount: uniquePrintedBy.length,
      },
      uniquePrintedBy,
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoice-print-audit/export.csv
router.get('/invoice-print-audit/export.csv', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);
  const { fromDate, toDate, copyType, status, printedBy, invoiceNumber } = req.query;

  try {
    let sql = `
      SELECT 
        l.id, l.shop_id, l.transaction_id, l.invoice_number, l.copy_type, l.print_sequence, l.printed_by, l.printed_at, l.reason,
        t.status AS transaction_status,
        t.payment_method,
        t.date AS transaction_date,
        t.customer_name,
        t.total AS total_amount
      FROM invoice_print_logs l
      JOIN sales_transactions t ON l.transaction_id = t.id
      WHERE l.shop_id = $1
    `;
    const values: any[] = [activeShopId];
    let idx = 2;

    if (fromDate) {
      sql += ` AND l.printed_at >= $${idx++}`;
      values.push(new Date(String(fromDate)));
    }
    if (toDate) {
      const end = new Date(String(toDate));
      end.setHours(23, 59, 59, 999);
      sql += ` AND l.printed_at <= $${idx++}`;
      values.push(end);
    }
    if (copyType) {
      sql += ` AND l.copy_type = $${idx++}`;
      values.push(copyType);
    }
    if (status) {
      sql += ` AND t.status = $${idx++}`;
      values.push(status);
    }
    if (printedBy) {
      sql += ` AND l.printed_by ILIKE $${idx++}`;
      values.push(`%${printedBy}%`);
    }
    if (invoiceNumber) {
      sql += ` AND l.invoice_number ILIKE $${idx++}`;
      values.push(`%${invoiceNumber}%`);
    }

    sql += ' ORDER BY l.printed_at DESC, l.print_sequence DESC';

    const result = await pool.query(sql, values);

    let csv = 'Invoice,Date,Customer,Total,Copy Type,Sequence,Printed By,Printed At,Reason,Tx Status,Payment\n';
    result.rows.forEach((r) => {
      const escapedCustomer = `"${r.customer_name.replace(/"/g, '""')}"`;
      const escapedReason = `"${(r.reason || '').replace(/"/g, '""')}"`;
      csv += `${r.invoice_number},${new Date(r.transaction_date).toISOString().split('T')[0]},${escapedCustomer},${Number(r.total_amount).toFixed(2)},${r.copy_type},${r.print_sequence},${r.printed_by},${new Date(r.printed_at).toLocaleString()},${escapedReason},${r.transaction_status},${r.payment_method}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=invoice-print-audit.csv');
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Refund route
router.post('/:id/refund', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  const { reason } = req.body || {};
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(req);
  const transactionId = req.params.id;

  try {
    await refundTransaction(transactionId, activeShopId, reason, authUser?.name || 'Manager', authUser?.role || 'Store Manager');
    res.json({ success: true, id: transactionId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
