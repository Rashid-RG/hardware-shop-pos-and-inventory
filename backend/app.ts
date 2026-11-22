import express from 'express';
import path from 'path';
import multer from 'multer';
import {
  NODE_ENV,
  IS_PRODUCTION,
  PORT,
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
  CORS_ALLOW_CREDENTIALS,
  isCorsOriginAllowed,
  CONTENT_SECURITY_POLICY,
  UPLOADS_ROOT_DIR,
  PROCESS_STARTED_AT
} from './config';
import { requireAuth, requireRole } from './middleware';
import { pool, loadStateFromNormalized, initDbTables } from './db';

// Import routers
import authRouter from './routes/auth';
import profileRouter from './routes/profile';
import usersRouter from './routes/users';
import productsRouter from './routes/products';
import transactionsRouter from './routes/transactions';
import purchasesRouter from './routes/purchases';
import suppliersRouter from './routes/suppliers';
import customersRouter from './routes/customers';
import employeesRouter from './routes/employees';
import settingsRouter from './routes/settings';
import expensesRouter from './routes/expenses';
import aiRouter from './routes/ai';
import databaseRouter from './routes/database';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// CORS handling middleware
app.use((req, res, next) => {
  const origin = String(req.headers.origin || '').trim();
  if (origin && isCorsOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS.join(', '));
    res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS.join(', '));
    if (CORS_ALLOW_CREDENTIALS) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

app.use(express.json({ limit: '2mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Static uploads route
app.use('/uploads', express.static(UPLOADS_ROOT_DIR));

// Public/Health check routes
app.get('/api/health', async (_req, res) => {
  const dbState = await loadStateFromNormalized();
  res.json({
    ok: true,
    status: 'alive',
    environment: NODE_ENV,
    uptimeSeconds: Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000),
    shopCount: dbState?.settings?.shopProfiles?.length || 0,
  });
});

app.get('/api/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      status: 'ready',
      database: 'reachable',
      sourceOfTruth: 'normalized',
    });
  } catch (error) {
    console.error('Readiness check failed:', error);
    res.status(503).json({
      ok: false,
      status: 'degraded',
      database: 'unreachable',
    });
  }
});

// Public auth routes
app.use('/api/auth', authRouter);
app.use('/api/public/shops', async (_req, res) => {
  // Shops selection list route (needed for login UI)
  const dbState = await loadStateFromNormalized();
  if (!dbState) {
    return res.json({ shops: [] });
  }

  const queryEmail = String(_req.query.email || '').trim().toLowerCase();
  const user = queryEmail ? dbState.users.find((entry) => entry.email.toLowerCase() === queryEmail) : undefined;
  const fixedShopId = user ? (process.env.USER_FIXED_SHOPS || '').split(',').map(e => e.split('=')).find(e => e[0].trim().toLowerCase() === user.email.toLowerCase())?.[1]?.trim() : undefined;

  const shops = (dbState.settings?.shopProfiles || [])
    .filter((shop) => !fixedShopId || String(shop.id) === fixedShopId)
    .map((shop) => ({
      id: String(shop.id),
      name: String(shop.name || shop.id),
      address: String(shop.address || ''),
      phone: String(shop.phone || ''),
    }));

  res.json({ shops });
});

// Multer config
const productImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(UPLOADS_ROOT_DIR, 'products')),
  filename: (_req, file, cb) => {
    const ext = String(file.mimetype || '').split('/')[1] || 'jpg';
    cb(null, `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  },
});

const productImageUpload = multer({
  storage: productImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PNG, JPG, WEBP, and GIF image files are allowed'));
  },
});

const shopLogoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(UPLOADS_ROOT_DIR, 'shops')),
  filename: (_req, file, cb) => {
    const ext = String(file.mimetype || '').split('/')[1] || 'png';
    cb(null, `shop-logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  },
});

const shopLogoUpload = multer({
  storage: shopLogoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PNG, JPG, WEBP, and GIF image files are allowed'));
  },
});

// Authenticated API Routes
app.use('/api', requireAuth);

app.post(
  '/api/uploads/product-image',
  requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']),
  productImageUpload.single('image'),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }
    res.json({ imageUrl: `/uploads/products/${req.file.filename}` });
  }
);

app.post(
  '/api/uploads/shop-logo',
  requireRole(['Super Admin', 'Store Manager']),
  shopLogoUpload.single('image'),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }
    res.json({ imageUrl: `/uploads/shops/${req.file.filename}` });
  }
);

app.use('/api/profile', profileRouter);
app.use('/api/users', usersRouter);
app.use('/api/products', productsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/customers', customersRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/manual-expenses', expensesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/db', databaseRouter);

// Catch-all API 404
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Unhandled errors middleware
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled request error:', error);
  if (res.headersSent) {
    return;
  }

  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof Error) {
    res.status(500).json({ error: IS_PRODUCTION ? 'Internal server error' : error.message });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
});

export default app;
