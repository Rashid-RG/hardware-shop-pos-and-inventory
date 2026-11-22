import { Router } from 'express';
import { requireRole, getActiveShopContext, AppRequest } from '../middleware';
import { pool, insertProduct, updateProduct, deleteProduct } from '../db';
import { Product, ProductVariant } from '../../src/types';

const router = Router();

// Validation and Normalization Helpers
const normalizeVariantAttributes = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  return Object.fromEntries(entries);
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const ensureNonNegative = (label: string, value: unknown): string | null => {
  if (!isFiniteNumber(Number(value))) {
    return `${label} must be a valid number`;
  }
  if (Number(value) < 0) {
    return `${label} cannot be negative`;
  }
  return null;
};

const validateVariants = (variants: ProductVariant[] | undefined): string | null => {
  if (!variants || variants.length === 0) {
    return null;
  }

  const skuSet = new Set<string>();
  const barcodeSet = new Set<string>();
  for (let i = 0; i < variants.length; i += 1) {
    const variant = variants[i];
    const label = `Variant ${i + 1}`;
    if (!String(variant.name || '').trim()) {
      return `${label} name is required`;
    }
    if (!String(variant.sku || '').trim()) {
      return `${label} SKU is required`;
    }
    if (!String(variant.barcode || '').trim()) {
      return `${label} barcode is required`;
    }

    const skuKey = String(variant.sku).trim().toLowerCase();
    const barcodeKey = String(variant.barcode).trim().toLowerCase();
    if (skuSet.has(skuKey)) {
      return `${label} SKU must be unique within product variants`;
    }
    if (barcodeSet.has(barcodeKey)) {
      return `${label} barcode must be unique within product variants`;
    }
    skuSet.add(skuKey);
    barcodeSet.add(barcodeKey);

    const numericChecks: Array<[string, unknown]> = [
      [`${label} cost price`, variant.costPrice],
      [`${label} retail price`, variant.sellingPrice],
      [`${label} wholesale price`, variant.wholesalePrice ?? 0],
      [`${label} dealer price`, variant.dealerPrice ?? 0],
      [`${label} stock quantity`, variant.quantity],
      [`${label} reorder level`, variant.reorderLevel],
    ];

    for (const [field, value] of numericChecks) {
      const check = ensureNonNegative(field, value);
      if (check) {
        return check;
      }
    }
  }

  return null;
};

const validateProductPayload = (payload: Omit<Product, 'id' | 'shopId'>): string | null => {
  if (!payload.name.trim()) {
    return 'Product name is required';
  }
  if (!payload.sku.trim()) {
    return 'Product SKU is required';
  }
  if (!payload.barcode.trim()) {
    return 'Product barcode is required';
  }
  if (!payload.category.trim()) {
    return 'Product category is required';
  }

  const numericChecks: Array<[string, unknown]> = [
    ['Cost price', payload.costPrice],
    ['Retail price', payload.sellingPrice],
    ['Wholesale price', payload.wholesalePrice ?? 0],
    ['Dealer price', payload.dealerPrice ?? 0],
    ['Stock quantity', payload.quantity],
    ['Reorder level', payload.reorderLevel],
  ];

  for (const [field, value] of numericChecks) {
    const check = ensureNonNegative(field, value);
    if (check) {
      return check;
    }
  }

  return validateVariants(payload.variants);
};

const normalizeProductVariants = (rawVariants: unknown, fallback: { name: string; sku: string; barcode: string; costPrice: number; sellingPrice: number; quantity: number; reorderLevel: number; wholesalePrice: number; dealerPrice: number }): ProductVariant[] => {
  if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
    return [];
  }

  return rawVariants.map((variant: any, index) => {
    const variantName = String(variant?.name || `${fallback.name} Variant ${index + 1}`).trim();
    const sku = String(variant?.sku || `${fallback.sku}-V${index + 1}`).trim();
    const barcode = String(variant?.barcode || `${fallback.barcode}${index + 1}`).trim();
    const costPrice = Number(variant?.costPrice ?? fallback.costPrice) || 0;
    const sellingPrice = Number(variant?.sellingPrice ?? fallback.sellingPrice) || 0;
    const quantity = Number(variant?.quantity ?? 0) || 0;
    const reorderLevel = Number(variant?.reorderLevel ?? fallback.reorderLevel) || 0;
    const wholesalePrice = Number(variant?.wholesalePrice ?? 0) || 0;
    const dealerPrice = Number(variant?.dealerPrice ?? 0) || 0;

    return {
      id: String(variant?.id || `var-${Date.now()}-${index + 1}`),
      name: variantName,
      unit: String(variant?.unit || 'Piece').trim() || 'Piece',
      sku,
      barcode,
      qrCode: variant?.qrCode ? String(variant.qrCode) : undefined,
      costPrice,
      sellingPrice,
      wholesalePrice,
      dealerPrice,
      quantity,
      reorderLevel,
      weight: variant?.weight != null ? Number(variant.weight) : undefined,
      attributes: normalizeVariantAttributes(variant?.attributes),
    };
  });
};

const normalizeIncomingProduct = (body: any, previous?: Product): Omit<Product, 'id' | 'shopId'> => {
  const name = String(body?.name || previous?.name || '').trim();
  const sku = String(body?.sku || previous?.sku || '').trim();
  const barcode = String(body?.barcode || previous?.barcode || '').trim();
  const category = String(body?.category || previous?.category || '').trim();
  const brand = String(body?.brand || previous?.brand || '').trim();

  const base = {
    name,
    sku,
    barcode,
    costPrice: Number(body?.costPrice ?? previous?.costPrice ?? 0) || 0,
    sellingPrice: Number(body?.sellingPrice ?? previous?.sellingPrice ?? 0) || 0,
    quantity: Number(body?.quantity ?? previous?.quantity ?? 0) || 0,
    reorderLevel: Number(body?.reorderLevel ?? previous?.reorderLevel ?? 0) || 0,
    wholesalePrice: Number(body?.wholesalePrice ?? previous?.wholesalePrice ?? 0) || 0,
    dealerPrice: Number(body?.dealerPrice ?? previous?.dealerPrice ?? 0) || 0,
  };

  const variants = normalizeProductVariants(body?.variants, base);
  const primaryVariant = variants[0];
  const quantity = variants.length > 0 ? variants.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) : base.quantity;

  return {
    name,
    sku: primaryVariant?.sku || sku,
    barcode: primaryVariant?.barcode || barcode,
    qrCode: String(body?.qrCode || previous?.qrCode || '').trim() || undefined,
    internalCode: body?.internalCode ? String(body.internalCode).trim().toUpperCase() : previous?.internalCode,
    imageUrl: String(body?.imageUrl || previous?.imageUrl || '').trim() || '',
    images: Array.isArray(body?.images) ? body.images.map((item: unknown) => String(item || '').trim()).filter(Boolean) : (previous?.images || []),
    brand,
    category,
    description: String(body?.description || previous?.description || '').trim(),
    longDescription: String(body?.longDescription || previous?.longDescription || '').trim() || undefined,
    status: body?.status === 'Inactive' ? 'Inactive' : 'Active',
    costPrice: primaryVariant?.costPrice ?? base.costPrice,
    sellingPrice: primaryVariant?.sellingPrice ?? base.sellingPrice,
    wholesalePrice: primaryVariant?.wholesalePrice ?? base.wholesalePrice,
    dealerPrice: primaryVariant?.dealerPrice ?? base.dealerPrice,
    quantity,
    reorderLevel: primaryVariant?.reorderLevel ?? base.reorderLevel,
    warranty: String(body?.warranty || previous?.warranty || 'No Warranty').trim() || 'No Warranty',
    location: String(body?.location || previous?.location || '').trim() || undefined,
    variants: variants.length > 0 ? variants : undefined,
  };
};

const applyProductStockDelta = (product: Product, delta: number): Product => {
  const stockDelta = Number(delta) || 0;
  const nextProduct: Product = {
    ...product,
    variants: Array.isArray(product.variants) ? product.variants.map((variant) => ({ ...variant })) : product.variants,
  };

  if (stockDelta === 0) {
    return nextProduct;
  }

  if (!Array.isArray(nextProduct.variants) || nextProduct.variants.length === 0) {
    nextProduct.quantity = Math.max(0, Number(nextProduct.quantity || 0) + stockDelta);
    return nextProduct;
  }

  if (stockDelta > 0) {
    nextProduct.variants[0].quantity = Math.max(0, Number(nextProduct.variants[0].quantity || 0) + stockDelta);
  } else {
    let remaining = Math.abs(stockDelta);
    for (const variant of nextProduct.variants) {
      if (remaining <= 0) {
        break;
      }

      const currentQty = Math.max(0, Number(variant.quantity || 0));
      const reduction = Math.min(currentQty, remaining);
      variant.quantity = currentQty - reduction;
      remaining -= reduction;
    }
  }

  nextProduct.quantity = nextProduct.variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.quantity || 0)), 0);
  return nextProduct;
};

// Endpoints
router.post('/', requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(req);
  const normalizedPayload = normalizeIncomingProduct(req.body);
  const payloadError = validateProductPayload(normalizedPayload);
  if (payloadError) {
    return res.status(400).json({ error: payloadError });
  }

  const newProduct: Product = {
    ...normalizedPayload,
    id: 'prod-' + Date.now(),
    shopId: activeShopId,
    imageUrl: normalizedPayload.imageUrl || '',
    quantity: Number(normalizedPayload.quantity) || 0,
    costPrice: Number(normalizedPayload.costPrice) || 0,
    sellingPrice: Number(normalizedPayload.sellingPrice) || 0,
    reorderLevel: Number(normalizedPayload.reorderLevel) || 10,
  };

  try {
    await insertProduct(newProduct);

    // Add stock ledger entry if starting with quantity > 0
    if (newProduct.quantity > 0) {
      await pool.query(
        `INSERT INTO stock_logs (id, shop_id, date, product_id, product_name, type, quantity, reason, user_name)
         VALUES ($1, $2, NOW(), $3, $4, 'Stock In', $5, 'Initial Product Registration Intake', $6)`,
        ['log-' + Date.now(), activeShopId, newProduct.id, newProduct.name, newProduct.quantity, authUser?.name || 'System']
      );
    }

    await pool.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1, $2, NOW(), $3, $4, 'Added Product', $5)`,
      ['act-' + Date.now(), activeShopId, authUser?.name || 'SystemAdmin', authUser?.role || 'Super Admin', `Added ${newProduct.name} (SKU: ${newProduct.sku}) into catalog.`]
    );

    res.json(newProduct);
  } catch (err: any) {
    console.error('Error inserting product:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);
  const authUser = (req as AppRequest).authUser;
  const productId = req.params.id;

  try {
    const checkRes = await pool.query('SELECT * FROM products WHERE id = $1 AND shop_id = $2', [productId, activeShopId]);
    if (checkRes.rowCount === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const oldProductRow = checkRes.rows[0];
    const oldProduct: Product = {
      id: oldProductRow.id,
      shopId: oldProductRow.shop_id,
      name: oldProductRow.name,
      sku: oldProductRow.sku,
      barcode: oldProductRow.barcode,
      qrCode: oldProductRow.qr_code || undefined,
      internalCode: oldProductRow.internal_code || undefined,
      imageUrl: oldProductRow.image_url || undefined,
      images: Array.isArray(oldProductRow.images_json) ? oldProductRow.images_json : undefined,
      brand: oldProductRow.brand,
      category: oldProductRow.category,
      costPrice: Number(oldProductRow.cost_price),
      sellingPrice: Number(oldProductRow.selling_price),
      wholesalePrice: Number(oldProductRow.wholesale_price || 0),
      dealerPrice: Number(oldProductRow.dealer_price || 0),
      quantity: Number(oldProductRow.quantity),
      reorderLevel: Number(oldProductRow.reorder_level),
      longDescription: oldProductRow.long_description || undefined,
      status: oldProductRow.status as any,
      warranty: oldProductRow.warranty,
      description: oldProductRow.description,
      location: oldProductRow.location || undefined,
      variants: Array.isArray(oldProductRow.variants_json) ? oldProductRow.variants_json : undefined,
    };

    const oldQty = oldProduct.quantity;
    const normalizedPayload = normalizeIncomingProduct(req.body, oldProduct);
    const variantsProvided = Array.isArray(req.body?.variants);
    const payloadError = validateProductPayload(normalizedPayload);
    if (payloadError) {
      return res.status(400).json({ error: payloadError });
    }
    const newQty = Number(normalizedPayload.quantity);

    // If quantity differs, log a quick audit log
    if (oldQty !== newQty) {
      await pool.query(
        `INSERT INTO stock_logs (id, shop_id, date, product_id, product_name, type, quantity, reason, user_name)
         VALUES ($1, $2, NOW(), $3, $4, 'Stock Adjust', $5, $6, $7)`,
        [
          'log-' + Date.now(),
          activeShopId,
          productId,
          req.body.name || oldProduct.name,
          newQty - oldQty,
          req.body.reason || 'Manual Adjustment Audit Update',
          authUser?.name || 'Supervisor'
        ]
      );
    }

    const updatedProduct = {
      ...oldProduct,
      ...normalizedPayload,
      variants: variantsProvided ? normalizedPayload.variants : oldProduct.variants,
      costPrice: Number(normalizedPayload.costPrice),
      sellingPrice: Number(normalizedPayload.sellingPrice),
      reorderLevel: Number(normalizedPayload.reorderLevel),
    };

    const finalProduct = variantsProvided
      ? { ...updatedProduct, quantity: newQty }
      : applyProductStockDelta({ ...updatedProduct, quantity: oldQty }, newQty - oldQty);

    await updateProduct(productId, finalProduct);

    await pool.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1, $2, NOW(), $3, $4, 'Updated Product', $5)`,
      ['act-' + Date.now(), activeShopId, authUser?.name || 'Admin', authUser?.role || 'Super Admin', `Modified product details/quantity for ${finalProduct.name}.`]
    );

    res.json(finalProduct);
  } catch (err: any) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireRole(['Super Admin']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(req);
  const productId = req.params.id;

  try {
    const checkRes = await pool.query('SELECT * FROM products WHERE id = $1 AND shop_id = $2', [productId, activeShopId]);
    if (checkRes.rowCount === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const deletedProduct = checkRes.rows[0];
    await deleteProduct(productId);

    await pool.query(
      `INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
       VALUES ($1, $2, NOW(), $3, $4, 'Deleted Product', $5)`,
      ['act-' + Date.now(), activeShopId, authUser?.name || 'Admin', authUser?.role || 'Super Admin', `Removed product ${deletedProduct.name} from catalog.`]
    );

    res.json({ success: true, id: productId });
  } catch (err: any) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
