import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole, getActiveShopContext } from '../middleware';
import { pool, updateStoreSettings, loadStateFromNormalized } from '../db';
import { SHOP_UPLOADS_DIR, getUploadImageExtension, ALLOWED_UPLOAD_IMAGE_TYPES } from '../config';
import { StoreSettings } from '../../src/types';

const router = Router();

const shopLogoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SHOP_UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = getUploadImageExtension(file, '.png');
    cb(null, `shop-logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const shopLogoUpload = multer({
  storage: shopLogoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOAD_IMAGE_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PNG, JPG, WEBP, and GIF image files are allowed'));
  },
});

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { activeShopId } = getActiveShopContext(req);
  try {
    const dbState = await loadStateFromNormalized();
    if (!dbState) {
      return res.status(503).json({ error: 'Database settings not loaded' });
    }
    res.json({
      ...dbState.settings,
      activeShopId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  const payload = req.body || {};
  try {
    const dbState = await loadStateFromNormalized();
    const current = dbState?.settings || {
      taxRate: 18,
      storeName: 'Lanka Smart Hardware',
      currency: 'LKR',
      invoicePrefix: 'SL-INV',
      logoUrl: '',
      address: '',
      phone: '',
      shopQRData: '',
      activeShopId: 'shop-main',
      productCategories: [],
      shopProfiles: [],
    };

    const nextSettings: StoreSettings = {
      taxRate: payload.taxRate === undefined || payload.taxRate === null || payload.taxRate === '' ? current.taxRate : Number(payload.taxRate),
      storeName: String(payload.storeName || current.storeName),
      currency: 'LKR',
      invoicePrefix: String(payload.invoicePrefix || current.invoicePrefix),
      logoUrl: String(payload.logoUrl || current.logoUrl || ''),
      address: String(payload.address || current.address || ''),
      phone: String(payload.phone || current.phone || ''),
      shopQRData: String(payload.shopQRData || current.shopQRData || ''),
      activeShopId: String(payload.activeShopId || current.activeShopId || ''),
      productCategories: Array.isArray(payload.productCategories) ? payload.productCategories : (current.productCategories || []),
      shopProfiles: Array.isArray(payload.shopProfiles) ? payload.shopProfiles : (current.shopProfiles || []),
    };

    await updateStoreSettings(nextSettings);
    res.json(nextSettings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/uploads/shop-logo', requireRole(['Super Admin', 'Store Manager']), shopLogoUpload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required' });
  }
  res.json({ imageUrl: `/uploads/shops/${req.file.filename}` });
});

export default router;
