import { renderArsInvoicePdf } from './src/utils/arsInvoicePdf';
import { purchaseVariant } from './backend/purchaseVariant';
import { initPartialReceivingTables, receivePartialOrder } from './backend/partialReceiving';
import { initArsProfitLedger, recordArsProfitAllocation } from './backend/partnerProfit';
import { checkoutTransaction, refundTransaction, createPurchaseOrder, receivePurchaseOrder, updatePurchaseOrderStatus, updateCustomerCreditLimit, addCustomerCreditPayment, insertSupplierPayment, insertSupplier, insertCustomer, createProductWithIntake, updateProductWithAudit, archiveProduct } from './backend/db';
import { invoiceTotals, roundMoney } from './src/utils/invoiceTotals';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { Pool, PoolClient } from 'pg';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
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
} from './src/types';

interface DBState {
  users: UserAccount[];
  products: Product[];
  suppliers: Supplier[];
  customers: Customer[];
  employees: Employee[];
  transactions: SalesTransaction[];
  purchaseOrders: PurchaseOrder[];
  stockLogs: StockLog[];
  activityLogs: ActivityLog[];
  settings: StoreSettings;
  manualExpenses: ManualExpense[];
  supplierPayments: SupplierPayment[];
  quotations: Quotation[];
  cashShifts: CashShift[];
  customerCreditPayments: CustomerCreditPayment[];
  invoicePrintLogs: InvoicePrintLog[];
}

dotenv.config({ path: '.env.local' });
dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const SHUTDOWN_TIMEOUT_MS = 10_000;
const PROCESS_STARTED_AT = Date.now();

const parseCsvList = (value?: string) => (value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const DEV_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const configuredCorsOrigins = parseCsvList(process.env.CORS_ALLOWED_ORIGINS);
const CORS_ALLOWED_ORIGINS = configuredCorsOrigins.length > 0
  ? configuredCorsOrigins
  : (IS_PRODUCTION ? [] : DEV_ALLOWED_ORIGINS);

const CORS_ALLOW_CREDENTIALS = String(process.env.CORS_ALLOW_CREDENTIALS || 'true').toLowerCase() !== 'false';
const CORS_ALLOWED_HEADERS = parseCsvList(process.env.CORS_ALLOWED_HEADERS).length > 0
  ? parseCsvList(process.env.CORS_ALLOWED_HEADERS)
  : ['Authorization', 'Content-Type', 'X-Shop-Id'];
const CORS_ALLOWED_METHODS = parseCsvList(process.env.CORS_ALLOWED_METHODS).length > 0
  ? parseCsvList(process.env.CORS_ALLOWED_METHODS)
  : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

const cspExtraConnectSrc = parseCsvList(process.env.CSP_EXTRA_CONNECT_SRC);
const CSP_CONNECT_SRC = IS_PRODUCTION
  ? Array.from(new Set(["'self'", ...cspExtraConnectSrc]))
  : Array.from(new Set(["'self'", 'http:', 'https:', 'ws:', ...cspExtraConnectSrc]));
const CSP_SCRIPT_SRC = IS_PRODUCTION
  ? "script-src 'self'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
const CSP_STYLE_SRC = "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com";
const CSP_FONT_SRC = "font-src 'self' data: https://fonts.gstatic.com";
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  CSP_SCRIPT_SRC,
  CSP_STYLE_SRC,
  "img-src 'self' data: blob: https:",
  CSP_FONT_SRC,
  `connect-src ${CSP_CONNECT_SRC.join(' ')}`,
  "form-action 'self'",
].join('; ');

const isCorsOriginAllowed = (origin: string) => CORS_ALLOWED_ORIGINS.includes(origin);

if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  throw new Error('PORT must be a valid TCP port between 1 and 65535.');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

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

const UPLOADS_ROOT_DIR = path.join(process.cwd(), 'uploads');
const PRODUCT_UPLOADS_DIR = path.join(UPLOADS_ROOT_DIR, 'products');
const SHOP_UPLOADS_DIR = path.join(UPLOADS_ROOT_DIR, 'shops');
const ALLOWED_UPLOAD_IMAGE_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);
const getUploadImageExtension = (file: Express.Multer.File, fallback = '.jpg') => {
  return ALLOWED_UPLOAD_IMAGE_TYPES.get(file.mimetype) || fallback;
};
if (!fs.existsSync(PRODUCT_UPLOADS_DIR)) {
  fs.mkdirSync(PRODUCT_UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(SHOP_UPLOADS_DIR)) {
  fs.mkdirSync(SHOP_UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_ROOT_DIR));

// Never accept the historical example password for a real account.
const DEFAULT_DEMO_PASSWORD = 'ChangeMe123!';

const requireConfiguredSecret = (name: string, value?: string, minimumLength = 32) => {
  const normalized = String(value || '').trim();
  const weakSecretPattern = /(change[_-]?me|replace[_-]?with|example|password)/i;
  if (normalized.length < minimumLength || weakSecretPattern.test(normalized)) {
    throw new Error(`${name} must be a non-placeholder secret at least ${minimumLength} characters long.`);
  }
  return normalized;
};

const JWT_SECRET = requireConfiguredSecret('JWT_SECRET', process.env.JWT_SECRET);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Refusing to start without PostgreSQL.');
}

const DB_STATE_KEY = 'default';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The legacy Windows server holds mutable state in process memory and replaces
// normalized tables during saves. Only one instance may own a PostgreSQL
// database until all writes have migrated to targeted SQL transactions.
// Session-level advisory lock stays held on this dedicated pooled connection.
const SINGLE_WRITER_LOCK_CLASS = 1642958133;
const SINGLE_WRITER_LOCK_ID = 1;
let singleWriterLease: PoolClient | null = null;

const acquireSingleWriterLease = async () => {
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired',
      [SINGLE_WRITER_LOCK_CLASS, SINGLE_WRITER_LOCK_ID]
    );
    if (!result.rows[0]?.acquired) {
      throw new Error('Another Hardware POS server already owns this database. Stop the duplicate instance before starting.');
    }
    client.on('error', (error) => {
      databaseWriteHealthy = false;
      console.error('Hardware POS single-writer lease connection lost; writes disabled.', error);
    });
    singleWriterLease = client;
  } catch (error) {
    client.release();
    throw error;
  }
};

const releaseSingleWriterLease = async () => {
  if (!singleWriterLease) return;
  const client = singleWriterLease;
  singleWriterLease = null;
  try {
    await client.query('SELECT pg_advisory_unlock($1::integer, $2::integer)', [
      SINGLE_WRITER_LOCK_CLASS, SINGLE_WRITER_LOCK_ID,
    ]);
  } finally {
    client.release();
  }
};
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { failedCount: number; lockUntil: number }>();
const INVOICE_COPY_TYPES: InvoiceCopyType[] = [
  'Original Copy',
  'Duplicate Copy',
  'Office Copy',
  'Accounts Copy',
  'Delivery Copy',
  'Store Copy',
  'Reprinted Invoice',
];

// New databases start without login accounts. The first owner is created via secure setup.
const seedUsers = (): UserAccount[] => [];

const normalizeInvoiceCopyType = (value?: string): InvoiceCopyType | undefined => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return undefined;
  }
  return INVOICE_COPY_TYPES.includes(normalized as InvoiceCopyType)
    ? (normalized as InvoiceCopyType)
    : undefined;
};

const normalizePaymentStatus = (value?: string) => {
  const normalized = String(value || '').trim().toUpperCase();
  const allowed = ['PAID', 'PARTIALLY PAID', 'UNPAID', 'CREDIT SALE', 'CANCELLED'];
  return allowed.includes(normalized) ? normalized : undefined;
};

type InvoicePdfMeta = {
  copyType: InvoiceCopyType;
  printSequence: number;
  watermarkText: string;
  secondaryWatermarkText?: string;
  printedBy?: string;
  printedAt?: string;
};

type InvoicePrintAuditRow = InvoicePrintLog & {
  transactionStatus: string;
  paymentMethod: string;
  transactionDate: string | null;
  customerName: string;
  totalAmount: number;
};

const resolvePrintableLogoBuffer = (logoUrl?: string): Buffer | null => {
  const normalized = String(logoUrl || '').trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('data:image/')) {
    const match = normalized.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
    if (!match) {
      return null;
    }

    return Buffer.from(match[1], 'base64');
  }

  if (normalized.startsWith('/')) {
    const filePath = path.join(process.cwd(), normalized.replace(/^\/+/, ''));
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
  }

  return null;
};

const buildInvoicePdfBuffer = async (
  tx: SalesTransaction,
  activeShopName: string,
  meta: InvoicePdfMeta,
  logoUrl?: string,
  invoiceCompanyMeta?: {
    companyLegalName?: string;
    companyTagline?: string;
    businessRegistrationNo?: string;
    vatRegistrationNo?: string;
    tinNo?: string;
    supportPhone?: string;
    supportEmail?: string;
    websiteUrl?: string;
    socialLinks?: string;
  },
  contact?: { address?: string; phone?: string; email?: string; taxRate?: number }
): Promise<Buffer> => renderArsInvoicePdf(
  tx, activeShopName, meta,
  resolvePrintableLogoBuffer(logoUrl),
  invoiceCompanyMeta, contact,
);

const buildInvoicePrintAuditRows = (
  state: DBState,
  activeShopId: string,
  options: {
    fromDateRaw?: string;
    toDateRaw?: string;
    invoiceNumberRaw?: string;
    printedByRaw?: string;
    statusRaw?: string;
    copyTypeRaw?: string;
  }
) => {
  const fromDateRaw = String(options.fromDateRaw || '').trim();
  const toDateRaw = String(options.toDateRaw || '').trim();
  const invoiceNumberRaw = String(options.invoiceNumberRaw || '').trim().toLowerCase();
  const printedByRaw = String(options.printedByRaw || '').trim().toLowerCase();
  const statusRaw = String(options.statusRaw || '').trim();
  const copyTypeRaw = String(options.copyTypeRaw || '').trim();

  const fromDate = fromDateRaw ? new Date(fromDateRaw) : null;
  const toDate = toDateRaw ? new Date(toDateRaw) : null;
  if (fromDate && Number.isNaN(fromDate.getTime())) {
    throw new Error('Invalid fromDate');
  }
  if (toDate && Number.isNaN(toDate.getTime())) {
    throw new Error('Invalid toDate');
  }

  const copyType = normalizeInvoiceCopyType(copyTypeRaw);

  const rows: InvoicePrintAuditRow[] = state.invoicePrintLogs
    .filter((log) => log.shopId === activeShopId)
    .map((log) => {
      const tx = state.transactions.find((item) => item.id === log.transactionId);
      return {
        ...log,
        transactionStatus: tx?.status || 'Completed',
        paymentMethod: tx?.paymentMethod || '-',
        transactionDate: tx?.date || null,
        customerName: tx?.customerName || '-',
        totalAmount: Number(tx?.total || 0),
      };
    })
    .filter((row) => {
      const printedAt = new Date(row.printedAt);
      if (fromDate && printedAt < fromDate) {
        return false;
      }
      if (toDate) {
        const endDate = new Date(toDate);
        endDate.setHours(23, 59, 59, 999);
        if (printedAt > endDate) {
          return false;
        }
      }
      if (copyType && row.copyType !== copyType) {
        return false;
      }
      if (invoiceNumberRaw && !row.invoiceNumber.toLowerCase().includes(invoiceNumberRaw)) {
        return false;
      }
      if (printedByRaw && !row.printedBy.toLowerCase().includes(printedByRaw)) {
        return false;
      }
      if (statusRaw && row.transactionStatus !== statusRaw) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.printedAt === b.printedAt) {
        return b.printSequence - a.printSequence;
      }
      return new Date(b.printedAt).getTime() - new Date(a.printedAt).getTime();
    });

  const uniquePrintedBy = Array.from(new Set(rows.map((row) => row.printedBy))).sort((a, b) => a.localeCompare(b));

  return {
    rows,
    uniquePrintedBy,
    normalizedFilters: {
      fromDate: fromDateRaw || undefined,
      toDate: toDateRaw || undefined,
      invoiceNumber: invoiceNumberRaw || undefined,
      printedBy: printedByRaw || undefined,
      status: statusRaw || undefined,
      copyType: copyType || undefined,
    },
  };
};

const escapeCsvCell = (value: unknown): string => {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

const parseAllowedShops = (value?: string): string[] | undefined => {
  if (!value) {
    return undefined;
  }
  const shops = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return shops.length > 0 ? Array.from(new Set(shops)) : undefined;
};

const parseFixedShopAssignments = (value?: string): Record<string, string> => {
  if (!value) {
    return {};
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex <= 0) {
        return acc;
      }

      const email = entry.slice(0, separatorIndex).trim().toLowerCase();
      const shopId = entry.slice(separatorIndex + 1).trim();
      if (email && shopId) {
        acc[email] = shopId;
      }
      return acc;
    }, {});
};

const FIXED_SHOP_BY_EMAIL = parseFixedShopAssignments(process.env.USER_FIXED_SHOPS);

const getUserFixedShop = (email: string): string | undefined => {
  return FIXED_SHOP_BY_EMAIL[email.trim().toLowerCase()];
};

const ROLE_ALLOWED_SHOPS: Partial<Record<Role, string[]>> = {
  'Super Admin': parseAllowedShops(process.env.SUPER_ADMIN_ALLOWED_SHOPS),
  'Store Manager': parseAllowedShops(process.env.MANAGER_ALLOWED_SHOPS),
  'Cashier': parseAllowedShops(process.env.CASHIER_ALLOWED_SHOPS),
  'Inventory Staff': parseAllowedShops(process.env.INVENTORY_ALLOWED_SHOPS),
};

const getUserAllowedShops = (user: AuthUser): string[] | undefined => {
  const byRole = ROLE_ALLOWED_SHOPS[user.role];
  return Array.isArray(byRole) && byRole.length > 0 ? byRole : undefined;
};

const getUserRecordId = (email: string) => `usr-${email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

// Users are administered through PostgreSQL. No environment-derived demo users.
type AuthRecord = AuthUser & { passwordHash: string; allowedShopIds?: string[]; fixedShopId?: string };

const resolveUserShopAccess = (user: AuthRecord, requestedShopIdRaw?: string) => {
  const requestedShopId = String(requestedShopIdRaw || '').trim();
  const availableShopIds = (db?.settings?.shopProfiles || []).map((shop) => shop.id);
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

const toAuthRecordFromUser = (user: UserAccount): AuthRecord => ({
  email: user.email,
  name: user.name,
  role: user.role,
  passwordHash: user.passwordHash,
  allowedShopIds: getUserAllowedShops(user),
  fixedShopId: getUserFixedShop(user.email),
});

// Bind JWTs to the current persisted account credentials and role.
const getAuthRevision = (user: UserAccount) => createHash('sha256')
  .update(JSON.stringify([user.id, user.email.toLowerCase(), user.role, user.passwordHash]))
  .digest('hex');

const createAuthToken = async (user: { email: string; name: string; role: Role; scopedShopId?: string; allowedShopIds?: string[]; fixedShopId?: string }) => {
  const currentAccount = db.users.find((account) => account.email.toLowerCase() === user.email.toLowerCase());
  if (!currentAccount) throw new Error('Cannot create session for an unknown account.');
  const sessionId = randomUUID();
  await pool.query(
    "INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '8 hours')",
    [sessionId, currentAccount.id]
  );
  return jwt.sign(
    {
      jti: sessionId,
      authRevision: getAuthRevision(currentAccount),
      email: user.email,
      name: user.name,
      role: user.role,
      scopedShopId: user.scopedShopId,
      allowedShopIds: user.allowedShopIds,
      fixedShopId: user.fixedShopId,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
};

const loginLimiter = rateLimit({
  windowMs: LOGIN_LOCK_WINDOW_MS,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

const normalizeLoginKey = (email: string, ip: string) => `${email.trim().toLowerCase()}::${ip}`;

const getRequestIp = (req: express.Request) => {
  // Express applies its configured trust-proxy policy to req.ip.
  // Never trust caller-supplied X-Forwarded-For directly for login throttling.
  return req.ip || req.socket.remoteAddress || 'unknown';
};

const productImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PRODUCT_UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = getUploadImageExtension(file, '.jpg');
    cb(null, `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const productImageUpload = multer({
  storage: productImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOAD_IMAGE_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PNG, JPG, WEBP, and GIF image files are allowed'));
  },
});

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

// Initialize Gemini Client
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    console.log('Gemini AI Client successfully initialized.');
  } catch (err) {
    console.error('Error initializing Gemini AI SDK client:', err);
  }
} else {
  console.warn('Note: GEMINI_API_KEY environment variable is not defined. AI prediction pages will run in advisory sandbox mode.');
}

// QR Code utility functions
const generateQRCode = async (text: string): Promise<string> => {
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      quality: 0.95,
      margin: 1,
      width: 300,
    });
  } catch (err) {
    console.error('Error generating QR code:', err);
    return '';
  }
};

const generateInvoiceQR = async (invoiceNumber: string, total: number, shopName: string): Promise<string> => {
  const qrText = `INV:${invoiceNumber}|AMOUNT:${total}|SHOP:${shopName}`;
  return generateQRCode(qrText);
};

// Initial Seed Data Functions
const getInitialDbState = () => {
  const initialProducts: Product[] = [
    // Construction Materials
    {
      id: 'prod-1',
      name: 'Supercrete Portland Cement (50kg)',
      sku: 'CON-CEM-001',
      barcode: '8901002230012',
      internalCode: 'YMV',
      brand: 'Supercrete',
      category: 'Construction Materials',
      costPrice: 6.5,
      sellingPrice: 9.5,
      quantity: 120,
      reorderLevel: 50,
      warranty: 'No Warranty',
      description: 'Premium general-purpose Portland cement suitable for all concrete masonry.',
      location: 'Aisle 12, Level 1',
    },
    {
      id: 'prod-2',
      name: 'Red Clay Solid Bricks (Pallet of 500)',
      sku: 'CON-BRK-002',
      barcode: '8901002230029',
      internalCode: 'TSK',
      brand: 'ClayWorks',
      category: 'Construction Materials',
      costPrice: 90.0,
      sellingPrice: 145.0,
      quantity: 25,
      reorderLevel: 8,
      warranty: 'No Warranty',
      description: 'High durability outdoor fired structural clay bricks.',
      location: 'Yard Sector B',
    },
    // Plumbing
    {
      id: 'prod-3',
      name: 'PVC Schedule 40 Pipe 2in x 10ft',
      sku: 'PLU-PVC-001',
      barcode: '8901002230111',
      brand: 'Flowtech',
      category: 'Plumbing',
      costPrice: 3.2,
      sellingPrice: 7.9,
      quantity: 85,
      reorderLevel: 30,
      warranty: '5 Years Manufacturer',
      description: 'Rigid PVC pipe for pressurized water systems and drainage.',
      location: 'Aisle 4, Rack A',
    },
    {
      id: 'prod-4',
      name: 'Brass Quarter-Turn Ball Valve 1/2in',
      sku: 'PLU-VAL-002',
      barcode: '8901002230128',
      brand: 'Flowtech',
      category: 'Plumbing',
      costPrice: 4.8,
      sellingPrice: 11.2,
      quantity: 14, // Low stock on purpose
      reorderLevel: 25,
      warranty: '2 Years Manufacturer',
      description: 'Durable full-port brass shut-off valve with handle.',
      location: 'Aisle 5, Drawer 12',
    },
    // Electrical
    {
      id: 'prod-5',
      name: 'Copper Wire 12/2 WG (100ft NM-B)',
      sku: 'ELE-WIR-001',
      barcode: '8901002230210',
      brand: 'Lumina',
      category: 'Electrical',
      costPrice: 38.0,
      sellingPrice: 65.0,
      quantity: 40,
      reorderLevel: 15,
      warranty: '10 Years Limited',
      description: 'Non-metallic sheathed cable for indoor electrical circuits.',
      location: 'Aisle 9, Rack C',
    },
    {
      id: 'prod-6',
      name: '10W LED Cool White Light Bulb (4-Pack)',
      sku: 'ELE-LED-002',
      barcode: '8901002230227',
      brand: 'Lumina',
      category: 'Electrical',
      costPrice: 5.0,
      sellingPrice: 12.9,
      quantity: 130,
      reorderLevel: 40,
      warranty: '3 Years Warranty',
      description: 'Energy-saving, long-life cool white medium-base LED bulbs.',
      location: 'Aisle 6, Level 2',
    },
    {
      id: 'prod-7',
      name: 'Double Socket Wall Power Outlet 15A',
      sku: 'ELE-SOK-003',
      barcode: '8901002230234',
      brand: 'Lumina',
      category: 'Electrical',
      costPrice: 2.1,
      sellingPrice: 4.9,
      quantity: 18, // Low stock on purpose
      reorderLevel: 30,
      warranty: '1 Year Warranty',
      description: 'Standard residential standard tamper-resistant white power outlets.',
      location: 'Aisle 7, Bin 3',
    },
    // Tools
    {
      id: 'prod-8',
      name: 'Professional Clapping Claw Hammer 16oz',
      sku: 'TOL-HAM-001',
      barcode: '8901002230319',
      brand: 'Titan',
      category: 'Tools',
      costPrice: 8.5,
      sellingPrice: 19.9,
      quantity: 35,
      reorderLevel: 10,
      warranty: 'Lifetime Guarantee',
      description: 'One-piece forged steel heavy-duty carpentry master claw hammer.',
      location: 'Aisle 1, Rack B',
    },
    {
      id: 'prod-9',
      name: '20V Wireless Brushless Drill Set',
      sku: 'TOL-DRI-002',
      barcode: '8901002230326',
      brand: 'Titan',
      category: 'Tools',
      costPrice: 42.0,
      sellingPrice: 99.0,
      quantity: 5, // Low stock on purpose
      reorderLevel: 12,
      warranty: '3 Years Manufacturer',
      description: 'High-torque cordless smart drill with 2 Lion batteries and charger.',
      location: 'Aisle 2, Locked Display',
    },
    // Paints
    {
      id: 'prod-10',
      name: 'Ultimate Exterior White Weather Shield (5 Gallon)',
      sku: 'PNT-EXT-001',
      barcode: '8901002230418',
      brand: 'Apex Paint',
      category: 'Paints',
      costPrice: 55.0,
      sellingPrice: 110.0,
      quantity: 16,
      reorderLevel: 15,
      warranty: '15 Years Protection',
      description: 'All-weather, anti-mold protection exterior dynamic latex paint.',
      location: 'Oil Cabin Section F',
    },
    {
      id: 'prod-11',
      name: 'Premium Polyester Paint Brush 3in',
      sku: 'PNT-BRS-002',
      barcode: '8901002230425',
      brand: 'Apex Paint',
      category: 'Paints',
      costPrice: 1.8,
      sellingPrice: 4.5,
      quantity: 90,
      reorderLevel: 25,
      warranty: 'No Warranty',
      description: 'High-pick up filaments, stainless steel ferrule brush for all paint types.',
      location: 'Aisle 3, Bin B',
    },
    // Safety Equipment
    {
      id: 'prod-12',
      name: 'Heavy Duty Pro Safety Steel Helmet',
      sku: 'SAF-HLM-001',
      barcode: '8901002230517',
      brand: 'Optima Safety',
      category: 'Safety Equipment',
      costPrice: 9.5,
      sellingPrice: 22.0,
      quantity: 48,
      reorderLevel: 15,
      warranty: '1 Year Warranty',
      description: 'High impact ABS industrial grade hardhat helmet with chin protective strap.',
      location: 'Aisle 10, Level 1',
    },
    {
      id: 'prod-13',
      name: 'Nitril Coating Grip Gloves (Size L)',
      sku: 'SAF-GLV-002',
      barcode: '8901002230524',
      brand: 'Optima Safety',
      category: 'Safety Equipment',
      costPrice: 1.2,
      sellingPrice: 3.5,
      quantity: 110,
      reorderLevel: 30,
      warranty: 'No Warranty',
      description: 'Excellent tear and abrasion resistance construction grade gloves.',
      location: 'Aisle 10, Drawer 4',
    }
  ];

  const initialSuppliers: Supplier[] = [
    {
      id: 'sup-1',
      name: 'Titan General Tools Inc.',
      companyName: 'Titan Tools Manufacturing',
      phone: '+1-555-0192',
      email: 'sales@titan-tools.com',
      address: '404 Industrial Parkway, Chicago, IL',
      taxNumber: 'TX-4493010'
    },
    {
      id: 'sup-2',
      name: 'Flowtech PVC Tubings & Valves',
      companyName: 'Flowtech Pipes Ltd.',
      phone: '+1-555-0143',
      email: 'orders@flowtech-pvc.com',
      address: '22 Flow Plaza, Cleveland, OH',
      taxNumber: 'TX-1049283'
    },
    {
      id: 'sup-3',
      name: 'Apex Paint Distributing Co.',
      companyName: 'Apex Paint Industries',
      phone: '+1-555-0111',
      email: 'partners@apex-paint.com',
      address: '88 Color Avenue, Dallas, TX',
      taxNumber: 'TX-9034221'
    },
    {
      id: 'sup-4',
      name: 'Supercrete Portland Cement Corp',
      companyName: 'Supercrete Materials',
      phone: '+1-555-0185',
      email: 'orders@supercrete.com',
      address: '101 Mortar Drive, Houston, TX',
      taxNumber: 'TX-2394019'
    }
  ];

  const initialCustomers: Customer[] = [
    {
      id: 'cust-1',
      name: 'Johnathan Davis',
      phone: '+1-713-555-0122',
      email: 'jdavis.contracting@gmail.com',
      address: '459 Oakwood Lane, Houston, TX',
      loyaltyBalance: 120,
      purchaseCount: 14
    },
    {
      id: 'cust-2',
      name: 'Alice Thompson (DIY Enthusiast)',
      phone: '+1-832-555-0188',
      email: 'alice.thompson@me.com',
      address: '18 Westheimer Rd, Houston, TX',
      loyaltyBalance: 45,
      purchaseCount: 6
    },
    {
      id: 'cust-3',
      name: 'Robert Fletcher (Master Builder)',
      phone: '+1-281-555-0165',
      email: 'fletcher.builders@yahoo.com',
      address: '882 Industrial Blvd, Austin, TX',
      loyaltyBalance: 310,
      purchaseCount: 32
    },
    {
      id: 'cust-walkin',
      name: 'Walk-in Customer',
      phone: '-',
      email: '-',
      address: '-',
      loyaltyBalance: 0,
      purchaseCount: 0
    }
  ];

  const initialEmployees: Employee[] = [
    {
      id: 'emp-1',
      name: 'Sarah Miller',
      role: 'Super Admin',
      phone: '+1-832-555-9001',
      email: 's.miller@hardwarepos.com',
      salary: 5800,
      attendanceStatus: 'Present',
      performanceScore: 98
    },
    {
      id: 'emp-2',
      name: 'Robert Hernandez',
      role: 'Store Manager',
      phone: '+1-832-555-9002',
      email: 'r.hernandez@hardwarepos.com',
      salary: 4200,
      attendanceStatus: 'Present',
      performanceScore: 92
    },
    {
      id: 'emp-3',
      name: 'David Lee',
      role: 'Cashier',
      phone: '+1-832-555-9003',
      email: 'd.lee@hardwarepos.com',
      salary: 3100,
      attendanceStatus: 'Present',
      performanceScore: 89
    },
    {
      id: 'emp-4',
      name: 'Marcus Vance',
      role: 'Inventory Staff',
      phone: '+1-832-555-9004',
      email: 'm.vance@hardwarepos.com',
      salary: 3100,
      attendanceStatus: 'On Leave',
      performanceScore: 84
    }
  ];

  // Past 14 days of realistic sales history spanning different items
  const initialTransactions: SalesTransaction[] = [
    {
      id: 'tx-1',
      invoiceNumber: 'INV-2026-0001',
      date: '2026-05-18T10:15:00Z',
      customerName: 'Robert Fletcher',
      customerId: 'cust-3',
      cashierName: 'David Lee',
      items: [
        { productId: 'prod-1', productName: 'Supercrete Portland Cement (50kg)', quantity: 40, sellingPrice: 9.5, discount: 5 },
        { productId: 'prod-3', productName: 'PVC Schedule 40 Pipe 2in x 10ft', quantity: 20, sellingPrice: 7.9, discount: 0 }
      ],
      subtotal: 538.0,
      tax: 43.04,
      discountAmount: 19.0,
      total: 562.04,
      paymentMethod: 'Bank Transfer'
    },
    {
      id: 'tx-2',
      invoiceNumber: 'INV-2026-0002',
      date: '2026-05-19T14:32:00Z',
      customerName: 'Alice Thompson (DIY Enthusiast)',
      customerId: 'cust-2',
      cashierName: 'David Lee',
      items: [
        { productId: 'prod-8', productName: 'Professional Clapping Claw Hammer 16oz', quantity: 1, sellingPrice: 19.9, discount: 0 },
        { productId: 'prod-11', productName: 'Premium Polyester Paint Brush 3in', quantity: 2, sellingPrice: 4.5, discount: 0 },
        { productId: 'prod-6', productName: '10W LED Cool White Light Bulb (4-Pack)', quantity: 1, sellingPrice: 12.9, discount: 10 }
      ],
      subtotal: 41.8,
      tax: 3.34,
      discountAmount: 1.29,
      total: 43.85,
      paymentMethod: 'Cash'
    },
    {
      id: 'tx-3',
      invoiceNumber: 'INV-2026-0003',
      date: '2026-05-21T09:12:00Z',
      customerName: 'Johnathan Davis',
      customerId: 'cust-1',
      cashierName: 'David Lee',
      items: [
        { productId: 'prod-10', productName: 'Ultimate Exterior White Weather Shield (5 Gallon)', quantity: 4, sellingPrice: 110.0, discount: 8 },
        { productId: 'prod-11', productName: 'Premium Polyester Paint Brush 3in', quantity: 10, sellingPrice: 4.5, discount: 5 }
      ],
      subtotal: 485.0,
      tax: 38.8,
      discountAmount: 37.45,
      total: 486.35,
      paymentMethod: 'Credit Card'
    },
    {
      id: 'tx-4',
      invoiceNumber: 'INV-2026-0004',
      date: '2026-05-23T11:45:00Z',
      customerName: 'Walk-in Customer',
      customerId: 'cust-walkin',
      cashierName: 'David Lee',
      items: [
        { productId: 'prod-6', productName: '10W LED Cool White Light Bulb (4-Pack)', quantity: 3, sellingPrice: 12.9, discount: 0 },
        { productId: 'prod-7', productName: 'Double Socket Wall Power Outlet 15A', quantity: 6, sellingPrice: 4.9, discount: 0 }
      ],
      subtotal: 68.1,
      tax: 5.45,
      discountAmount: 0,
      total: 73.55,
      paymentMethod: 'Mobile Wallet'
    },
    {
      id: 'tx-5',
      invoiceNumber: 'INV-2026-0005',
      date: '2026-05-25T16:20:00Z',
      customerName: 'Robert Fletcher',
      customerId: 'cust-3',
      cashierName: 'David Lee',
      items: [
        { productId: 'prod-1', productName: 'Supercrete Portland Cement (50kg)', quantity: 30, sellingPrice: 9.5, discount: 5 },
        { productId: 'prod-12', productName: 'Heavy Duty Pro Safety Steel Helmet', quantity: 5, sellingPrice: 22.0, discount: 0 },
        { productId: 'prod-13', productName: 'Nitril Coating Grip Gloves (Size L)', quantity: 12, sellingPrice: 3.5, discount: 10 }
      ],
      subtotal: 437.0,
      tax: 34.96,
      discountAmount: 18.45,
      total: 453.51,
      paymentMethod: 'QR Code'
    },
    {
      id: 'tx-6',
      invoiceNumber: 'INV-2026-0006',
      date: '2026-05-27T10:05:00Z',
      customerName: 'Johnathan Davis',
      customerId: 'cust-1',
      cashierName: 'David Lee',
      items: [
        { productId: 'prod-5', productName: 'Copper Wire 12/2 WG (100ft NM-B)', quantity: 5, sellingPrice: 65.0, discount: 0 },
        { productId: 'prod-7', productName: 'Double Socket Wall Power Outlet 15A', quantity: 15, sellingPrice: 4.9, discount: 0 }
      ],
      subtotal: 398.5,
      tax: 31.88,
      discountAmount: 0,
      total: 430.38,
      paymentMethod: 'Credit Card'
    },
    {
      id: 'tx-7',
      invoiceNumber: 'INV-2026-0007',
      date: '2026-05-29T13:40:00Z',
      customerName: 'Walk-in Customer',
      customerId: 'cust-walkin',
      cashierName: 'David Lee',
      items: [
        { productId: 'prod-8', productName: 'Professional Clapping Claw Hammer 16oz', quantity: 2, sellingPrice: 19.9, discount: 0 },
        { productId: 'prod-3', productName: 'PVC Schedule 40 Pipe 2in x 10ft', quantity: 10, sellingPrice: 7.9, discount: 0 }
      ],
      subtotal: 118.8,
      tax: 9.50,
      discountAmount: 0,
      total: 128.30,
      paymentMethod: 'Cash'
    },
    {
      id: 'tx-8',
      invoiceNumber: 'INV-2026-0008',
      date: '2026-05-30T15:55:00Z',
      customerName: 'Robert Fletcher',
      customerId: 'cust-3',
      cashierName: 'David Lee',
      items: [
        { productId: 'prod-9', productName: '20V Wireless Brushless Drill Set', quantity: 2, sellingPrice: 99.0, discount: 5 },
        { productId: 'prod-12', productName: 'Heavy Duty Pro Safety Steel Helmet', quantity: 6, sellingPrice: 22.0, discount: 0 }
      ],
      subtotal: 330.0,
      tax: 26.40,
      discountAmount: 9.9,
      total: 346.50,
      paymentMethod: 'QR Code'
    },
    {
      id: 'tx-9',
      invoiceNumber: 'INV-2026-0009',
      date: '2026-05-31T07:44:00Z',
      customerName: 'Alice Thompson (DIY Enthusiast)',
      customerId: 'cust-2',
      cashierName: 'David Lee',
      items: [
        { productId: 'prod-3', productName: 'PVC Schedule 40 Pipe 2in x 10ft', quantity: 3, sellingPrice: 7.9, discount: 0 },
        { productId: 'prod-4', productName: 'Brass Quarter-Turn Ball Valve 1/2in', quantity: 2, sellingPrice: 11.2, discount: 0 }
      ],
      subtotal: 46.1,
      tax: 3.69,
      discountAmount: 0,
      total: 49.79,
      paymentMethod: 'Cash'
    }
  ];

  const initialPurchaseOrders: PurchaseOrder[] = [
    {
      id: 'po-1',
      poNumber: 'PO-2026-0001',
      date: '2026-05-15T08:00:00Z',
      supplierId: 'sup-4',
      supplierName: 'Supercrete Portland Cement Corp',
      items: [
        { productId: 'prod-1', productName: 'Supercrete Portland Cement (50kg)', quantity: 150, costPrice: 6.5 }
      ],
      total: 975.0,
      status: 'Received'
    },
    {
      id: 'po-2',
      poNumber: 'PO-2026-0002',
      date: '2026-05-24T09:30:00Z',
      supplierId: 'sup-1',
      supplierName: 'Titan General Tools Inc.',
      items: [
        { productId: 'prod-8', productName: 'Professional Clapping Claw Hammer 16oz', quantity: 25, costPrice: 8.5 },
        { productId: 'prod-9', productName: '20V Wireless Brushless Drill Set', quantity: 10, costPrice: 42.0 }
      ],
      total: 632.5,
      status: 'Ordered'
    }
  ];

  const initialStockLogs: StockLog[] = [
    {
      id: 'log-1',
      date: '2026-05-15T14:30:00Z',
      productId: 'prod-1',
      productName: 'Supercrete Portland Cement (50kg)',
      type: 'Stock In',
      quantity: 150,
      reason: 'Purchase order receipt PO-0001',
      user: 'Marcus Vance'
    },
    {
      id: 'log-2',
      date: '2026-05-18T10:15:00Z',
      productId: 'prod-1',
      productName: 'Supercrete Portland Cement (50kg)',
      type: 'Stock Out',
      quantity: 40,
      reason: 'Point of sale billing, Invoice INV-0001',
      user: 'David Lee'
    },
    {
      id: 'log-3',
      date: '2026-05-28T09:00:00Z',
      productId: 'prod-4',
      productName: 'Brass Quarter-Turn Ball Valve 1/2in',
      type: 'Stock Adjust',
      quantity: -2,
      reason: 'Bi-weekly stock discrepancy adjustment',
      user: 'Robert Hernandez'
    }
  ];

  const initialActivityLogs: ActivityLog[] = [
    {
      id: 'act-1',
      date: '2026-05-31T06:00:00Z',
      user: 'Sarah Miller',
      role: 'Super Admin',
      action: 'Log In',
      details: 'Super Admin logged in from system gateway'
    },
    {
      id: 'act-2',
      date: '2026-05-31T07:05:00Z',
      user: 'Marcus Vance',
      role: 'Inventory Staff',
      action: 'Audited Aisle 4',
      details: 'Conducted manual audit verification of PVC parts'
    }
  ];

  return {
    users: seedUsers(),
    products: initialProducts,
    suppliers: initialSuppliers,
    customers: initialCustomers,
    employees: initialEmployees,
    transactions: initialTransactions,
    purchaseOrders: initialPurchaseOrders,
    stockLogs: initialStockLogs,
    activityLogs: initialActivityLogs,
    settings: {
      taxRate: 0,
      storeName: 'Lanka Smart Hardware',
      currency: 'LKR',
      invoicePrefix: 'SL-INV',
      logoUrl: '',
      shopQRData: '',
      activeShopId: 'shop-main',
      productCategories: [
        'Construction Materials',
        'Plumbing',
        'Electrical',
        'Tools',
        'Paints',
        'Safety Equipment',
      ],
      shopProfiles: [
        {
          id: 'shop-main',
          name: 'Lanka Smart Hardware',
          logoUrl: '',
          address: '',
          phone: '',
          taxRate: 0,
          invoicePrefix: 'SL-INV',
        },
      ],
    },
    manualExpenses: [
      { id: 'exp-1', desc: 'Electricity monthly bill block', amount: 350.0, date: '2026-05-15', category: 'Utilities' },
      { id: 'exp-2', desc: 'Aisle 3 fluorescent bulb lights restock', amount: 80.0, date: '2026-05-20', category: 'Maintenance' },
      { id: 'exp-3', desc: 'Store floor rent installment', amount: 1500.0, date: '2026-05-01', category: 'Rent' },
    ],
    supplierPayments: [],
    quotations: [],
    cashShifts: [],
    customerCreditPayments: [],
    invoicePrintLogs: [],
  };
};

// Fresh business databases must not inherit demonstration products, people,
// invoices, expenses or old shop branding. Existing databases are never reset
// by this initializer: loadDb invokes it only if no normalized/app_state data exists.
const getCleanBusinessState = () => {
  const demo = getInitialDbState();
  return {
    ...demo,
    users: [],
    products: [],
    suppliers: [],
    customers: [],
    employees: [],
    transactions: [],
    purchaseOrders: [],
    stockLogs: [],
    activityLogs: [],
    manualExpenses: [],
    supplierPayments: [],
    quotations: [],
    cashShifts: [],
    customerCreditPayments: [],
    invoicePrintLogs: [],
    settings: {
      ...demo.settings,
      storeName: 'ARS Hardware',
      logoUrl: '',
      address: '',
      phone: '',
      taxRate: 0,
      invoicePrefix: 'ARS-INV',
      shopProfiles: [{
        id: 'shop-main',
        name: 'ARS Hardware',
        logoUrl: '',
        address: '',
        phone: '',
        taxRate: 0,
        invoicePrefix: 'ARS-INV',
        printFormat: 'a4' as const,
      }],
    },
  };
};

// Database state accessor
let db: DBState;

const normalizeState = (state: DBState): DBState => ({
  ...state,
  settings: (() => {
    const rawProfiles = Array.isArray(state.settings?.shopProfiles) ? state.settings.shopProfiles : [];
    const fallbackProfile = {
      id: 'shop-main',
      name: state.settings?.storeName || 'Lanka Smart Hardware',
      logoUrl: state.settings?.logoUrl || '',
      address: state.settings?.address || '',
      phone: state.settings?.phone || '',
      taxRate: Number(state.settings?.taxRate || 0),
      invoicePrefix: state.settings?.invoicePrefix || 'SL-INV',
      printFormat: 'a4' as const,
    };

    const shopProfiles = (rawProfiles.length > 0 ? rawProfiles : [fallbackProfile]).map((shop, index) => ({
      id: String(shop.id || `shop-${index + 1}`),
      name: String(shop.name || `Shop ${index + 1}`),
      logoUrl: String(shop.logoUrl || ''),
      address: String(shop.address || ''),
      phone: String(shop.phone || ''),
      taxRate: Number(shop.taxRate || state.settings?.taxRate || 0),
      invoicePrefix: String(shop.invoicePrefix || state.settings?.invoicePrefix || 'SL-INV'),
      printFormat: (shop.printFormat === 'thermal' ? 'thermal' : 'a4') as 'a4' | 'thermal',
      invoiceCompanyMeta: {
        companyLegalName: String(shop?.invoiceCompanyMeta?.companyLegalName || ''),
        companyTagline: String(shop?.invoiceCompanyMeta?.companyTagline || 'Hardware Import & Wholesale Distribution'),
        businessRegistrationNo: String(shop?.invoiceCompanyMeta?.businessRegistrationNo || ''),
        vatRegistrationNo: String(shop?.invoiceCompanyMeta?.vatRegistrationNo || ''),
        tinNo: String(shop?.invoiceCompanyMeta?.tinNo || ''),
        supportPhone: String(shop?.invoiceCompanyMeta?.supportPhone || ''),
        supportEmail: String(shop?.invoiceCompanyMeta?.supportEmail || ''),
        websiteUrl: String(shop?.invoiceCompanyMeta?.websiteUrl || ''),
        socialLinks: String(shop?.invoiceCompanyMeta?.socialLinks || ''),
      },
    }));

    const requestedActiveId = String(state.settings?.activeShopId || shopProfiles[0].id);
    const activeShop = shopProfiles.find((shop) => shop.id === requestedActiveId) || shopProfiles[0];
    const productCategories = Array.from(
      new Set(
        [
          'Construction Materials',
          'Plumbing',
          'Electrical',
          'Tools',
          'Paints',
          'Safety Equipment',
          ...(Array.isArray(state.settings?.productCategories) ? state.settings.productCategories : []),
        ]
          .map((category) => String(category || '').trim())
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right));

    return {
      taxRate: Number(activeShop.taxRate || state.settings?.taxRate || 0),
      storeName: activeShop.name,
      currency: 'LKR',
      invoicePrefix: String(activeShop.invoicePrefix || 'SL-INV'),
      logoUrl: String(activeShop.logoUrl || ''),
      address: String(activeShop.address || state.settings?.address || ''),
      phone: String(activeShop.phone || state.settings?.phone || ''),
      shopQRData: String(state.settings?.shopQRData || ''),
      activeShopId: activeShop.id,
      productCategories,
      shopProfiles,
    };
  })(),
  products: Array.isArray(state.products) ? state.products.map((item) => ({ ...item, shopId: item.shopId || state.settings?.activeShopId || 'shop-main' })) : [],
  suppliers: Array.isArray(state.suppliers) ? state.suppliers.map((item) => ({ ...item, shopId: item.shopId || state.settings?.activeShopId || 'shop-main' })) : [],
  customers: Array.isArray(state.customers) ? state.customers.map((item) => ({ ...item, shopId: item.shopId || state.settings?.activeShopId || 'shop-main' })) : [],
  employees: Array.isArray(state.employees) ? state.employees.map((item) => ({ ...item, shopId: item.shopId || state.settings?.activeShopId || 'shop-main' })) : [],
  transactions: Array.isArray(state.transactions) ? state.transactions.map((item) => ({ ...item, shopId: item.shopId || state.settings?.activeShopId || 'shop-main' })) : [],
  purchaseOrders: Array.isArray(state.purchaseOrders) ? state.purchaseOrders.map((item) => ({ ...item, shopId: item.shopId || state.settings?.activeShopId || 'shop-main' })) : [],
  stockLogs: Array.isArray(state.stockLogs) ? state.stockLogs.map((item) => ({ ...item, shopId: item.shopId || state.settings?.activeShopId || 'shop-main' })) : [],
  activityLogs: Array.isArray(state.activityLogs) ? state.activityLogs.map((item) => ({ ...item, shopId: item.shopId || state.settings?.activeShopId || 'shop-main' })) : [],
  manualExpenses: Array.isArray(state.manualExpenses) ? state.manualExpenses : [],
  supplierPayments: Array.isArray(state.supplierPayments) ? state.supplierPayments : [],
  quotations: Array.isArray(state.quotations) ? state.quotations : [],
  cashShifts: Array.isArray(state.cashShifts) ? state.cashShifts : [],
  customerCreditPayments: Array.isArray(state.customerCreditPayments) ? state.customerCreditPayments : [],
  invoicePrintLogs: Array.isArray(state.invoicePrintLogs) ? state.invoicePrintLogs : [],
  users: Array.isArray(state.users)
    ? state.users.map((user, index) => ({
        id: String(user.id || `user-${index + 1}`),
        email: String(user.email || '').trim().toLowerCase(),
        name: String(user.name || user.email || `User ${index + 1}`),
        role: (['Super Admin', 'Store Manager', 'Cashier', 'Inventory Staff'].includes(user.role) ? user.role : 'Cashier') as Role,
        passwordHash: String(user.passwordHash || ''),
        createdAt: user.createdAt || new Date().toISOString(),
        updatedAt: user.updatedAt || new Date().toISOString(),
      }))
    : seedUsers(),
});

const getRequestedShopId = (req?: express.Request): string | null => {
  if (!req) {
    return null;
  }

  const headerValue = req.headers['x-shop-id'];
  if (typeof headerValue !== 'string') {
    return null;
  }

  const normalized = headerValue.trim();
  return normalized.length > 0 ? normalized : null;
};

const getActiveShopContext = (state: DBState, req?: express.Request) => {
  const shopProfiles = state.settings.shopProfiles || [];
  const fallbackShopId = shopProfiles[0]?.id || 'shop-main';
  const settingsActiveShopId = state.settings.activeShopId || fallbackShopId;
  const authScopedShopId = (req as AppRequest | undefined)?.authUser?.scopedShopId;
  const authAllowedShopIds = (req as AppRequest | undefined)?.authUser?.allowedShopIds || [];
  const normalizedAllowedShopIds = authAllowedShopIds.filter((shopId) => shopProfiles.some((shop) => shop.id === shopId));
  const roleFallbackShopId = normalizedAllowedShopIds[0] || settingsActiveShopId;
  const requestedShopId = getRequestedShopId(req);
  const requestedShopAllowed = requestedShopId
    && shopProfiles.some((shop) => shop.id === requestedShopId)
    && (normalizedAllowedShopIds.length === 0 || normalizedAllowedShopIds.includes(requestedShopId));
  const activeShopId = authScopedShopId
    ? authScopedShopId
    : (requestedShopAllowed ? (requestedShopId as string) : roleFallbackShopId);
  const activeShop = shopProfiles.find((shop) => shop.id === activeShopId) || null;
  return {
    activeShopId,
    activeShopName: activeShop?.name || state.settings.storeName,
  };
};

const initPostgres = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      -- Do not FK this to users: legacy full-table saves TRUNCATE users CASCADE.
      -- Auth middleware separately verifies that the account still exists.
      user_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0
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

  await pool.query(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS shop_id TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS shop_id TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS shop_id TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS shop_id TEXT;
    ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS shop_id TEXT;
    ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS sales_rep_id TEXT;
    ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS sales_rep_name TEXT;
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

  // New feature tables
  await pool.query(`
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
  `);

  // New independent ARS wholesale tables. Never truncate, rewrite, or cascade
  // existing POS business data when creating import or partner records.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ars_import_shipments (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      purchase_order_id TEXT NOT NULL,
      shipment_reference TEXT NOT NULL,
      origin_country TEXT NOT NULL DEFAULT 'China',
      container_number TEXT NOT NULL DEFAULT '',
      eta_date DATE,
      invoice_currency TEXT NOT NULL DEFAULT 'CNY',
      exchange_rate_lkr NUMERIC(16,6),
      freight_lkr NUMERIC(16,2) NOT NULL DEFAULT 0,
      customs_lkr NUMERIC(16,2) NOT NULL DEFAULT 0,
      clearance_lkr NUMERIC(16,2) NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(shop_id, purchase_order_id),
      UNIQUE(shop_id, shipment_reference)
    );
    CREATE TABLE IF NOT EXISTS ars_business_partners (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ownership_percent NUMERIC(5,2),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE ars_business_partners ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    CREATE TABLE IF NOT EXISTS ars_partner_ownership_audit (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      partner_id TEXT NOT NULL REFERENCES ars_business_partners(id),
      old_percent NUMERIC(5,2),
      new_percent NUMERIC(5,2),
      change_type TEXT NOT NULL CHECK(change_type IN ('Registered','Updated','Deactivated','Reactivated')),
      reference TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ars_partner_ownership_audit_shop_idx ON ars_partner_ownership_audit(shop_id,changed_at DESC);
    CREATE TABLE IF NOT EXISTS ars_partner_capital_entries (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      partner_id TEXT NOT NULL REFERENCES ars_business_partners(id),
      entry_type TEXT NOT NULL CHECK(entry_type IN ('Contribution','Drawing')),
      amount_lkr NUMERIC(16,2) NOT NULL CHECK(amount_lkr > 0),
      entry_date DATE NOT NULL,
      reference TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ars_import_shipments_shop_idx ON ars_import_shipments(shop_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS ars_partner_capital_shop_idx ON ars_partner_capital_entries(shop_id,entry_date DESC);
  `);

  await pool.query(`
    UPDATE products SET shop_id = 'shop-main' WHERE shop_id IS NULL OR shop_id = '';
    ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
    DROP INDEX IF EXISTS products_sku_key;
    CREATE UNIQUE INDEX IF NOT EXISTS products_shop_id_sku_key ON products (shop_id, sku);
  `);
};

const saveAppStateMirror = async (client: PoolClient, state: DBState) => {
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

const saveStateToNormalized = async (client: PoolClient, state: DBState) => {
  // Legacy snapshot saves TRUNCATE purchases with CASCADE. Never erase ARS
  // receipt history via a whole-state rewrite after partial receiving begins.
  const protectedReceipts = await client.query(
    'SELECT EXISTS(SELECT 1 FROM ars_receipt_batches) AS has_receipts'
  );
  if (protectedReceipts.rows[0]?.has_receipts) {
    throw new Error('Legacy full-state rewrite blocked: ARS goods-receipt history exists. Use targeted SQL updates.');
  }
  await client.query(`
    TRUNCATE TABLE sales_transaction_items,
      sales_transactions,
      purchase_order_items,
      purchase_orders,
      stock_logs,
      activity_logs,
      manual_expenses,
      store_settings,
      supplier_payments,
      customer_credit_payments,
      invoice_print_logs,
      users,
      quotations,
      cash_shifts,
      products,
      suppliers,
      customers,
      employees
    RESTART IDENTITY CASCADE;
  `);

  const users = Array.isArray(state.users) ? state.users : seedUsers();
  for (let i = 0; i < users.length; i += 1) {
    const user = users[i];
    const userId = getUserRecordId(user.email);
    await client.query(
      `
      INSERT INTO users (id, email, name, role, password_hash, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()), COALESCE($7, NOW()))
      ON CONFLICT (email)
      DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, updated_at = NOW()
      `,
      [userId, user.email, user.name, user.role, user.passwordHash, user.createdAt || null, user.updatedAt || null]
    );
  }

  for (const product of state.products) {
    await client.query(
      `
      INSERT INTO products (id, shop_id, name, sku, barcode, qr_code, internal_code, image_url, images_json, brand, category, cost_price, selling_price, wholesale_price, dealer_price, quantity, reorder_level, warranty, description, long_description, location, status, variants_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb)
      `,
      [
        product.id,
        product.shopId || null,
        product.name,
        product.sku,
        product.barcode,
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
  }

  for (const supplier of state.suppliers) {
    await client.query(
      `
      INSERT INTO suppliers (id, shop_id, name, company_name, phone, email, address, tax_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [supplier.id, supplier.shopId || null, supplier.name, supplier.companyName, supplier.phone, supplier.email, supplier.address, supplier.taxNumber]
    );
  }

  for (const customer of state.customers) {
    await client.query(
      `
      INSERT INTO customers (id, shop_id, name, phone, email, address, loyalty_balance, purchase_count, credit_limit, credit_balance)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [customer.id, customer.shopId || null, customer.name, customer.phone, customer.email, customer.address, customer.loyaltyBalance, customer.purchaseCount, customer.creditLimit || 0, customer.creditBalance || 0]
    );
  }

  for (const employee of state.employees) {
    await client.query(
      `
      INSERT INTO employees (id, shop_id, name, role, phone, email, salary, attendance_status, performance_score)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [employee.id, employee.shopId || null, employee.name, employee.role, employee.phone, employee.email, employee.salary, employee.attendanceStatus, employee.performanceScore]
    );
  }

  for (const tx of state.transactions) {
    await client.query(
      `
      INSERT INTO sales_transactions (id, shop_id, invoice_number, date, customer_id, customer_name, customer_phone, customer_address, cashier_name, subtotal, tax, discount_amount, total, cash_received, change_due, payment_method, payment_status, wholesale_meta, status, refunded_at, refund_reason, sales_rep_id, sales_rep_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22, $23)
      `,
      [
        tx.id,
        tx.shopId || null,
        tx.invoiceNumber,
        tx.date,
        tx.customerId || null,
        tx.customerName,
        tx.customerPhone || null,
        tx.customerAddress || null,
        tx.cashierName,
        tx.subtotal,
        tx.tax,
        tx.discountAmount,
        tx.total,
        tx.cashReceived ?? null,
        tx.changeDue ?? null,
        tx.paymentMethod,
        tx.paymentStatus || null,
        tx.wholesaleMeta ? JSON.stringify(tx.wholesaleMeta) : null,
        tx.status || 'Completed',
        tx.refundedAt || null,
        tx.refundReason || null,
        tx.salesRepId || null,
        tx.salesRepName || null,
      ]
    );

    for (const item of tx.items) {
      await client.query(
        `
        INSERT INTO sales_transaction_items (transaction_id, product_id, product_name, quantity, selling_price, discount, discount_amount, cost_price, variant_id, variant_name, variant_unit, variant_sku, variant_barcode, invoice_description)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `,
        [tx.id, item.productId, item.productName, item.quantity, item.sellingPrice, item.discount, item.discountAmount || 0, item.costPrice || 0, item.variantId || null, item.variantName || null, item.variantUnit || null, item.variantSku || null, item.variantBarcode || null, item.invoiceDescription ?? null]
      );
    }
  }

  for (const po of state.purchaseOrders) {
    await client.query(
      `
      INSERT INTO purchase_orders (id, shop_id, po_number, date, supplier_id, supplier_name, total, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [po.id, po.shopId || null, po.poNumber, po.date, po.supplierId, po.supplierName, po.total, po.status]
    );

    for (const item of po.items) {
      await client.query(
        `
        INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, quantity, cost_price, variant_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [po.id, item.productId, item.productName, item.quantity, item.costPrice, item.variantId || null]
      );
    }
  }

  for (const log of state.stockLogs) {
    await client.query(
      `
      INSERT INTO stock_logs (id, shop_id, date, product_id, product_name, type, quantity, reason, user_name, reference_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [log.id, log.shopId || null, log.date, log.productId, log.productName, log.type, log.quantity, log.reason, log.user, log.referenceId || null]
    );
  }

  for (const act of state.activityLogs) {
    await client.query(
      `
      INSERT INTO activity_logs (id, shop_id, date, user_name, role, action, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [act.id, act.shopId || null, act.date, act.user, act.role, act.action, act.details]
    );
  }

  await client.query(
    `
    INSERT INTO store_settings (id, tax_rate, store_name, currency, invoice_prefix, logo_url, store_address, store_phone, active_shop_id, product_categories, shop_profiles, shop_qr_data, updated_at)
    VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      tax_rate = EXCLUDED.tax_rate,
      store_name = EXCLUDED.store_name,
      currency = EXCLUDED.currency,
      invoice_prefix = EXCLUDED.invoice_prefix,
      logo_url = EXCLUDED.logo_url,
      store_address = EXCLUDED.store_address,
      store_phone = EXCLUDED.store_phone,
      active_shop_id = EXCLUDED.active_shop_id,
      product_categories = EXCLUDED.product_categories,
      shop_profiles = EXCLUDED.shop_profiles,
      shop_qr_data = EXCLUDED.shop_qr_data,
      updated_at = NOW()
    `,
    [
      state.settings.taxRate,
      state.settings.storeName,
      state.settings.currency,
      state.settings.invoicePrefix,
      state.settings.logoUrl || '',
      state.settings.address || null,
      state.settings.phone || null,
      state.settings.activeShopId || null,
      JSON.stringify(state.settings.productCategories || []),
      JSON.stringify(state.settings.shopProfiles || []),
      state.settings.shopQRData || null,
    ]
  );

  for (const expense of state.manualExpenses) {
    await client.query(
      `
      INSERT INTO manual_expenses (id, description, amount, date, category)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [expense.id, expense.desc, expense.amount, expense.date, expense.category]
    );
  }

  for (const sp of (state.supplierPayments || [])) {
    await client.query(
      `INSERT INTO supplier_payments (id, shop_id, supplier_id, supplier_name, purchase_order_id, amount, payment_method, date, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [sp.id, sp.shopId || null, sp.supplierId, sp.supplierName, sp.purchaseOrderId || null, sp.amount, sp.paymentMethod, sp.date, sp.note || null, sp.createdBy || null]
    );
  }

  for (const q of (state.quotations || [])) {
    await client.query(
      `INSERT INTO quotations (id, shop_id, quote_number, date, valid_until, customer_id, customer_name, customer_phone, items, subtotal, tax, discount_amount, total, status, notes, created_by, converted_to_tx_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [q.id, q.shopId || null, q.quoteNumber, q.date, q.validUntil || null, q.customerId || null, q.customerName, q.customerPhone || null, JSON.stringify(q.items), q.subtotal, q.tax, q.discountAmount, q.total, q.status, q.notes || null, q.createdBy || null, q.convertedToTxId || null]
    );
  }

  for (const cs of (state.cashShifts || [])) {
    await client.query(
      `INSERT INTO cash_shifts (id, shop_id, cashier_name, opened_at, closed_at, opening_float, closing_cash, expected_cash, cash_difference, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [cs.id, cs.shopId || null, cs.cashierName, cs.openedAt, cs.closedAt || null, cs.openingFloat, cs.closingCash ?? null, cs.expectedCash ?? null, cs.cashDifference ?? null, cs.status, cs.notes || null]
    );
  }

  for (const cp of (state.customerCreditPayments || [])) {
    await client.query(
      `INSERT INTO customer_credit_payments (id, shop_id, customer_id, customer_name, amount, date, payment_method, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cp.id, cp.shopId || null, cp.customerId, cp.customerName, cp.amount, cp.date, cp.paymentMethod, cp.note || null, cp.createdBy || null]
    );
  }

  for (const log of (state.invoicePrintLogs || [])) {
    await client.query(
      `INSERT INTO invoice_print_logs (id, shop_id, transaction_id, invoice_number, copy_type, print_sequence, printed_by, printed_at, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        log.id,
        log.shopId || null,
        log.transactionId,
        log.invoiceNumber,
        log.copyType,
        log.printSequence,
        log.printedBy,
        log.printedAt,
        log.reason || null,
      ]
    );
  }
};

const loadStateFromNormalized = async (): Promise<DBState | null> => {
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
    store_address: '',
    store_phone: '',
    shop_qr_data: '',
    active_shop_id: 'shop-main',
    shop_profiles: [
      {
        id: 'shop-main',
        name: 'Lanka Smart Hardware',
        logoUrl: '',
        address: '',
        phone: '',
        taxRate: 18,
        invoicePrefix: 'SL-INV',
      },
    ],
  };

  const loadedState: DBState = {
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
      salesRepId: row.sales_rep_id || undefined,
      salesRepName: row.sales_rep_name || undefined,
      items: (txItemsByTransaction.get(row.id) || []).map((item) => ({
        productId: item.product_id,
        productName: item.product_name,
        invoiceDescription: item.invoice_description ?? undefined,
        variantId: item.variant_id || undefined,
        variantName: item.variant_name || undefined,
        variantUnit: item.variant_unit || undefined,
        variantSku: item.variant_sku || undefined,
        variantBarcode: item.variant_barcode || undefined,
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

  return normalizeState(loadedState);
};

const syncNormalizedFromState = async (state: DBState) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await saveStateToNormalized(client, state);
    await saveAppStateMirror(client, state);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const loadDb = async () => {
  const normalizedState = await loadStateFromNormalized();
  if (normalizedState) {
    db = normalizedState;
    return;
  }

  const result = await pool.query<{ state: DBState }>('SELECT state FROM app_state WHERE id = $1', [DB_STATE_KEY]);
  if (result.rowCount && result.rows[0]) {
    db = normalizeState(result.rows[0].state);
    await syncNormalizedFromState(db);
    return;
  }

  db = normalizeState(getCleanBusinessState());
  await syncNormalizedFromState(db);
};

// Stop accepting more writes if a save fails and the last committed state
// cannot be recovered. In-memory mutations must never be treated as durable.
let databaseWriteHealthy = true;

const saveDb = async () => {
  if (!databaseWriteHealthy) {
    throw new Error('Database writes are unavailable until the server is restarted and recovery is verified.');
  }
  try {
    const nextState = normalizeState(db);
    await syncNormalizedFromState(nextState);
    db = nextState;
  } catch (saveError) {
    // A failed PostgreSQL write rolls back its transaction. The current
    // in-memory object may already have stock/credit mutations; discard it.
    try {
      const committedState = await loadStateFromNormalized();
      if (!committedState) {
        throw new Error('Cannot reload a committed database state');
      }
      db = committedState;
    } catch (recoveryError) {
      databaseWriteHealthy = false;
      console.error('Database recovery failed: further writes are disabled', recoveryError);
    }
    throw saveError;
  }
};

type AppRequest = express.Request & { authUser?: AuthUser; authSessionId?: string };

const requireAuth: express.RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser & { authRevision?: string; jti?: string };
    const currentAccount = db.users.find((account) => account.email.toLowerCase() === String(decoded.email || '').toLowerCase());
    if (!currentAccount || decoded.authRevision !== getAuthRevision(currentAccount) ||
        decoded.role !== currentAccount.role) {
      return res.status(401).json({ error: 'Session no longer valid. Please sign in again.' });
    }
    if (typeof decoded.jti !== 'string' || !decoded.jti) {
      return res.status(401).json({ error: 'Session has been revoked or is no longer valid.' });
    }
    let activeSession;
    try {
      activeSession = await pool.query(
        'SELECT id FROM auth_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > NOW()',
        [decoded.jti, currentAccount.id]
      );
    } catch {
      return res.status(503).json({ error: 'Cannot verify account session. Please try again.' });
    }
    if (!activeSession.rowCount) {
      return res.status(401).json({ error: 'Session expired or signed out. Please sign in again.' });
    }
    const access = resolveUserShopAccess(toAuthRecordFromUser(currentAccount), decoded.scopedShopId || '');
    if ('error' in access) {
      return res.status(401).json({ error: 'Shop access changed. Please sign in again.' });
    }
    (req as AppRequest).authSessionId = decoded.jti;
    (req as AppRequest).authUser = {
      email: currentAccount.email,
      name: currentAccount.name,
      role: currentAccount.role,
      scopedShopId: access.scopedShopId,
      allowedShopIds: access.allowedShopIds,
      fixedShopId: access.fixedShopId,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (roles: Role[]): express.RequestHandler => {
  return (req, res, next) => {
    const authUser = (req as AppRequest).authUser;
    if (!authUser || !roles.includes(authUser.role)) {
      return res.status(403).json({ error: 'Forbidden: role does not have access to this action' });
    }
    next();
  };
};

// Temporary single-process protection for the legacy in-memory database model.
// Without this queue, two async checkout requests can read the same stock before
// either one persists its result. This is NOT a replacement for row-level
// PostgreSQL transactions and must not be used as a multi-server locking scheme.
let writeQueue: Promise<void> = Promise.resolve();
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }
  if (!databaseWriteHealthy) {
    return res.status(503).json({ error: 'Database recovery required. Writes are temporarily disabled.' });
  }

  let releaseWrite!: () => void;
  const held = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const previous = writeQueue;
  writeQueue = held;
  void previous.then(() => {
    // Release exactly once, including cancelled client connections.
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseWrite();
    };
    res.once('finish', release);
    res.once('close', release);
    if (res.destroyed) return release();
    // A prior queued request may have failed while this request was waiting.
    if (!databaseWriteHealthy) {
      res.status(503).json({ error: 'Database recovery required. Writes are temporarily disabled.' });
      return;
    }
    next();
  }).catch((error) => {
    releaseWrite();
    next(error);
  });
});

// --- API Implementation ---

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    status: 'alive',
    environment: NODE_ENV,
    uptimeSeconds: Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000),
    shopCount: db?.settings?.shopProfiles?.length || 0,
  });
});

app.get('/api/ready', async (_req, res) => {
  if (!databaseWriteHealthy) {
    return res.status(503).json({
      ok: false,
      status: 'degraded',
      database: 'recovery-required',
    });
  }
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

// One-time setup is only available on a machine's loopback connection.
// PostgreSQL is checked directly rather than trusting the in-memory mirror.
const requireLocalSetup: express.RequestHandler = (req, res, next) => {
  const remote = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
    return res.status(403).json({ error: 'Initial administrator setup is only available on localhost.' });
  }
  next();
};

app.get('/api/auth/setup-status', requireLocalSetup, async (_req, res) => {
  try {
    const users = await pool.query('SELECT EXISTS(SELECT 1 FROM users) AS has_users');
    return res.json({ setupRequired: users.rows[0]?.has_users === false });
  } catch {
    return res.status(503).json({ error: 'Could not verify administrator setup state.' });
  }
});

app.post('/api/auth/setup-admin', requireLocalSetup, loginLimiter, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const confirmPassword = String(req.body?.confirmPassword || '');
  if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid administrator name and email address.' });
  }
  if (password.length < 12 || password.length > 128 || password !== confirmPassword) {
    return res.status(400).json({ error: 'Use a matching administrator password between 12 and 128 characters.' });
  }
  if (/(change.?me|password|example)/i.test(password)) {
    return res.status(400).json({ error: 'Choose a unique password without placeholder words.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize all attempts at first-account creation.
    await client.query('SELECT pg_advisory_xact_lock($1)', [5412927]);
    const exists = await client.query('SELECT 1 FROM users LIMIT 1');
    if (exists.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Setup is closed because user accounts already exist. Sign in with an existing administrator.' });
    }
    const user: UserAccount = {
      id: getUserRecordId(email),
      email, name, role: 'Super Admin',
      passwordHash: await bcrypt.hash(password, 12),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await client.query(
      'INSERT INTO users (id, email, name, role, password_hash) VALUES ($1,$2,$3,$4,$5)',
      [user.id, user.email, user.name, user.role, user.passwordHash]
    );
    await client.query('COMMIT');
    db.users = [user];
    return res.status(201).json({ success: true, message: 'Administrator account created. Please sign in.' });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    return res.status(503).json({ error: 'Administrator setup could not be completed; existing data was not reset.' });
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password, shopId } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const ipAddress = getRequestIp(req);
  const loginKey = normalizeLoginKey(String(email), ipAddress);
  const entry = loginAttempts.get(loginKey);
  if (entry && entry.lockUntil > Date.now()) {
    const retryAfterSeconds = Math.ceil((entry.lockUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Account temporarily locked. Try again in ${retryAfterSeconds}s.` });
  }

  if (entry && entry.lockUntil <= Date.now()) {
    loginAttempts.delete(loginKey);
  }

  const user = db.users.find((entry) => entry.email.toLowerCase() === String(email).toLowerCase());
  if (!user) {
    const current = loginAttempts.get(loginKey) || { failedCount: 0, lockUntil: 0 };
    current.failedCount += 1;
    if (current.failedCount >= LOGIN_ATTEMPT_LIMIT) {
      current.lockUntil = Date.now() + LOGIN_LOCK_WINDOW_MS;
    }
    loginAttempts.set(loginKey, current);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(String(password), user.passwordHash);
  if (!validPassword) {
    const current = loginAttempts.get(loginKey) || { failedCount: 0, lockUntil: 0 };
    current.failedCount += 1;
    if (current.failedCount >= LOGIN_ATTEMPT_LIMIT) {
      current.lockUntil = Date.now() + LOGIN_LOCK_WINDOW_MS;
    }
    loginAttempts.set(loginKey, current);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  loginAttempts.delete(loginKey);

  const access = resolveUserShopAccess(toAuthRecordFromUser(user), typeof shopId === 'string' ? shopId : '');
  if ('error' in access) {
    return res.status(access.status).json({ error: access.error });
  }

  const token = await createAuthToken({
    email: user.email,
    name: user.name,
    role: user.role,
    scopedShopId: access.scopedShopId,
    allowedShopIds: access.allowedShopIds,
    fixedShopId: access.fixedShopId,
  });

  res.json({
    token,
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
      scopedShopId: access.scopedShopId,
      allowedShopIds: access.allowedShopIds,
      fixedShopId: access.fixedShopId,
    },
  });
});

// Do not expose registered shop names, phone numbers, addresses or account/shop
// associations to anonymous users. Branch choice is available after login,
// where the authenticated user's shop permissions are enforced.
app.get('/api/public/shops', (_req, res) => {
  res.status(401).json({ error: 'Sign in to view your authorized branches.' });
});

app.use('/api', requireAuth);

app.post('/api/auth/logout', async (req, res) => {
  const sessionId = (req as AppRequest).authSessionId;
  if (!sessionId) return res.status(401).json({ error: 'No authenticated session.' });
  try {
    await pool.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
    return res.json({ success: true });
  } catch {
    return res.status(503).json({ error: 'Unable to revoke session. Please try again.' });
  }
});

app.get('/api/profile', (req, res) => {
  const authUser = (req as AppRequest).authUser;
  if (!authUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = db.users.find((entry) => entry.email.toLowerCase() === authUser.email.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'User profile not found' });
  }

  const access = resolveUserShopAccess(toAuthRecordFromUser(user), authUser.scopedShopId || '');
  if ('error' in access) {
    return res.status(access.status).json({ error: access.error });
  }

  return res.json({
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
      scopedShopId: access.scopedShopId,
      allowedShopIds: access.allowedShopIds,
      fixedShopId: access.fixedShopId,
    },
  });
});

app.put('/api/profile', async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  if (!authUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = db.users.find((entry) => entry.email.toLowerCase() === authUser.email.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'User profile not found' });
  }

  const requestedName = String(req.body?.name || '').trim();
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const wantsPasswordChange = currentPassword.length > 0 || newPassword.length > 0;

  if (requestedName && requestedName.length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters' });
  }

  if (wantsPasswordChange) {
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 12 || newPassword === DEFAULT_DEMO_PASSWORD) {
      return res.status(400).json({ error: 'New password must be at least 12 characters and not be the default password' });
    }
    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }

  const nextUser: UserAccount = {
    ...user,
    name: requestedName || user.name,
    passwordHash: wantsPasswordChange ? bcrypt.hashSync(newPassword, 10) : user.passwordHash,
    updatedAt: new Date().toISOString(),
  };
  try {
    const persisted = await pool.query(
      'UPDATE users SET name = $1, password_hash = $2, updated_at = NOW() WHERE id = $3 RETURNING id',
      [nextUser.name, nextUser.passwordHash, nextUser.id]
    );
    if (!persisted.rowCount) return res.status(404).json({ error: 'User account no longer exists.' });
  } catch (error) {
    return res.status(409).json({ error: 'Unable to update account profile.' });
  }
  db.users = db.users.map((account) => account.id === nextUser.id ? nextUser : account);

  const access = resolveUserShopAccess(toAuthRecordFromUser(user), authUser.scopedShopId || '');
  if ('error' in access) {
    return res.status(access.status).json({ error: access.error });
  }

  const token = await createAuthToken({
    email: user.email,
    name: user.name,
    role: user.role,
    scopedShopId: access.scopedShopId,
    allowedShopIds: access.allowedShopIds,
    fixedShopId: access.fixedShopId,
  });

  return res.json({
    token,
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
      scopedShopId: access.scopedShopId,
      allowedShopIds: access.allowedShopIds,
      fixedShopId: access.fixedShopId,
    },
  });
});

app.get('/api/users', requireRole(['Super Admin']), (_req, res) => {
  res.json({
    users: db.users.map((user) => {
      const access = resolveUserShopAccess(toAuthRecordFromUser(user), '');
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        scopedShopId: access.scopedShopId,
        allowedShopIds: access.allowedShopIds,
        fixedShopId: access.fixedShopId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
    }),
  });
});

app.post('/api/users', requireRole(['Super Admin']), async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const role = String(req.body?.role || '').trim() as Role;
  const password = String(req.body?.password || '');

  if (!email || !name || !role || !password) {
    return res.status(400).json({ error: 'Email, name, role, and password are required' });
  }
  if (!['Super Admin', 'Store Manager', 'Cashier', 'Inventory Staff'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (password.length < 12 || password === DEFAULT_DEMO_PASSWORD) {
    return res.status(400).json({ error: 'Password must be at least 12 characters and not be the default password' });
  }
  if (db.users.some((user) => user.email.toLowerCase() === email)) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  const newUser: UserAccount = {
    id: getUserRecordId(email),
    email,
    name,
    role,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await pool.query(
      'INSERT INTO users (id, email, name, role, password_hash, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),NOW())',
      [newUser.id, newUser.email, newUser.name, newUser.role, newUser.passwordHash]
    );
  } catch {
    return res.status(409).json({ error: 'Could not create the account. Check whether the email is already registered.' });
  }
  db.users = [...db.users, newUser];

  const access = resolveUserShopAccess(toAuthRecordFromUser(newUser), '');
  return res.status(201).json({
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      scopedShopId: access.scopedShopId,
      allowedShopIds: access.allowedShopIds,
      fixedShopId: access.fixedShopId,
      createdAt: newUser.createdAt,
      updatedAt: newUser.updatedAt,
    },
  });
});

app.put('/api/users/:id', requireRole(['Super Admin']), async (req, res) => {
  const { id } = req.params;
  const existing = db.users.find((user) => user.id === id);
  if (!existing) {
    return res.status(404).json({ error: 'User not found' });
  }

  const nextEmail = String(req.body?.email || existing.email).trim().toLowerCase();
  const nextName = String(req.body?.name || existing.name).trim();
  const nextRole = String(req.body?.role || existing.role).trim() as Role;
  const nextPassword = String(req.body?.password || '');

  if (!nextEmail || !nextName || !nextRole) {
    return res.status(400).json({ error: 'Email, name, and role are required' });
  }
  if (!['Super Admin', 'Store Manager', 'Cashier', 'Inventory Staff'].includes(nextRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (nextPassword && (nextPassword.length < 12 || nextPassword === DEFAULT_DEMO_PASSWORD)) {
    return res.status(400).json({ error: 'Password must be at least 12 characters and not be the default password' });
  }
  if (db.users.some((user) => user.email.toLowerCase() === nextEmail && user.id !== id)) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  const updatedUser: UserAccount = {
    ...existing,
    email: nextEmail,
    name: nextName,
    role: nextRole,
    passwordHash: nextPassword ? bcrypt.hashSync(nextPassword, 10) : existing.passwordHash,
    updatedAt: new Date().toISOString(),
  };

  if (existing.role === 'Super Admin' && nextRole !== 'Super Admin' &&
      db.users.filter((account) => account.role === 'Super Admin').length <= 1) {
    return res.status(409).json({ error: 'Cannot demote the last System Administrator.' });
  }
  try {
    const persisted = await pool.query(
      'UPDATE users SET email = $1, name = $2, role = $3, password_hash = $4, updated_at = NOW() WHERE id = $5 RETURNING id',
      [updatedUser.email, updatedUser.name, updatedUser.role, updatedUser.passwordHash, id]
    );
    if (!persisted.rowCount) return res.status(404).json({ error: 'Account not found in database.' });
  } catch {
    return res.status(409).json({ error: 'Could not update account. Check whether the email is already registered.' });
  }
  db.users = db.users.map((account) => account.id === id ? updatedUser : account);

  const access = resolveUserShopAccess(toAuthRecordFromUser(updatedUser), '');
  return res.json({
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      scopedShopId: access.scopedShopId,
      allowedShopIds: access.allowedShopIds,
      fixedShopId: access.fixedShopId,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    },
  });
});

app.delete('/api/users/:id', requireRole(['Super Admin']), async (req, res) => {
  const { id } = req.params;
  const existing = db.users.find((user) => user.id === id);
  if (!existing) {
    return res.status(404).json({ error: 'User not found' });
  }

  const currentAuthUser = (req as AppRequest).authUser;
  if (currentAuthUser && currentAuthUser.email.toLowerCase() === existing.email.toLowerCase()) {
    return res.status(400).json({ error: 'You cannot delete your own account while signed in' });
  }

  if (existing.role === 'Super Admin' &&
      db.users.filter((account) => account.role === 'Super Admin').length <= 1) {
    return res.status(409).json({ error: 'Cannot delete the last System Administrator.' });
  }
  try {
    const deleted = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!deleted.rowCount) return res.status(404).json({ error: 'Account not found in database.' });
  } catch {
    return res.status(409).json({ error: 'Could not delete account.' });
  }
  db.users = db.users.filter((account) => account.id !== id);
  return res.json({ ok: true });
});

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

const allowDestructiveAdminTools = !IS_PRODUCTION && process.env.ENABLE_DESTRUCTIVE_ADMIN_TOOLS === 'true';
const requireExplicitDataReset: express.RequestHandler = (req, res, next) => {
  if (!allowDestructiveAdminTools) {
    return res.status(403).json({ error: 'Database reset tools are disabled. Enable only in an isolated non-production environment.' });
  }
  if (req.body?.confirmation !== 'DELETE ALL TEST DATA') {
    return res.status(400).json({ error: 'Explicit confirmation phrase required: DELETE ALL TEST DATA' });
  }
  next();
};

app.post('/api/db/sync-normalized', requireRole(['Super Admin']), requireExplicitDataReset, async (_req, res) => {
  const appStateResult = await pool.query<{ state: DBState }>('SELECT state FROM app_state WHERE id = $1', [DB_STATE_KEY]);
  if (!appStateResult.rowCount || !appStateResult.rows[0]) {
    return res.status(404).json({ error: 'No app_state row found to sync from' });
  }

  const stateToSync = normalizeState(appStateResult.rows[0].state);
  await syncNormalizedFromState(stateToSync);
  db = stateToSync;
  res.json({ success: true, message: 'Normalized tables synced from app_state' });
});

// Raw SQL table browsing is a development-only diagnostic tool, not a business admin feature.
const requireLocalDatabaseDiagnostics: express.RequestHandler = (_req, res, next) => {
  if (IS_PRODUCTION || process.env.ENABLE_DATABASE_DIAGNOSTICS !== 'true') {
    return res.status(403).json({ error: 'Raw database diagnostics are disabled.' });
  }
  next();
};
app.get('/api/db-admin/tables', requireRole(['Super Admin']), requireLocalDatabaseDiagnostics, async (_req, res) => {
  const result = await pool.query<{ table_name: string }>(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
    `
  );

  const hiddenTables = new Set(['users', 'app_state']);
  res.json({ tables: result.rows.map((r) => r.table_name).filter((name) => !hiddenTables.has(name)) });
});

app.get('/api/db-admin/table/:tableName', requireRole(['Super Admin']), requireLocalDatabaseDiagnostics, async (req, res) => {
  const { tableName } = req.params;
  const requested = String(tableName || '').trim();
  if (!/^[a-z_][a-z0-9_]*$/i.test(requested)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }
  // Sensitive credentials exist in both the user table and the state mirror.
  if (requested === 'users' || requested === 'app_state') {
    return res.status(403).json({ error: 'This table is not available through the data browser' });
  }

  const allowedResult = await pool.query<{ table_name: string }>(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = $1
    LIMIT 1
    `,
    [requested]
  );

  if (!allowedResult.rowCount) {
    return res.status(404).json({ error: 'Table not found' });
  }

  const rawLimit = String(req.query.limit || '').trim().toLowerCase();
  let limit: number | null = null;
  if (rawLimit && rawLimit !== 'all') {
    const parsedLimit = Number(rawLimit);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      return res.status(400).json({ error: 'Invalid limit value' });
    }
    limit = Math.floor(parsedLimit);
  }

  const parsedOffset = Number(req.query.offset || 0);
  const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;

  const countResult = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "${requested}"`);
  const queryParts = [`SELECT * FROM "${requested}"`];
  if (offset > 0) {
    queryParts.push(`OFFSET ${offset}`);
  }
  if (limit !== null) {
    queryParts.push(`LIMIT ${limit}`);
  }
  const rowsResult = await pool.query(queryParts.join(' '));

  res.json({
    table: requested,
    totalRows: Number(countResult.rows[0]?.count || 0),
    limit,
    offset,
    rows: rowsResult.rows,
  });
});

// Get complete database state
app.get('/api/db', (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const byActiveShop = <T extends { shopId?: string }>(items: T[]) => items.filter((item) => item.shopId === activeShopId);

  // User credentials are only exposed through role-checked user-management APIs.
  // The hydration response must never include password hashes.
  const { users: _privateUsers, ...publicState } = db;
  res.json({
    ...publicState,
    products: byActiveShop(db.products),
    suppliers: byActiveShop(db.suppliers),
    customers: byActiveShop(db.customers),
    employees: byActiveShop(db.employees),
    transactions: byActiveShop(db.transactions),
    purchaseOrders: byActiveShop(db.purchaseOrders),
    stockLogs: byActiveShop(db.stockLogs),
    activityLogs: byActiveShop(db.activityLogs),
    supplierPayments: db.supplierPayments.filter((sp) => sp.shopId === activeShopId),
    quotations: db.quotations.filter((q) => q.shopId === activeShopId),
    cashShifts: db.cashShifts.filter((s) => s.shopId === activeShopId),
    customerCreditPayments: db.customerCreditPayments.filter((p) => p.shopId === activeShopId),
    invoicePrintLogs: db.invoicePrintLogs.filter((log) => log.shopId === activeShopId),
    _meta: { sourceOfTruth: 'normalized', activeShopId },
  });
});

// Reset database to initial defaults
app.post('/api/db/reset', requireRole(['Super Admin']), requireExplicitDataReset, async (req, res) => {
  db = getInitialDbState();
  await saveDb();
  res.json({ success: true, message: 'Database reset to initial template state successfully', data: db });
});

// Clear all test data (transactions, inventory, suppliers, customers, etc.) but keep users and settings
app.post('/api/db/clear-test-data', requireRole(['Super Admin']), requireExplicitDataReset, async (req, res) => {
  try {
    const currentUsers = db.users || [];
    const currentSettings = db.settings;
    
    // Clear all test collections
    db.products = [];
    db.suppliers = [];
    db.employees = [];
    db.transactions = [];
    db.purchaseOrders = [];
    db.stockLogs = [];
    db.activityLogs = [];
    db.manualExpenses = [];
    db.supplierPayments = [];
    db.quotations = [];
    db.cashShifts = [];
    db.customerCreditPayments = [];
    db.invoicePrintLogs = [];
    
    // Re-insert default Walk-in Customer so POS system has a fallback
    const defaultCustomer = {
      id: 'cust-walkin',
      name: 'Walk-in Customer',
      phone: '-',
      email: '-',
      address: '-',
      loyaltyBalance: 0,
      purchaseCount: 0,
      shopId: 'shop-main'
    };
    db.customers = [defaultCustomer];

    // Retain settings and users
    db.users = currentUsers;
    db.settings = currentSettings;

    // Persist to Postgres database
    await saveDb();
    
    res.json({ success: true, message: 'All test data cleared successfully. System ready for production data.', data: db });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to clear test data' });
  }
});

// QR Code endpoints for product lookup and invoice QR generation
app.post('/api/qr/scan', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const authUser = (req as AppRequest).authUser;
  const { qrData } = req.body;
  if (!qrData || typeof qrData !== 'string') {
    return res.status(400).json({ error: 'Invalid QR data' });
  }

  const products = db.products.filter((p) => p.shopId === activeShopId);
  const canUseInternalCode = authUser?.role === 'Super Admin' || authUser?.role === 'Store Manager';

  // Search by internal code first (exact match, case-insensitive) for admin/manager only
  let match = canUseInternalCode
    ? products.find((p) => p.internalCode?.toUpperCase() === qrData.trim().toUpperCase())
    : undefined;

  // Fallback to barcode search
  if (!match) {
    match = products.find((p) => p.barcode === qrData);
  }

  // Fallback to SKU search
  if (!match) {
    match = products.find((p) => p.sku === qrData);
  }

  if (match) {
    res.json({ found: true, product: match });
  } else {
    res.status(404).json({ found: false, error: `No product found for code: ${qrData}` });
  }
});

// Generate invoice-specific QR code
app.post('/api/qr/generate-invoice', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const { invoiceNumber, total, shopName } = req.body;
  if (!invoiceNumber || typeof total !== 'number') {
    return res.status(400).json({ error: 'Invalid invoice parameters' });
  }

  const qrData = await generateInvoiceQR(invoiceNumber, total, shopName || 'Shop');
  res.json({ qrData });
});

// Upload and process shop QR code
app.post('/api/shop-qr/upload', requireRole(['Super Admin', 'Store Manager']), shopLogoUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const fileContent = fs.readFileSync(req.file.path);
    const base64 = fileContent.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    db.settings.shopQRData = dataUrl;
    await saveDb();

    res.json({ success: true, message: 'Shop QR code uploaded successfully', qrData: dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process QR code: ' + String(err) });
  }
});

// Get shop QR code
app.get('/api/shop-qr', (req, res) => {
  const qrData = db.settings.shopQRData || '';
  res.json({ qrData });
});

app.get('/api/settings', (_req, res) => {
  const { activeShopId } = getActiveShopContext(db, _req);
  res.json({
    ...db.settings,
    activeShopId,
  });
});

app.put('/api/settings', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  if (!databaseWriteHealthy) return res.status(503).json({error:'Database recovery required before settings can be saved.'});
  const payload = req.body || {};
  const {activeShopId} = getActiveShopContext(db, req);
  const isAdmin = (req as AppRequest).authUser?.role === 'Super Admin';
  const oldProfiles = db.settings.shopProfiles || [];
  if (!isAdmin && payload.shopProfiles !== undefined) {
    // A branch manager may update only their own existing branch, never create
    // another branch or silently alter another branch's company profile.
    const incoming = payload.shopProfiles;
    if (!Array.isArray(incoming) || incoming.length !== oldProfiles.length ||
        incoming.some((profile:any) => !profile || typeof profile.id !== 'string') ||
        incoming.some((profile:any) => profile.id !== activeShopId &&
          JSON.stringify(profile) !== JSON.stringify(oldProfiles.find(old => old.id === profile.id)))) {
      return res.status(403).json({error:'Managers may only modify their assigned company profile.'});
    }
  }
  if (!isAdmin && payload.shopProfiles === undefined) {
    return res.status(400).json({error:'Choose your ARS branch profile to save changes.'});
  }
  const managerProfiles = !isAdmin && Array.isArray(payload.shopProfiles)
    ? oldProfiles.map(profile => profile.id === activeShopId
      ? payload.shopProfiles.find((candidate:any) => candidate.id === activeShopId) || profile
      : profile)
    : oldProfiles;
  const nextSettings: StoreSettings = {
    taxRate: !isAdmin ? db.settings.taxRate : payload.taxRate === undefined ? db.settings.taxRate : Number(payload.taxRate),
    storeName: isAdmin ? String(payload.storeName ?? db.settings.storeName) : db.settings.storeName,
    currency: 'LKR',
    invoicePrefix: isAdmin ? String(payload.invoicePrefix ?? db.settings.invoicePrefix) : db.settings.invoicePrefix,
    logoUrl: isAdmin ? String(payload.logoUrl ?? db.settings.logoUrl ?? '') : db.settings.logoUrl,
    address: isAdmin ? String(payload.address ?? db.settings.address ?? '') : db.settings.address,
    phone: isAdmin ? String(payload.phone ?? db.settings.phone ?? '') : db.settings.phone,
    shopQRData: isAdmin ? String(payload.shopQRData ?? db.settings.shopQRData ?? '') : db.settings.shopQRData,
    activeShopId: isAdmin ? String(payload.activeShopId ?? db.settings.activeShopId ?? activeShopId) : (db.settings.activeShopId || activeShopId),
    productCategories: isAdmin && Array.isArray(payload.productCategories) ? payload.productCategories : (db.settings.productCategories || []),
    shopProfiles: isAdmin && Array.isArray(payload.shopProfiles) ? payload.shopProfiles : managerProfiles,
  };
  if (!Number.isFinite(nextSettings.taxRate) || nextSettings.taxRate < 0 || nextSettings.taxRate > 100 ||
      !nextSettings.storeName.trim() || !nextSettings.invoicePrefix.trim() ||
      nextSettings.invoicePrefix.length > 30 || nextSettings.storeName.length > 150 ||
      nextSettings.shopProfiles!.length > 50 ||
      nextSettings.shopProfiles!.some(profile => !profile?.id || !profile?.name)) {
    return res.status(400).json({error:'Invalid ARS company settings.'});
  }
  const normalized = normalizeState({...db,settings:nextSettings}).settings;
  try {
    await pool.query(
      `INSERT INTO store_settings
         (id,tax_rate,store_name,currency,invoice_prefix,logo_url,store_address,store_phone,active_shop_id,product_categories,shop_profiles,shop_qr_data,updated_at)
       VALUES ('default',$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,NOW())
       ON CONFLICT (id) DO UPDATE SET
         tax_rate=EXCLUDED.tax_rate,store_name=EXCLUDED.store_name,currency=EXCLUDED.currency,
         invoice_prefix=EXCLUDED.invoice_prefix,logo_url=EXCLUDED.logo_url,
         store_address=EXCLUDED.store_address,store_phone=EXCLUDED.store_phone,
         active_shop_id=EXCLUDED.active_shop_id,product_categories=EXCLUDED.product_categories,
         shop_profiles=EXCLUDED.shop_profiles,shop_qr_data=EXCLUDED.shop_qr_data,updated_at=NOW()`,
      [normalized.taxRate,normalized.storeName,normalized.currency,normalized.invoicePrefix,
       normalized.logoUrl||'',normalized.address||'',normalized.phone||'',normalized.activeShopId||activeShopId,
       JSON.stringify(normalized.productCategories||[]),JSON.stringify(normalized.shopProfiles||[]),normalized.shopQRData||'']);
  } catch(error) {
    return res.status(409).json({error:'Company settings could not be saved.'});
  }
  try {
    const refreshed=await loadStateFromNormalized();
    if (!refreshed) throw new Error('Settings could not be reloaded.');
    db=refreshed;
    res.json(db.settings);
  } catch(error) {
    databaseWriteHealthy=false;
    console.error('Settings committed but reload failed; writes disabled.',error);
    res.status(503).json({error:'Settings committed but cache refresh failed. Do not resubmit before reconciliation.'});
  }
});

app.get('/api/manual-expenses', (_req, res) => {
  res.json(db.manualExpenses);
});

app.post('/api/manual-expenses',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database writes are disabled until recovery.'});
  const desc=String(req.body?.desc||'').trim();
  const category=String(req.body?.category||'Other').trim();
  const amount=Number(req.body?.amount);
  if(!desc||desc.length>1000||!category||category.length>100||
     !Number.isFinite(amount)||amount<=0||amount>1_000_000_000||
     Math.abs(amount*100-Math.round(amount*100))>0.00001){
    return res.status(400).json({error:'Enter a description, valid category, and positive amount with up to two decimals.'});
  }
  const {activeShopId}=getActiveShopContext(db,req);
  const authUser=(req as AppRequest).authUser;
  const expense:ManualExpense={id:'exp-'+randomUUID(),desc,amount,category,date:new Date().toISOString().slice(0,10)};
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO manual_expenses(id,description,amount,date,category) VALUES($1,$2,$3,$4,$5)',
      [expense.id,expense.desc,expense.amount,expense.date,expense.category]);
    await client.query(
      `INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details)
       VALUES($1,$2,NOW(),$3,$4,'Logged Expense',$5)`,
      ['act-'+randomUUID(),activeShopId,authUser?.name||'System',authUser?.role||'Store Manager',
       `Added manual expense ${expense.desc} (LKR ${expense.amount.toFixed(2)}).`]);
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    return res.status(409).json({error:'Expense could not be recorded.'});
  }finally{client.release();}
  try{
    const refreshed=await loadStateFromNormalized();
    if(!refreshed)throw new Error('Cannot reload committed expense');
    db=refreshed;
    res.status(201).json(expense);
  }catch(error){
    databaseWriteHealthy=false;
    console.error('Expense committed but refresh failed; writes disabled',error);
    res.status(503).json({error:'Expense was committed but reload failed. Reconcile before retrying.'});
  }
});

// Products Routes
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
    // Quantities use PostgreSQL INTEGER columns. Do not silently round fractions.
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      return `${label} quantity must be a positive whole number`;
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

app.post('/api/products', requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId, activeShopName } = getActiveShopContext(db, req);
  const normalizedPayload = normalizeIncomingProduct(req.body);
  const payloadError = validateProductPayload(normalizedPayload);
  if (payloadError) {
    return res.status(400).json({ error: payloadError });
  }
  const newProduct: Product = {
    ...normalizedPayload,
    id: 'prod-' + randomUUID(),
    shopId: activeShopId,
    imageUrl: normalizedPayload.imageUrl || '',
    quantity: Number(normalizedPayload.quantity) || 0,
    costPrice: Number(normalizedPayload.costPrice) || 0,
    sellingPrice: Number(normalizedPayload.sellingPrice) || 0,
    reorderLevel: Number(normalizedPayload.reorderLevel) || 10,
  };
  if (!Number.isSafeInteger(newProduct.quantity) || newProduct.quantity < 0 ||
      !Number.isSafeInteger(newProduct.reorderLevel) || newProduct.reorderLevel < 0 ||
      (newProduct.variants || []).some((v) =>
        !Number.isSafeInteger(v.quantity) || v.quantity < 0)) {
    return res.status(400).json({ error: 'Product stock quantities must be nonnegative whole numbers.' });
  }
  try {
    await createProductWithIntake(newProduct, authUser?.name || 'System',
      authUser?.role || 'Inventory Staff', activeShopName);
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message });
  }
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Could not reload committed product');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Product created but state refresh failed; further writes disabled', error);
  }
  res.json(newProduct);
});

app.put('/api/products/:id', requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']), async (req, res) => {
  const { activeShopId, activeShopName } = getActiveShopContext(db, req);
  const authUser = (req as AppRequest).authUser;
  const current = db.products.find((p) => p.id === req.params.id && p.shopId === activeShopId);
  if (!current) return res.status(404).json({ error: 'Product not found in this shop' });
  const normalized = normalizeIncomingProduct(req.body, current);
  const variantsProvided = Array.isArray(req.body?.variants);
  const validation = validateProductPayload(normalized);
  if (validation) return res.status(400).json({ error: validation });

  // Legacy editing could silently spread stock adjustments across variants.
  // Require explicit per-variant quantities when stock of variant-managed SKUs changes.
  const originalVariants = current.variants || [];
  const variants = variantsProvided ? normalized.variants || [] : originalVariants;
  if (originalVariants.length && !variantsProvided &&
      Number(normalized.quantity) !== current.quantity) {
    return res.status(400).json({
      error: 'Edit the individual variants to adjust stock on a variant-managed product.',
    });
  }
  const quantity = variants.length
    ? variants.reduce((sum, v) => sum + Number(v.quantity), 0)
    : Number(normalized.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 0 ||
      !Number.isSafeInteger(normalized.reorderLevel) || normalized.reorderLevel < 0 ||
      variants.some((v) => !Number.isSafeInteger(v.quantity) || v.quantity < 0)) {
    return res.status(400).json({ error: 'Stock and reorder quantities must be nonnegative whole numbers.' });
  }

  const updated: Product = {
    ...current, ...normalized, id: current.id, shopId: activeShopId,
    variants: variants.length ? variants : undefined,
    quantity,
  };
  try {
    await updateProductWithAudit(updated, current.quantity,
      authUser?.name || 'Supervisor', authUser?.role || 'Inventory Staff',
      activeShopName, String(req.body?.reason || 'Manual Product Adjustment').slice(0, 300));
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message });
  }
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Could not reload updated product');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Product edit committed but cache refresh failed; writes disabled', error);
  }
  res.json(updated);
});

app.delete('/api/products/:id', requireRole(['Super Admin']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(db, req);
  const product = db.products.find((p) => p.id === req.params.id && p.shopId === activeShopId);
  if (!product) return res.status(404).json({ error: 'Product not found in this shop' });
  try {
    // Archive the SKU; deleting it would break historical invoices and stock logs.
    await archiveProduct(product.id, activeShopId,
      authUser?.name || 'Admin', authUser?.role || 'Super Admin');
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message });
  }
  const archived = { ...product, status: 'Inactive' as const };
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Cannot reload archived product');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Product archived but cache refresh failed; writes disabled', error);
  }
  res.json({ success: true, archived: true, id: product.id, product: archived });
});

// POS Transaction Checkout Route
app.post('/api/transactions', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const { cartItems, customerId, customerName, customerPhone, customerAddress, cashierName, salesRepId, paymentMethod, paymentStatus, wholesaleMeta, discountAmount, cashReceived } = req.body;
  const txId = `tx-${randomUUID()}`;
  const { activeShopId, activeShopName } = getActiveShopContext(db, req);

  // Sales Representative is explicitly selected from registered ARS staff.
  // The signed-in operator stays separate for internal audit purposes only.
  const rep = db.employees.find(employee =>
    employee.id === String(salesRepId || '') && employee.shopId === activeShopId);
  if (!rep || !rep.name?.trim()) {
    return res.status(400).json({ error: 'Select a registered Sales Representative for this invoice.' });
  }

  // ARS distributes exclusively to registered trade customers.
  // Enforce this on the server, not just with the browser's shop selector.
  if (!customerId || customerId === 'cust-walkin') {
    return res.status(400).json({ error: 'Select a registered wholesale customer shop before issuing an invoice.' });
  }
  // Checkout is always tied to the signed-in operator's active shop.
  const checkoutCustomer = customerId && customerId !== 'cust-walkin'
    ? db.customers.find((c) => c.id === customerId && c.shopId === activeShopId)
    : undefined;
  if (customerId && customerId !== 'cust-walkin' && !checkoutCustomer) {
    return res.status(400).json({ error: 'Customer is not available in this shop' });
  }
  const buyerName = checkoutCustomer?.name?.trim();
  if (!buyerName) {
    return res.status(400).json({ error: 'Wholesale buyer requires a valid registered shop name.' });
  }

  if (paymentMethod === 'Credit Account' && !checkoutCustomer) {
    return res.status(400).json({ error: 'A registered customer is required for credit sales' });
  }
  const allowedPaymentMethods = new Set([
    'Cash', 'Credit Card', 'Debit Card', 'QR Code', 'Bank Transfer', 'Mobile Wallet', 'Credit Account',
  ]);
  if (!allowedPaymentMethods.has(paymentMethod)) {
    return res.status(400).json({ error: 'Unsupported payment method' });
  }

  const checkoutError = validateCheckoutPayload(cartItems || []);
  if (checkoutError) {
    return res.status(400).json({ error: checkoutError });
  }

  // Double check and decrease stock for each item
  const completedItems = [];
  const pendingStockUpdates: Array<{ product: Product; variantId?: string; quantity: number }> = [];
  const pendingStockLogs: StockLog[] = [];
  const requestedQtyByStockKey = new Map<string, number>();
  let subtotal = 0;

  for (const item of cartItems) {
    const dbProduct = db.products.find((p) => p.id === item.product.id && p.shopId === activeShopId);
    if (!dbProduct) {
      return res.status(400).json({ error: `Product ${item.product.name} not found in catalog` });
    }
    if (dbProduct.status === 'Inactive') {
      return res.status(409).json({ error: `Product ${dbProduct.name} is archived and cannot be sold` });
    }

    const variantId = String(item.variantId || '').trim();
    const variants = Array.isArray(dbProduct.variants) ? dbProduct.variants : [];
    const targetVariant = variantId
      ? variants.find((variant) => variant.id === variantId)
      : undefined;
    // Never turn a missing/invalid variant into a sale of another stock keeping unit.
    if (variantId && !targetVariant) {
      return res.status(400).json({ error: `Selected variant is not available for ${dbProduct.name}` });
    }
    if (!variantId && variants.length > 0) {
      return res.status(400).json({ error: `Select a variant for ${dbProduct.name} before checkout` });
    }

    const quantity = Number(item.quantity) || 0;
    const availableQty = targetVariant ? Number(targetVariant.quantity || 0) : Number(dbProduct.quantity || 0);
    const stockKey = targetVariant ? `${dbProduct.id}:${targetVariant.id}` : dbProduct.id;
    const requestedQty = (requestedQtyByStockKey.get(stockKey) || 0) + quantity;
    if (!Number.isSafeInteger(requestedQty)) {
      return res.status(400).json({ error: 'Requested stock quantity exceeds supported limits' });
    }
    if (availableQty < requestedQty) {
      const stockLabel = targetVariant ? `${dbProduct.name} (${targetVariant.name})` : dbProduct.name;
      return res.status(400).json({
        error: `Insufficient stock for ${stockLabel}. Available: ${availableQty}, requested: ${requestedQty}`,
      });
    }
    requestedQtyByStockKey.set(stockKey, requestedQty);

    const discountPct = Math.min(100, Math.max(0, Number(item.discount) || 0));
    const unitSellingPrice = targetVariant ? Number(targetVariant.sellingPrice || 0) : Number(dbProduct.sellingPrice || 0);
    const unitCostPrice = targetVariant ? Number(targetVariant.costPrice || 0) : Number(dbProduct.costPrice || 0);
    const baseItemCost = unitSellingPrice * quantity;
    const percentAdjustedLineTotal = baseItemCost * (1 - discountPct / 100);
    const lineDiscountAmount = Math.min(percentAdjustedLineTotal, Math.max(0, Number(item.discountAmount) || 0));
    const lineTotal = Math.max(0, percentAdjustedLineTotal - lineDiscountAmount);

    pendingStockUpdates.push({ product: dbProduct, variantId: targetVariant?.id, quantity });

    const lineProductName = targetVariant ? `${dbProduct.name} (${targetVariant.name})` : dbProduct.name;
    // Invoice descriptions are snapshots; never mutate product master records.
    // The product's saved description is used when the cashier does not explicitly edit it.
    if (item.invoiceDescription != null && typeof item.invoiceDescription !== 'string') {
      return res.status(400).json({ error: 'Invoice item description must be text.' });
    }
    const descriptionSource = item.invoiceDescription == null
      ? String(dbProduct.description || dbProduct.longDescription || '')
      : item.invoiceDescription;
    const invoiceDescription = descriptionSource.replace(/[\r\n\t]+/g, ' ').trim();
    if (invoiceDescription.length > 250) {
      return res.status(400).json({ error: 'Invoice description must be 250 characters or less.' });
    }
    completedItems.push({
      productId: dbProduct.id,
      productName: lineProductName,
      invoiceDescription,
      variantId: targetVariant?.id,
      variantName: targetVariant?.name,
      variantUnit: targetVariant?.unit,
      variantSku: targetVariant?.sku,
      variantBarcode: targetVariant?.barcode,
      quantity,
      sellingPrice: unitSellingPrice,
      costPrice: unitCostPrice,
      discount: discountPct,
      discountAmount: Math.round(lineDiscountAmount * 100) / 100,
    });

    subtotal += Math.round(lineTotal * 100) / 100;

    pendingStockLogs.push({
      id: 'log-' + Date.now() + Math.random().toString(36).substring(2, 5),
      shopId: activeShopId,
      date: new Date().toISOString(),
      productId: dbProduct.id,
      productName: lineProductName,
      type: 'Stock Out',
      quantity: -quantity,
      reason: `Invoice Sale Checkout`,
      user: cashierName || 'Cashier',
      referenceId: txId,
    });
  }

  // Validate the persisted display mode against the server-computed invoice subtotal.
  // A discount label must never misrepresent the actual amount charged.
  if (wholesaleMeta && typeof wholesaleMeta === 'object' && wholesaleMeta.invoiceDiscountMode != null) {
    const mode = wholesaleMeta.invoiceDiscountMode;
    if (mode !== 'amount' && mode !== 'percent') {
      return res.status(400).json({ error: 'Invalid invoice discount type' });
    }
    if (mode === 'percent') {
      const percent = Number(wholesaleMeta.invoiceDiscountPercent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return res.status(400).json({ error: 'Invoice discount percentage must be between 0 and 100' });
      }
      const expectedAmount = Math.round((subtotal * percent / 100) * 100) / 100;
      if (Math.abs(expectedAmount - Number(discountAmount || 0)) > 0.011) {
        return res.status(400).json({ error: 'Invoice percentage discount does not match the discounted amount' });
      }
    }
  }

  // Calculate taxes and totals
  const shopProfile = db.settings.shopProfiles?.find(shop => shop.id === activeShopId);
  const { tax, total } = invoiceTotals(subtotal, shopProfile?.taxRate ?? db.settings.taxRate, discountAmount);
  const cashPaid = paymentMethod === 'Cash' ? Math.round(Number(cashReceived ?? total) * 100) / 100 : undefined;
  const cashChange = paymentMethod === 'Cash' ? Math.round(Math.max(0, (cashPaid ?? 0) - total) * 100) / 100 : undefined;
  const normalizedPaymentStatus = (paymentMethod === 'Credit Account' ? 'CREDIT SALE' : normalizePaymentStatus(paymentStatus))
    || (paymentMethod === 'Credit Account'
      ? 'CREDIT SALE'
      : ((cashPaid ?? total) <= 0
        ? 'UNPAID'
        : ((cashPaid ?? total) < total ? 'PARTIALLY PAID' : 'PAID')));

  if (!Number.isFinite(total) || total < 0) {
    return res.status(400).json({ error: 'Invalid invoice total' });
  }
  if (paymentMethod === 'Cash' && (!Number.isFinite(cashPaid) || (cashPaid ?? 0) < total)) {
    return res.status(400).json({ error: `Cash received must be at least Rs.${total.toFixed(2)}.` });
  }

  // A configured positive customer credit limit is enforced BEFORE stock changes.
  // Zero/absent legacy limits remain unrestricted until an owner sets a policy.
  if (paymentMethod === 'Credit Account' && checkoutCustomer) {
    const outstanding = Number(checkoutCustomer.creditBalance || 0);
    const limit = Number(checkoutCustomer.creditLimit || 0);
    if (!Number.isFinite(outstanding) || outstanding < 0 || !Number.isFinite(limit) || limit < 0) {
      return res.status(400).json({ error: 'Customer credit account has invalid balances' });
    }
    if (limit > 0 && Math.round((outstanding + total) * 100) > Math.round(limit * 100)) {
      return res.status(409).json({
        error: `Credit limit exceeded. Available credit: Rs.${Math.max(0, limit - outstanding).toFixed(2)}.`,
      });
    }
  }

  const invoicePrefix = String(shopProfile?.invoicePrefix || db.settings.invoicePrefix || 'INV').trim();
  const invoiceNum = `${invoicePrefix}-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

  const tx: SalesTransaction = {
    id: txId,
    shopId: activeShopId,
    invoiceNumber: invoiceNum,
    date: new Date().toISOString(),
    customerName: buyerName,
    customerPhone: checkoutCustomer?.phone || undefined,
    customerAddress: checkoutCustomer?.address || undefined,
    customerId: checkoutCustomer.id,
    cashierName: (req as AppRequest).authUser?.name || 'System',
    salesRepId: rep.id,
    salesRepName: rep.name,
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

  // PostgreSQL is authoritative for checkout: the transaction updates only
  // the affected rows and commits everything together, or rolls back all of it.
  // Do not call saveDb() here: it rewrites all normalized tables.
  await checkoutTransaction(tx, (req as AppRequest).authUser?.role || 'Cashier', activeShopName);

  // The transaction has committed. Return success even if the cache refresh
  // fails, otherwise a cashier may retry and create a second paid invoice.
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Could not refresh the committed database state');
    db = refreshed;
  } catch (refreshError) {
    databaseWriteHealthy = false;
    console.error('Checkout saved but state hydration failed. Further writes disabled.', refreshError);
  }
  res.json(tx);
});

// Printing is authorized before creating its immutable audit record. The DB
// transaction locks the invoice to sequence concurrent print requests reliably.
app.post('/api/transactions/:id/print',requireRole(['Super Admin','Store Manager','Cashier']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database writes are disabled.'});
  const user=(req as AppRequest).authUser;
  const {activeShopId}=getActiveShopContext(db,req);
  const requestedRaw=String(req.body?.copyType||'').trim();
  if(requestedRaw && !INVOICE_COPY_TYPES.includes(requestedRaw as InvoiceCopyType))
    return res.status(400).json({error:'Invalid invoice copy type.'});
  const reason=String(req.body?.reason||'').trim();
  if(reason.length>1000)return res.status(400).json({error:'Print reason is too long.'});
  const client=await pool.connect();
  let printLog:InvoicePrintLog|undefined;
  let watermarkText='';
  let secondaryWatermarkText='';
  try {
    await client.query('BEGIN');
    const tx=await client.query('SELECT invoice_number FROM sales_transactions WHERE id=$1 AND shop_id=$2 FOR UPDATE',[req.params.id,activeShopId]);
    if(!tx.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Invoice not found in this branch.'});}
    const count=await client.query('SELECT COALESCE(MAX(print_sequence),0)::integer AS max_sequence FROM invoice_print_logs WHERE transaction_id=$1 AND shop_id=$2',
      [req.params.id,activeShopId]);
    const printSequence=Number(count.rows[0].max_sequence)+1;
    const isFirstPrint=printSequence===1;
    if(!isFirstPrint&&user?.role==='Cashier'&&requestedRaw&&requestedRaw!=='Duplicate Copy'){
      await client.query('ROLLBACK');
      return res.status(403).json({error:'Cashier can only request duplicate copies for reprints.'});
    }
    const copyType:InvoiceCopyType=isFirstPrint?'Original Copy':((requestedRaw as InvoiceCopyType)||'Duplicate Copy');
    watermarkText=isFirstPrint?'ORIGINAL COPY':(copyType==='Reprinted Invoice'?'REPRINTED':copyType.toUpperCase());
    secondaryWatermarkText=copyType==='Reprinted Invoice'?'DUPLICATE COPY':'';
    printLog={id:'ipr-'+randomUUID(),shopId:activeShopId,transactionId:req.params.id,
      invoiceNumber:tx.rows[0].invoice_number,copyType,printSequence,
      printedBy:user?.name||'System',printedAt:new Date().toISOString(),reason:reason||undefined};
    await client.query(
      `INSERT INTO invoice_print_logs(id,shop_id,transaction_id,invoice_number,copy_type,print_sequence,printed_by,printed_at,reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [printLog.id,activeShopId,req.params.id,printLog.invoiceNumber,copyType,printSequence,printLog.printedBy,printLog.printedAt,reason||null]);
    await client.query(
      `INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details)
       VALUES($1,$2,NOW(),$3,$4,'Invoice Print Logged',$5)`,
      ['act-'+randomUUID(),activeShopId,printLog.printedBy,user?.role||'Cashier',
        `Invoice ${printLog.invoiceNumber} printed as ${copyType} (sequence ${printSequence}).`]);
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    return res.status(409).json({error:'Could not record invoice printing.'});
  } finally {client.release();}
  try {
    const refreshed=await loadStateFromNormalized();
    if(!refreshed)throw Error('Invoice print history not refreshed');
    db=refreshed;
    res.json({printLog,printSummary:{invoiceNumber:printLog!.invoiceNumber,
      totalPrints:printLog!.printSequence,isReprint:printLog!.printSequence>1,
      watermarkText,secondaryWatermarkText}});
  }catch(error){
    databaseWriteHealthy=false;
    console.error('Print audit committed but refresh failed; writes disabled.',error);
    res.status(503).json({error:'Print audit saved but reload failed. Reconcile before retrying.'});
  }
});

app.get('/api/transactions/:id/print-logs', requireRole(['Super Admin', 'Store Manager', 'Cashier']), (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const tx = db.transactions.find((item) => item.id === req.params.id && item.shopId === activeShopId);
  if (!tx) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const logs = db.invoicePrintLogs
    .filter((log) => log.transactionId === tx.id)
    .sort((a, b) => b.printSequence - a.printSequence);
  res.json({ invoiceNumber: tx.invoiceNumber, printCount: logs.length, logs });
});

app.get('/api/transactions/:id/pdf', requireRole(['Super Admin', 'Store Manager', 'Cashier']), (req, res) => {
  const { activeShopId, activeShopName } = getActiveShopContext(db, req);
  const activeShopProfile = (db.settings.shopProfiles || []).find((shop) => shop.id === activeShopId) || null;
  const tx = db.transactions.find((item) => item.id === req.params.id && item.shopId === activeShopId);
  if (!tx) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const copyType = normalizeInvoiceCopyType(String(req.query.copyType || '')) || 'Original Copy';
  const printSequence = Math.max(1, Number(req.query.printSequence) || 1);
  const watermarkText = String(req.query.watermark || '').trim() || (copyType === 'Reprinted Invoice' ? 'REPRINTED' : copyType.toUpperCase());
  const secondaryWatermarkText = String(req.query.secondaryWatermark || '').trim() || (copyType === 'Reprinted Invoice' ? 'DUPLICATE COPY' : '');
  const printedBy = String(req.query.printedBy || '').trim() || undefined;
  const printedAt = String(req.query.printedAt || '').trim() || undefined;
  const filenameCopyType = copyType.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const fileName = `${tx.invoiceNumber}-${filenameCopyType}.pdf`;

  buildInvoicePdfBuffer(tx, activeShopName, {
    copyType,
    printSequence,
    watermarkText,
    secondaryWatermarkText,
    printedBy,
    printedAt,
  }, activeShopProfile?.logoUrl || db.settings.logoUrl || '', activeShopProfile?.invoiceCompanyMeta, activeShopProfile || db.settings).then((pdfBuffer) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuffer);
  }).catch(() => {
    res.status(500).json({ error: 'Failed to generate invoice PDF' });
  });
});

const recordInvoiceShareAudit=async(shopId:string,auth:AuthUser|undefined,action:string,details:string)=>{
  if(!databaseWriteHealthy)throw new Error('Database writes are disabled.');
  await pool.query(
    `INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details)
     VALUES($1,$2,NOW(),$3,$4,$5,$6)`,
    ['act-'+randomUUID(),shopId,auth?.name||'System',auth?.role||'Cashier',action,details]);
  try {
    const refreshed=await loadStateFromNormalized();
    if(!refreshed)throw new Error('Cannot refresh audit state');
    db=refreshed;
  } catch(error) {
    databaseWriteHealthy=false;
    throw new Error('Audit recorded but cache refresh failed; business writes disabled.');
  }
};

app.post('/api/transactions/:id/share/email', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId, activeShopName } = getActiveShopContext(db, req);
  const activeShopProfile = (db.settings.shopProfiles || []).find((shop) => shop.id === activeShopId) || null;
  const tx = db.transactions.find((item) => item.id === req.params.id && item.shopId === activeShopId);
  if (!tx) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const to = String(req.body?.to || '').trim();
  if (!to || !to.includes('@')) {
    return res.status(400).json({ error: 'Valid recipient email is required' });
  }

  const copyType = normalizeInvoiceCopyType(String(req.body?.copyType || '')) || 'Duplicate Copy';
  const subject = String(req.body?.subject || '').trim() || `Invoice ${tx.invoiceNumber} - ${copyType}`;
  const customMessage = String(req.body?.message || '').trim();

  const smtpHost = String(process.env.EMAIL_SMTP_HOST || '').trim();
  const smtpPort = Number(process.env.EMAIL_SMTP_PORT || 587);
  const smtpSecure = String(process.env.EMAIL_SMTP_SECURE || 'false').trim().toLowerCase() === 'true';
  const smtpUser = String(process.env.EMAIL_SMTP_USER || '').trim();
  const smtpPass = String(process.env.EMAIL_SMTP_PASS || '').trim();
  const fromEmail = String(process.env.EMAIL_FROM || smtpUser).trim();
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !fromEmail) {
    return res.status(400).json({ error: 'SMTP configuration is missing. Set EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS, EMAIL_FROM.' });
  }

  let deliveryCompleted = false;
  try {
    const pdfBuffer = await buildInvoicePdfBuffer(tx, activeShopName, {
      copyType,
      printSequence: Math.max(1, Number(req.body?.printSequence) || 1),
      watermarkText: copyType === 'Reprinted Invoice' ? 'REPRINTED' : copyType.toUpperCase(),
      secondaryWatermarkText: copyType === 'Reprinted Invoice' ? 'DUPLICATE COPY' : '',
    }, (activeShopProfile?.logoUrl || db.settings.logoUrl || ''), activeShopProfile?.invoiceCompanyMeta, activeShopProfile || db.settings);

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const htmlBody = `
      <div style="font-family:Segoe UI,Tahoma,sans-serif;color:#0f172a;">
        <h2 style="margin:0 0 8px;">${activeShopName}</h2>
        <p style="margin:0 0 10px;">Invoice <strong>${tx.invoiceNumber}</strong> (${copyType})</p>
        <p style="margin:0 0 6px;">Customer: ${tx.customerName}</p>
        <p style="margin:0 0 6px;">Date: ${new Date(tx.date).toLocaleString()}</p>
        <p style="margin:0 0 10px;">Total: Rs.${Number(tx.total).toFixed(2)}</p>
        <p style="margin:10px 0 0;">${customMessage || 'Please find the invoice attached.'}</p>
      </div>
    `;

    await transporter.sendMail({
      from: fromEmail,
      to,
      subject,
      html: htmlBody,
      attachments: [
        {
          filename: `${tx.invoiceNumber}-${copyType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    deliveryCompleted = true;
    await recordInvoiceShareAudit(activeShopId,authUser,'Invoice Shared via Email',
      `Invoice ${tx.invoiceNumber} (${copyType}) emailed to ${to}.`);

    res.json({ success: true, channel: 'email', invoiceNumber: tx.invoiceNumber, to, copyType });
  } catch (error) {
    res.status(deliveryCompleted ? 503 : 502).json({ error: deliveryCompleted
      ? 'Email was accepted by the mail provider, but audit recording failed. Do not send it again without checking.'
      : `Could not send invoice email: ${String(error)}` });
  }
});

app.post('/api/transactions/:id/share/whatsapp', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId, activeShopName } = getActiveShopContext(db, req);
  const activeShopProfile = (db.settings.shopProfiles || []).find((shop) => shop.id === activeShopId) || null;
  const tx = db.transactions.find((item) => item.id === req.params.id && item.shopId === activeShopId);
  if (!tx) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const to = String(req.body?.to || '').trim();
  if (!to) {
    return res.status(400).json({ error: 'Recipient WhatsApp number is required' });
  }

  const copyType = normalizeInvoiceCopyType(String(req.body?.copyType || '')) || 'Duplicate Copy';
  const apiUrl = String(process.env.WHATSAPP_API_URL || '').trim();
  const mediaUploadUrl = String(process.env.WHATSAPP_MEDIA_UPLOAD_URL || '').trim();
  const token = String(process.env.WHATSAPP_TOKEN || '').trim();
  if (!apiUrl || !mediaUploadUrl || !token) {
    return res.status(400).json({
      error: 'WhatsApp API configuration is missing. Set WHATSAPP_API_URL, WHATSAPP_MEDIA_UPLOAD_URL, and WHATSAPP_TOKEN.',
    });
  }

  const printSequence = Math.max(1, Number(req.body?.printSequence) || 1);
  const watermarkText = copyType === 'Reprinted Invoice' ? 'REPRINTED' : copyType.toUpperCase();
  const caption = String(req.body?.message || '').trim() || [
    `Invoice ${tx.invoiceNumber}`,
    `Customer: ${tx.customerName}`,
    `Total: Rs.${Number(tx.total).toFixed(2)}`,
    `Copy Type: ${copyType}`,
    `From: ${activeShopName}`,
  ].join('\n');

  let deliveryCompleted = false;
  try {
    const pdfFileName = `${tx.invoiceNumber}-${copyType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
    const pdfBuffer = await buildInvoicePdfBuffer(tx, activeShopName, {
      copyType,
      printSequence,
      watermarkText,
      secondaryWatermarkText: copyType === 'Reprinted Invoice' ? 'DUPLICATE COPY' : '',
    }, activeShopProfile?.logoUrl || db.settings.logoUrl || '', activeShopProfile?.invoiceCompanyMeta, activeShopProfile || db.settings);

    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', 'application/pdf');
    formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), pdfFileName);

    const uploadResponse = await fetch(mediaUploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const uploadPayload = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok || !uploadPayload?.id) {
      return res.status(502).json({ error: uploadPayload?.error?.message || 'Failed to upload invoice PDF to WhatsApp media API' });
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: {
          id: uploadPayload.id,
          filename: pdfFileName,
          caption,
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ error: payload?.error?.message || 'Failed to send WhatsApp message' });
    }

    deliveryCompleted = true;
    await recordInvoiceShareAudit(activeShopId,authUser,'Invoice Shared via WhatsApp PDF',
      `Invoice ${tx.invoiceNumber} (${copyType}) PDF sent to WhatsApp ${to}.`);

    res.json({ success: true, channel: 'whatsapp', invoiceNumber: tx.invoiceNumber, to, copyType, providerResponse: payload });
  } catch (error) {
    res.status(deliveryCompleted ? 503 : 502).json({ error: deliveryCompleted
      ? 'WhatsApp accepted the document, but audit recording failed. Check delivery before retrying.'
      : `Could not send WhatsApp document: ${String(error)}` });
  }
});

app.get('/api/invoice-print-audit', requireRole(['Super Admin', 'Store Manager']), (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 25));
  try {
    const result = buildInvoicePrintAuditRows(db, activeShopId, {
      fromDateRaw: String(req.query.fromDate || ''),
      toDateRaw: String(req.query.toDate || ''),
      invoiceNumberRaw: String(req.query.invoiceNumber || ''),
      printedByRaw: String(req.query.printedBy || ''),
      statusRaw: String(req.query.status || ''),
      copyTypeRaw: String(req.query.copyType || ''),
    });

    const totalRows = result.rows.length;
    const start = (page - 1) * pageSize;
    const pagedRows = result.rows.slice(start, start + pageSize);

    res.json({
      filters: {
        ...result.normalizedFilters,
        page,
        pageSize,
      },
      summary: {
        totalRows,
        uniqueInvoices: new Set(result.rows.map((row) => row.invoiceNumber)).size,
        uniquePrintedByCount: result.uniquePrintedBy.length,
      },
      uniquePrintedBy: result.uniquePrintedBy,
      rows: pagedRows,
    });
  } catch (error) {
    res.status(400).json({ error: String(error).includes('fromDate') ? 'Invalid fromDate' : 'Invalid toDate' });
  }
});

app.get('/api/invoice-print-audit/export.csv', requireRole(['Super Admin', 'Store Manager']), (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  try {
    const result = buildInvoicePrintAuditRows(db, activeShopId, {
      fromDateRaw: String(req.query.fromDate || ''),
      toDateRaw: String(req.query.toDate || ''),
      invoiceNumberRaw: String(req.query.invoiceNumber || ''),
      printedByRaw: String(req.query.printedBy || ''),
      statusRaw: String(req.query.status || ''),
      copyTypeRaw: String(req.query.copyType || ''),
    });

    const header = [
      'printed_at',
      'invoice_number',
      'copy_type',
      'print_sequence',
      'printed_by',
      'transaction_status',
      'payment_method',
      'customer_name',
      'total_amount',
      'reason',
    ];
    const csvRows = result.rows.map((row) => [
      row.printedAt,
      row.invoiceNumber,
      row.copyType,
      row.printSequence,
      row.printedBy,
      row.transactionStatus,
      row.paymentMethod,
      row.customerName,
      Number(row.totalAmount || 0).toFixed(2),
      row.reason || '',
    ]);
    const csv = [header, ...csvRows]
      .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-print-audit-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(400).json({ error: String(error).includes('fromDate') ? 'Invalid fromDate' : 'Invalid toDate' });
  }
});

app.post('/api/transactions/:id/refund', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  const { reason } = req.body || {};
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(db, req);
  const txIndex = db.transactions.findIndex((t) => t.id === req.params.id && t.shopId === activeShopId);

  if (txIndex === -1) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const tx = db.transactions[txIndex];
  if (tx.status === 'Refunded') {
    return res.status(400).json({ error: 'Transaction already refunded' });
  }

  // Validate the entire return before changing any stock or customer balance.
  // A missing SKU/variant must not produce a "refunded" invoice with no restock.
  // PostgreSQL handles the entire refund atomically. Never call the legacy
  // full-state save here; it would truncate invoice and stock history.
  try {
    await refundTransaction(tx.id, activeShopId, String(reason || 'Not provided'),
      authUser?.name || 'Manager', authUser?.role || 'Store Manager');
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message || 'Refund could not be completed' });
  }

  // The refund has already COMMITTED: do not return an ambiguous error that
  // might cause an operator to retry a successfully refunded invoice.
  const result = {
    ...tx, status: 'Refunded' as const,
    refundedAt: new Date().toISOString(),
    refundReason: String(reason || 'Not provided'),
  };
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Committed refund could not be reloaded');
    db = refreshed;
  } catch (refreshError) {
    databaseWriteHealthy = false;
    console.error('Refund committed but state refresh failed; further writes disabled.', refreshError);
  }
  res.json(result);
});

// Create Purchase Orders (Suppliers)
app.post('/api/purchases', requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']), async (req, res) => {
  const { supplierId, items, orderUser } = req.body || {};
  const { activeShopId } = getActiveShopContext(db, req);
  const supplier = db.suppliers.find((item) => item.id === supplierId && item.shopId === activeShopId);
  if (!supplier) return res.status(400).json({ error: 'Supplier not found in this shop' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Add at least one purchase line' });
  const parts: PurchaseOrder['items'] = [];
  let sum = 0;
  for (const item of items) {
    const product = db.products.find((p) => p.id === item?.productId && p.shopId === activeShopId);
    const quantity = Number(item?.quantity);
    const costPrice = Number(item?.costPrice);
    if (!product || !Number.isSafeInteger(quantity) || quantity <= 0 ||
        !Number.isFinite(costPrice) || costPrice < 0) {
      return res.status(400).json({ error: 'Invalid purchase product, quantity or cost' });
    }
    try {
      const variant = purchaseVariant(product.variants || [], item.variantId, product.name);
      sum += quantity * costPrice;
      parts.push({ productId: product.id, productName: variant ? `${product.name} (${(variant as ProductVariant & { name: string }).name})` : product.name,
        variantId: variant?.id, quantity, costPrice });
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }
  }
  if (!Number.isFinite(sum) || sum > 9999999999) return res.status(400).json({ error: 'Invalid purchase total' });
  const po: PurchaseOrder = {
    id: 'po-' + randomUUID(),
    shopId: activeShopId,
    poNumber: 'PO-' + Date.now() + '-' + randomUUID().slice(0, 8).toUpperCase(),
    date: new Date().toISOString(),
    supplierId: supplier.id,
    supplierName: supplier.companyName || supplier.name,
    items: parts,
    total: Math.round(sum * 100) / 100,
    status: 'Pending',
  };
  try {
    await createPurchaseOrder(po);
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message });
  }
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Cannot refresh committed purchase');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Purchase committed but refresh failed; writes disabled', error);
  }
  res.json(po);
});

app.put('/api/purchases/:id/status', requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']), async (req, res) => {
  const { status, receiveUser } = req.body || {};
  const { activeShopId } = getActiveShopContext(db, req);
  const po = db.purchaseOrders.find((item) => item.id === req.params.id && item.shopId === activeShopId);
  if (!po) return res.status(404).json({ error: 'Purchase order not found in this shop' });
  if (!['Pending', 'Ordered', 'Cancelled', 'Received'].includes(status)) {
    return res.status(400).json({ error: 'Invalid purchase status' });
  }
  if (po.status === status) return res.json(po);
  try {
    if (status === 'Received') {
      return res.status(409).json({ error: 'Record checked quantities through Warehouse Receiving. Direct full-order stock posting is disabled.' });
    } else {
      await updatePurchaseOrderStatus(po.id, activeShopId, status, receiveUser || 'Inventory Officer');
    }
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message });
  }
  const result = { ...po, status };
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Cannot refresh committed purchase status');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Purchase status committed but refresh failed; writes disabled', error);
  }
  res.json(result);
});

// Suppliers Routes
app.post('/api/suppliers', requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Supplier name is required.' });
  const supplier: Supplier = {
    id: 'sup-' + randomUUID(),
    shopId: activeShopId,
    name,
    companyName: String(req.body?.companyName || '').trim(),
    phone: String(req.body?.phone || '').trim(),
    email: String(req.body?.email || '').trim(),
    address: String(req.body?.address || '').trim(),
    taxNumber: String(req.body?.taxNumber || '').trim(),
  };
  try {
    await insertSupplier(supplier);
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message });
  }
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Cannot reload committed supplier');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Supplier saved but cache refresh failed; writes disabled', error);
  }
  res.json(supplier);
});

// Customers Routes
app.post('/api/customers', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const name = String(req.body?.name || '').trim();
  const creditLimit = Number(req.body?.creditLimit ?? 0);
  if (!name) return res.status(400).json({ error: 'Customer name is required.' });
  if (!Number.isFinite(creditLimit) || creditLimit < 0 ||
      Math.abs(creditLimit * 100 - Math.round(creditLimit * 100)) > 0.00001) {
    return res.status(400).json({ error: 'Invalid customer credit limit.' });
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
    creditLimit: (req as AppRequest).authUser?.role === 'Cashier' ? 0 : creditLimit,
    // Starting debts must be entered through a separately audited migration,
    // not trusted from the customer-creation request.
    creditBalance: 0,
  };
  try {
    await insertCustomer(customer);
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message });
  }
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Cannot reload committed customer');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Customer saved but cache refresh failed; writes disabled', error);
  }
  res.json(customer);
});

// Employees Routes
const refreshCommittedEmployeeState = async (res: express.Response) => {
  try {
    const refreshed=await loadStateFromNormalized();
    if (!refreshed) throw new Error('Cannot reload committed employee data.');
    db=refreshed;
    return true;
  } catch(error) {
    databaseWriteHealthy=false;
    console.error('Staff record committed but reload failed; writes disabled.',error);
    res.status(503).json({error:'Staff change committed but refresh failed. Reconcile before retrying.'});
    return false;
  }
};

const validateEmployee = (raw:any, shopId:string, id:string): Employee | null => {
  const name=String(raw?.name||'').trim();
  const role=String(raw?.role||'');
  const salary=Number(raw?.salary);
  const performanceScore=Number(raw?.performanceScore ?? 85);
  const attendanceStatus=String(raw?.attendanceStatus||'Present');
  if (!name || name.length>160 || !['Super Admin','Store Manager','Cashier','Inventory Staff'].includes(role) ||
      !Number.isFinite(salary) || salary<0 || salary>999999999 ||
      !Number.isSafeInteger(performanceScore) || performanceScore<0 || performanceScore>100 ||
      !['Present','Absent','On Leave'].includes(attendanceStatus)) return null;
  return {id,shopId,name,role:role as Role,phone:String(raw?.phone||'').slice(0,80),
    email:String(raw?.email||'').slice(0,200),salary,attendanceStatus:attendanceStatus as Employee['attendanceStatus'],
    performanceScore};
};
app.post('/api/employees', requireRole(['Super Admin', 'Store Manager']), async (req,res)=>{
  if (!databaseWriteHealthy) return res.status(503).json({error:'Database writes are disabled.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const employee=validateEmployee(req.body,activeShopId,'emp-'+randomUUID());
  if (!employee) return res.status(400).json({error:'Provide a valid staff name, role, salary, attendance and score.'});
  try {
    await pool.query(
      `INSERT INTO employees(id,shop_id,name,role,phone,email,salary,attendance_status,performance_score)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [employee.id,activeShopId,employee.name,employee.role,employee.phone,employee.email,
       employee.salary,employee.attendanceStatus,employee.performanceScore]);
  } catch(error) { return res.status(409).json({error:'Staff record could not be created.'}); }
  if (!(await refreshCommittedEmployeeState(res))) return;
  res.status(201).json(employee);
});
app.put('/api/employees/:id',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if (!databaseWriteHealthy) return res.status(503).json({error:'Database writes are disabled.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const current=db.employees.find(item=>item.id===req.params.id && item.shopId===activeShopId);
  if (!current) return res.status(404).json({error:'Staff member not found in this branch.'});
  const employee=validateEmployee({...current,...req.body},activeShopId,current.id);
  if (!employee) return res.status(400).json({error:'Invalid staff details.'});
  let result;
  try {
    result=await pool.query(
      `UPDATE employees SET name=$1,role=$2,phone=$3,email=$4,salary=$5,
       attendance_status=$6,performance_score=$7,updated_at=NOW()
       WHERE id=$8 AND shop_id=$9`,
      [employee.name,employee.role,employee.phone,employee.email,employee.salary,
       employee.attendanceStatus,employee.performanceScore,employee.id,activeShopId]);
  } catch(error) { return res.status(409).json({error:'Staff record could not be updated.'}); }
  if (!result.rowCount) return res.status(404).json({error:'Staff member no longer exists.'});
  if (!(await refreshCommittedEmployeeState(res))) return;
  res.json(employee);
});


// --- Server-Side Gemini AI Endpoints ---

// 1. Demand Forecasting API
app.post('/api/ai/forecast', async (req, res) => {
  if (!ai) {
    return res.json({
      success: false,
      error: 'GEMINI_API_KEY_MISSING',
      advice: 'The server-side GEMINI_API_KEY environment variable is not defined in Secrets settings. Please apply a valid key to see custom real-time predictions. Returning default advisory analytical sandbox projection.',
      aiMarkdownMarkdown: `### ⚠️ AI Engine Running in Sandbox Mode

Please provide your **GEMINI_API_KEY** in the Secrets panel to activate live hardware demand forecasting.

#### 📊 General Hardware Trends (Advisory Simulation):
1. **Seasonal Surge (Construction Materials)**: Portland cement and Red bricks have a predictable summer spike up to **35% additional demand** because outdoor projects double. Auto-reorder level is advised to adjust +15%.
2. **Plumbing Accessories**: PVC valves are highly inelastic but require a higher safety factor due to low supplier frequency.
3. **Paints**: Outdoor white shielding paint has high correlation with weekend sunny forecasts.`
    });
  }

  try {
    const historicalOverview = db.transactions.map(t => ({
      date: t.date.split('T')[0],
      total: t.total,
      itemCount: t.items.reduce((acc, it) => acc + it.quantity, 0),
      items: t.items.map(it => `${it.productName} (Qty: ${it.quantity})`).join(', ')
    }));

    const catalogDetails = db.products.map(p => ({
      name: p.name,
      category: p.category,
      currentQty: p.quantity,
      reorderLevel: p.reorderLevel,
      sellingPrice: p.sellingPrice
    }));

    const prompt = `You are a professional business intelligence predictive strategist specializing in retail hardware store management.
Analyze our transactional sales logs and product listing data to generate a detailed predictive report. Our current local time is ${new Date().toISOString()}.

DATASET:
---
SALES TRANSACTIONS (Last 14 days):
${JSON.stringify(historicalOverview, null, 2)}

CATALOG STATUS:
${JSON.stringify(catalogDetails, null, 2)}
---

Generate an executive business intelligence breakdown. It MUST be returned in elegant Markdown. Include:
1. **Market Demand Forecast**: Focus on specific products with intense sales spikes or low stock levels.
2. **Category Growth Trends**: Construction vs Tools vs Paints project behavior for the summer season starting now in 2026.
3. **Smart Stock Safety Predictions**: Flag specific SKUs where inventory may soon hit zero.
4. **Actionable Suggestions**: Provide a succinct list of 3-4 structural reorders that the manager should complete immediately.
Keep the advice highly sharp and grounded strictly in the provided logs. Keep the language direct, informative and useful without placeholders.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
    });

    const aiMarkdownMarkdown = response.text || 'Predictive model generated an empty response. Please retry.';

    res.json({
      success: true,
      aiMarkdownMarkdown
    });
  } catch (error: any) {
    console.error('Gemini prediction error:', error);
    res.status(500).json({ error: 'AI Prediction failed', details: error.message });
  }
});


// 2. Smart Stock Advice / Reorder Advisor API
app.post('/api/ai/reorder-suggestions', async (req, res) => {
  // Find low stock items
  const lowStockProducts = db.products.filter(p => p.quantity <= p.reorderLevel);

  if (!ai) {
    return res.json({
      success: false,
      error: 'GEMINI_API_KEY_MISSING',
      suggestions: lowStockProducts.map(p => ({
        productId: p.id,
        name: p.name,
        currentQty: p.quantity,
        reorderLevel: p.reorderLevel,
        suggestedQty: Math.max(10, p.reorderLevel * 2),
        priority: p.quantity === 0 ? 'CRITICAL' : 'HIGH',
        reason: 'Manual safety formula calculation: low supply'
      }))
    });
  }

  try {
    const prompt = `You are an inventory optimization engine for a heavy-duty hardware shop.
Given the current set of products that are under or approaching their warning reorder level, recommend a specific suggested order quantity and a priority ('CRITICAL', 'HIGH', 'MEDIUM').
Provide logic for each suggestion based on typical construction/builder cycles.

LOW STOCK ITEMS FOR AUDIT ANALYSIS:
${JSON.stringify(lowStockProducts.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      currentQty: p.quantity,
      reorderLevel: p.reorderLevel,
      brand: p.brand
    })), null, 2)}

Return a strict, valid JSON array containing EXACTLY objects matching the following JSON schema:
[
  {
    "productId": "string",
    "name": "string",
    "suggestedQty": 12,
    "priority": "CRITICAL" | "HIGH" | "MEDIUM",
    "reason": "string describing why this amount is ideal for this product"
  }
]
Do not wrap in markdown tags or include any text other than the pure JSON string.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              productId: { type: Type.STRING },
              name: { type: Type.STRING },
              suggestedQty: { type: Type.INTEGER },
              priority: { type: Type.STRING },
              reason: { type: Type.STRING }
            },
            required: ['productId', 'name', 'suggestedQty', 'priority', 'reason']
          }
        }
      }
    });

    const parsed = JSON.parse(response.text || '[]');
    res.json({
      success: true,
      suggestions: parsed
    });
  } catch (error: any) {
    console.error('Gemini reorder logic failure:', error);
    // Return fallback logic instantly so transactions never block
    res.json({
      success: false,
      suggestions: lowStockProducts.map(p => ({
        productId: p.id,
        name: p.name,
        currentQty: p.quantity,
        reorderLevel: p.reorderLevel,
        suggestedQty: Math.max(15, p.reorderLevel * 3 - p.quantity),
        priority: p.quantity === 0 ? 'CRITICAL' : 'HIGH',
        reason: 'Automated fallback optimization: replenishment safeguard active'
      }))
    });
  }
});


// 3. Complementary Product Purchase Predictor (Checkout helper)
app.post('/api/ai/predict-complementary', async (req, res) => {
  const { currentCartIds } = req.body;

  if (!currentCartIds || currentCartIds.length === 0) {
    return res.json({ suggestions: [] });
  }

  const itemsInCart = db.products.filter(p => currentCartIds.includes(p.id));

  if (!ai) {
    // Provide neat simple local rule-based cross-sell if API key is missing
    const rulesCross: Record<string, string[]> = {
      'Construction Materials': ['Tools', 'Safety Equipment'],
      'Plumbing': ['Tools'],
      'Electrical': ['Tools'],
      'Paints': ['Tools', 'Paints'],
      'Tools': ['Safety Equipment']
    };

    const categoriesInCart = [...new Set(itemsInCart.map(i => i.category as string))];
    const targetCategories = categoriesInCart.flatMap(cat => rulesCross[cat] || ['Tools']);

    const suggestions = db.products
      .filter(p => !currentCartIds.includes(p.id) && targetCategories.includes(p.category))
      .slice(0, 3)
      .map(p => ({
        productId: p.id,
        name: p.name,
        sellingPrice: p.sellingPrice,
        reason: `Frequently purchased with items in your cart (${p.category} essentials)`
      }));

    return res.json({ success: false, suggestions });
  }

  try {
    const prompt = `You are a Sales recommendation engine for a builder's depot hardware store.
The customer currently has these items in their grocery card:
${JSON.stringify(itemsInCart.map(p => ({ name: p.name, category: p.category })), null, 2)}

Our remaining hardware catalog comprises:
${JSON.stringify(db.products.filter(p => !currentCartIds.includes(p.id)).map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      sellingPrice: p.sellingPrice
    })), null, 2)}

Suggest EXACTLY up to 3 complementary products from the remaining catalog that would be highly useful for the target contractor/DIY customer. (e.g. if buying Cement -> recommend bricks or safety gloves; if buying paint -> recommend a paint brush).
Return a strict JSON array containing objects matching this schema:
[
  {
    "productId": "string",
    "name": "string",
    "sellingPrice": 12.50,
    "reason": "short explanation of why this matches the active cart"
  }
]
Do not wrap in markdown coding tags.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              productId: { type: Type.STRING },
              name: { type: Type.STRING },
              sellingPrice: { type: Type.NUMBER },
              reason: { type: Type.STRING }
            },
            required: ['productId', 'name', 'sellingPrice', 'reason']
          }
        }
      }
    });

    const parsed = JSON.parse(response.text || '[]');
    res.json({
      success: true,
      suggestions: parsed
    });
  } catch (error) {
    res.json({ success: false, suggestions: [] });
  }
});


// Serve static frontend assets in production and launch Vite middleware in dev
// ── Supplier Payment Routes ──────────────────────────────────────────────────
app.get('/api/supplier-payments', (_req, res) => {
  const { activeShopId } = getActiveShopContext(db, _req);
  res.json(db.supplierPayments.filter((sp) => sp.shopId === activeShopId));
});

app.post('/api/supplier-payments', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(db, req);
  const { supplierId, purchaseOrderId, amount, paymentMethod, date, note } = req.body || {};
  const supplier = db.suppliers.find((s) => s.id === supplierId && s.shopId === activeShopId);
  if (!supplier) return res.status(404).json({ error: 'Supplier not found in this shop' });
  const paid = Number(amount);
  if (!Number.isFinite(paid) || paid <= 0 ||
      Math.abs(paid * 100 - Math.round(paid * 100)) > 0.00001) {
    return res.status(400).json({ error: 'Payment must be positive with at most two decimal places' });
  }
  if (purchaseOrderId && !db.purchaseOrders.some((po) =>
    po.id === purchaseOrderId && po.shopId === activeShopId && po.supplierId === supplier.id)) {
    return res.status(400).json({ error: 'Purchase order does not belong to this supplier and shop' });
  }
  const sp: SupplierPayment = {
    id: 'spay-' + randomUUID(),
    shopId: activeShopId,
    supplierId: supplier.id,
    supplierName: supplier.companyName || supplier.name,
    purchaseOrderId: purchaseOrderId || undefined,
    amount: paid,
    paymentMethod: String(paymentMethod || 'Bank Transfer'),
    date: String(date || new Date().toISOString().slice(0, 10)),
    note: typeof note === 'string' ? note.slice(0, 500) : undefined,
    createdBy: authUser?.name,
  };
  try {
    await insertSupplierPayment(sp);
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message });
  }
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Cannot reload committed supplier payment');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Supplier payment committed but refresh failed; writes disabled', error);
  }
  res.json(sp);
});

// ── Customer Credit Routes ───────────────────────────────────────────────────
app.put('/api/customers/:id/credit', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const creditLimit = Number(req.body?.creditLimit);
  if (!Number.isFinite(creditLimit) || creditLimit < 0 ||
      Math.abs(creditLimit * 100 - Math.round(creditLimit * 100)) > 0.00001) {
    return res.status(400).json({ error: 'Credit limit must be a nonnegative amount with up to two decimal places.' });
  }
  const customer = db.customers.find((c) => c.id === req.params.id && c.shopId === activeShopId);
  if (!customer) return res.status(404).json({ error: 'Customer not found in this shop' });
  try {
    await updateCustomerCreditLimit(customer.id, activeShopId, creditLimit);
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message });
  }
  const result = { ...customer, creditLimit };
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Cannot reload credit limit');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Credit limit saved but refresh failed; writes disabled', error);
  }
  res.json(result);
});

app.post('/api/customers/:id/credit-payment', requireRole(['Super Admin', 'Store Manager', 'Cashier']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const authUser = (req as AppRequest).authUser;
  const { amount, paymentMethod, note } = req.body || {};
  const customer = db.customers.find((c) => c.id === req.params.id && c.shopId === activeShopId);
  if (!customer) return res.status(404).json({ error: 'Customer not found in this shop' });
  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0 ||
      Math.abs(normalizedAmount * 100 - Math.round(normalizedAmount * 100)) > 0.00001) {
    return res.status(400).json({ error: 'Payment amount must be positive with up to two decimal places.' });
  }
  const payment: CustomerCreditPayment = {
    id: 'cpay-' + randomUUID(),
    shopId: activeShopId,
    customerId: customer.id,
    customerName: customer.name,
    amount: normalizedAmount,
    date: new Date().toISOString().split('T')[0],
    paymentMethod: String(paymentMethod || 'Cash'),
    note: typeof note === 'string' ? note.slice(0, 500) : undefined,
    createdBy: authUser?.name,
  };
  try {
    await addCustomerCreditPayment(payment);
  } catch (error) {
    return res.status(409).json({ error: (error as Error).message });
  }
  const result = { ...customer, creditBalance: Math.round(Math.max(0, customer.creditBalance - normalizedAmount) * 100) / 100 };
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Cannot reload committed customer credit payment');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Credit payment committed but refresh failed; writes disabled', error);
  }
  res.json({ customer: result, payment });
});

app.get('/api/customer-credit-payments', (_req, res) => {
  const { activeShopId } = getActiveShopContext(db, _req);
  res.json(db.customerCreditPayments.filter((p) => p.shopId === activeShopId));
});

// ── Quotation Routes ─────────────────────────────────────────────────────────
app.get('/api/quotations', (_req, res) => {
  const { activeShopId } = getActiveShopContext(db, _req);
  res.json(db.quotations.filter((q) => q.shopId === activeShopId));
});

const refreshCommittedQuoteState=async(res:express.Response)=>{
  try {
    const fresh=await loadStateFromNormalized();
    if(!fresh)throw new Error('Cannot refresh quotations after a committed write.');
    db=fresh;
    return true;
  }catch(error){
    databaseWriteHealthy=false;
    console.error('Quotation committed but reload failed; writes disabled.',error);
    res.status(503).json({error:'Quotation change committed but reload failed. Reconcile before retrying.'});
    return false;
  }
};

app.post('/api/quotations',requireRole(['Super Admin','Store Manager','Cashier']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const auth=(req as AppRequest).authUser;
  const customerId=String(req.body?.customerId||'').trim();
  const customer=db.customers.find(row=>row.id===customerId&&row.shopId===activeShopId);
  if(!customer)return res.status(400).json({error:'Select a registered wholesale customer shop.'});
  const items=req.body?.items;
  const discountAmount=Number(req.body?.discountAmount??0);
  const dateRaw=String(req.body?.validUntil||'');
  const notes=String(req.body?.notes||'');
  if(!Array.isArray(items)||!items.length||items.length>100||
     !Number.isFinite(discountAmount)||discountAmount<0||discountAmount>1_000_000_000||
     notes.length>2000||(dateRaw&&!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)))
    return res.status(400).json({error:'Invalid quotation items, discount, date, or notes.'});
  let lineSubtotal=0;
  const normalizedItems:Quotation['items']=[];
  for(const raw of items){
    const product=db.products.find(row=>row.id===raw?.productId&&row.shopId===activeShopId);
    const quantity=Number(raw?.quantity);
    const unitPrice=Number(raw?.sellingPrice);
    const discount=Number(raw?.discount??0);
    const discountFixed=Number(raw?.discountAmount??0);
    if(!product||!Number.isSafeInteger(quantity)||quantity<1||quantity>1_000_000_000||
       !Number.isFinite(unitPrice)||unitPrice<0||unitPrice>1_000_000_000||
       !Number.isFinite(discount)||discount<0||discount>100||
       !Number.isFinite(discountFixed)||discountFixed<0||
       (unitPrice*quantity*(1-discount/100))<discountFixed) {
      return res.status(400).json({error:'Invalid product or quantity, unit price, and discount.'});
    }
    const lineAmount=roundMoney(unitPrice*quantity*(1-discount/100)-discountFixed);
    lineSubtotal+=lineAmount;
    normalizedItems.push({productId:product.id,productName:product.name,
      quantity,sellingPrice:unitPrice,discount,discountAmount:discountFixed});
  }
  if(!Number.isFinite(lineSubtotal)||lineSubtotal>9_000_000_000)
    return res.status(400).json({error:'Quotation total exceeds allowed range.'});
  const profile=db.settings.shopProfiles?.find(shop=>shop.id===activeShopId);
  const {subtotal,tax,total}=invoiceTotals(lineSubtotal,profile?.taxRate??db.settings.taxRate,discountAmount);
  if(!Number.isFinite(total)||total<0)return res.status(400).json({error:'Invalid quotation totals.'});
  const quotation:Quotation={
    id:'quo-'+randomUUID(),shopId:activeShopId,quoteNumber:'ARS-QUO-'+randomUUID().slice(0,12).toUpperCase(),
    date:new Date().toISOString(),validUntil:dateRaw||undefined,
    customerId:customer.id,customerName:customer.name,customerPhone:customer.phone||undefined,
    items:normalizedItems,subtotal,tax,discountAmount,total,status:'Draft',
    notes:notes||undefined,createdBy:auth?.name||'System'
  };
  try{
    await pool.query(
      `INSERT INTO quotations(id,shop_id,quote_number,date,valid_until,customer_id,customer_name,customer_phone,
       items,subtotal,tax,discount_amount,total,status,notes,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,'Draft',$14,$15)`,
      [quotation.id,activeShopId,quotation.quoteNumber,quotation.date,quotation.validUntil||null,
       quotation.customerId,quotation.customerName,quotation.customerPhone||null,
       JSON.stringify(quotation.items),quotation.subtotal,quotation.tax,quotation.discountAmount,
       quotation.total,quotation.notes||null,quotation.createdBy]);
  }catch(error){return res.status(409).json({error:'Could not save quotation.'});}
  if(!(await refreshCommittedQuoteState(res)))return;
  res.status(201).json(quotation);
});

app.put('/api/quotations/:id/status',requireRole(['Super Admin','Store Manager','Cashier']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const status=String(req.body?.status||'');
  // Conversion always uses the separate atomic sale endpoint.
  const allowed:Record<string,string[]>={Draft:['Sent'],Sent:['Accepted','Expired'],Accepted:['Expired']};
  const client=await pool.connect();
  let changed:Quotation|undefined;
  try{
    await client.query('BEGIN');
    const row=await client.query('SELECT status FROM quotations WHERE id=$1 AND shop_id=$2 FOR UPDATE',[req.params.id,activeShopId]);
    if(!row.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Quotation not found.'});}
    if(!(allowed[row.rows[0].status]||[]).includes(status)){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Invalid quotation state change.'});
    }
    await client.query('UPDATE quotations SET status=$1 WHERE id=$2 AND shop_id=$3',[status,req.params.id,activeShopId]);
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    return res.status(409).json({error:'Quotation status change failed.'});
  }finally{client.release();}
  if(!(await refreshCommittedQuoteState(res)))return;
  changed=db.quotations.find(q=>q.id===req.params.id&&q.shopId===activeShopId);
  res.json(changed);
});

app.post('/api/quotations/:id/convert',requireRole(['Super Admin','Store Manager','Cashier']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId,activeShopName}=getActiveShopContext(db,req);
  const auth=(req as AppRequest).authUser;
  const q=db.quotations.find(item=>item.id===req.params.id&&item.shopId===activeShopId);
  if(!q)return res.status(404).json({error:'Quotation not found.'});
  if(q.status!=='Accepted'||q.convertedToTxId)return res.status(409).json({error:'Accept the quotation before invoicing, and do not invoice it twice.'});
  const customer=db.customers.find(row=>row.id===q.customerId&&row.shopId===activeShopId);
  if(!customer)return res.status(409).json({error:'Quotation customer is no longer available.'});
  const salesRep=db.employees.find(employee =>
    employee.id===String(req.body?.salesRepId||'') && employee.shopId===activeShopId);
  if(!salesRep||!salesRep.name?.trim())
    return res.status(400).json({error:'Select a registered Sales Representative before invoicing.'});
  const paymentMethod=String(req.body?.paymentMethod||'Bank Transfer');
  if(!['Cash','Bank Transfer','Credit Account'].includes(paymentMethod))
    return res.status(400).json({error:'Unsupported quotation payment method.'});
  const items:SalesTransaction['items']=[];
  for(const line of q.items){
    const product=db.products.find(p=>p.id===line.productId&&p.shopId===activeShopId);
    if(!product||product.status==='Inactive'||product.variants?.length){
      return res.status(409).json({error:'Product missing, inactive or variant-managed. Use standard checkout for this product.'});
    }
    if(!Number.isSafeInteger(line.quantity)||line.quantity<1||
       !Number.isFinite(line.sellingPrice)||line.sellingPrice<0)
      return res.status(409).json({error:'Quotation contains invalid line quantities or prices.'});
    items.push({...line,costPrice:product.costPrice||0});
  }
  const tx:SalesTransaction={
    id:'tx-'+randomUUID(),shopId:activeShopId,
    invoiceNumber:`${db.settings.invoicePrefix}-${Date.now()}-${randomUUID().slice(0,6).toUpperCase()}`,
    date:new Date().toISOString(),customerId:customer.id,customerName:customer.name,
    customerPhone:customer.phone||undefined,customerAddress:customer.address||undefined,
    cashierName:auth?.name||'System',salesRepId:salesRep.id,salesRepName:salesRep.name,items,subtotal:q.subtotal,tax:q.tax,
    discountAmount:q.discountAmount,total:q.total,
    paymentMethod:paymentMethod as SalesTransaction['paymentMethod'],
    cashReceived:paymentMethod==='Cash'?q.total:undefined,
    changeDue:paymentMethod==='Cash'?0:undefined,
    paymentStatus:paymentMethod==='Credit Account'?'CREDIT SALE':'PAID',
    status:'Completed'
  };
  try{
    await checkoutTransaction(tx,auth?.role||'Cashier',activeShopName,q.id);
  }catch(error){
    return res.status(409).json({error:(error as Error).message||'Quotation conversion failed.'});
  }
  if(!(await refreshCommittedQuoteState(res)))return;
  const recorded=db.transactions.find(item=>item.id===tx.id&&item.shopId===activeShopId);
  const updated=db.quotations.find(item=>item.id===q.id&&item.shopId===activeShopId);
  res.json({transaction:recorded||tx,quotation:updated});
});

app.delete('/api/quotations/:id',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  let result;
  try{
    result=await pool.query(
      "DELETE FROM quotations WHERE id=$1 AND shop_id=$2 AND status IN ('Draft','Expired') AND converted_to_tx_id IS NULL",
      [req.params.id,activeShopId]);
  }catch(error){return res.status(409).json({error:'Quotation deletion failed.'});}
  if(!result.rowCount)return res.status(409).json({error:'Only an unconverted draft or expired quotation can be removed.'});
  if(!(await refreshCommittedQuoteState(res)))return;
  res.json({success:true});
});

// ── Cash Shift Routes ────────────────────────────────────────────────────────
app.get('/api/shifts', (_req, res) => {
  const { activeShopId } = getActiveShopContext(db, _req);
  res.json(db.cashShifts.filter((s) => s.shopId === activeShopId));
});

app.get('/api/shifts/current', (_req, res) => {
  const { activeShopId } = getActiveShopContext(db, _req);
  const open = db.cashShifts.find((s) => s.shopId === activeShopId && s.status === 'Open');
  res.json(open || null);
});

// Cash shift changes use short transactional SQL writes and serializable shop locks.
// The shift is tied to the cashier who actually signs in, never a user-entered rep.
app.post('/api/shifts/open', requireRole(['Super Admin','Store Manager','Cashier']), async(req,res)=>{
  if(!databaseWriteHealthy) return res.status(503).json({error:'Database writes are disabled.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const authUser=(req as AppRequest).authUser;
  const openingFloat=Number(req.body?.openingFloat);
  if(!Number.isFinite(openingFloat)||openingFloat<0||openingFloat>1_000_000_000||
     Math.abs(openingFloat*100-Math.round(openingFloat*100))>0.00001)
    return res.status(400).json({error:'Opening cash must be a valid nonnegative amount.'});
  const client=await pool.connect();
  let shift:CashShift|undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ars-cash-shifts'),hashtext($1))",[activeShopId]);
    const current=await client.query("SELECT id FROM cash_shifts WHERE shop_id=$1 AND status='Open' LIMIT 1",[activeShopId]);
    if(current.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({error:'A cash shift is already open.'});
    }
    shift={id:'shift-'+randomUUID(),shopId:activeShopId,cashierName:authUser?.name||'Cashier',
      openedAt:new Date().toISOString(),openingFloat,status:'Open'};
    await client.query(
      `INSERT INTO cash_shifts(id,shop_id,cashier_name,opened_at,opening_float,status)
       VALUES($1,$2,$3,$4,$5,'Open')`,
       [shift.id,activeShopId,shift.cashierName,shift.openedAt,openingFloat]);
    await client.query(
      `INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details)
       VALUES($1,$2,NOW(),$3,$4,'Shift Opened',$5)`,
      ['act-'+randomUUID(),activeShopId,shift.cashierName,authUser?.role||'Cashier',
       `Shift started with float Rs.${openingFloat.toFixed(2)}.`]);
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    return res.status(409).json({error:'Unable to open shift safely.'});
  } finally {client.release();}
  try {
    const fresh=await loadStateFromNormalized();
    if(!fresh)throw Error('Refresh failed');
    db=fresh;
    res.status(201).json(shift);
  } catch(error) {
    databaseWriteHealthy=false;
    res.status(503).json({error:'Shift opened but reload failed. Reconcile before retrying.'});
  }
});

app.post('/api/shifts/:id/close',requireRole(['Super Admin','Store Manager','Cashier']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database writes are disabled.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const authUser=(req as AppRequest).authUser;
  const closingCash=Number(req.body?.closingCash);
  const notes=String(req.body?.notes||'');
  if(!Number.isFinite(closingCash)||closingCash<0||closingCash>1_000_000_000||
     Math.abs(closingCash*100-Math.round(closingCash*100))>0.00001||notes.length>2000)
    return res.status(400).json({error:'Invalid closing cash or notes.'});
  const client=await pool.connect();
  let result:CashShift|undefined;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext(\'ars-cash-shifts\'),hashtext($1))',[activeShopId]);
    const rows=await client.query("SELECT * FROM cash_shifts WHERE id=$1 AND shop_id=$2 FOR UPDATE",[req.params.id,activeShopId]);
    if(!rows.rowCount) {await client.query('ROLLBACK');return res.status(404).json({error:'Shift not found in this branch.'});}
    const shift=rows.rows[0];
    if(shift.status!=='Open') {await client.query('ROLLBACK');return res.status(409).json({error:'Shift is already closed.'});}
    const totals=await client.query(
      `SELECT COALESCE(SUM(total),0) AS sales FROM sales_transactions
       WHERE shop_id=$1 AND payment_method='Cash' AND COALESCE(status,'Completed')<>'Refunded'
       AND date >= $2 AND date <= NOW()`,[activeShopId,shift.opened_at]);
    const expectedCash=Math.round((Number(shift.opening_float)+Number(totals.rows[0].sales))*100)/100;
    const cashDifference=Math.round((closingCash-expectedCash)*100)/100;
    const closedAt=new Date().toISOString();
    await client.query(
      `UPDATE cash_shifts SET closed_at=$1,closing_cash=$2,expected_cash=$3,
       cash_difference=$4,status='Closed',notes=$5 WHERE id=$6 AND shop_id=$7 AND status='Open'`,
      [closedAt,closingCash,expectedCash,cashDifference,notes,req.params.id,activeShopId]);
    await client.query(
      `INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details)
       VALUES($1,$2,NOW(),$3,$4,'Shift Closed',$5)`,
      ['act-'+randomUUID(),activeShopId,authUser?.name||'Cashier',authUser?.role||'Cashier',
       `Shift closed. Expected Rs.${expectedCash.toFixed(2)}, actual Rs.${closingCash.toFixed(2)}, difference Rs.${cashDifference.toFixed(2)}.`]);
    await client.query('COMMIT');
    result={id:shift.id,shopId:activeShopId,cashierName:shift.cashier_name,openedAt:shift.opened_at,
      closedAt,openingFloat:Number(shift.opening_float),closingCash,expectedCash,cashDifference,status:'Closed',notes};
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    return res.status(409).json({error:'Unable to close shift safely.'});
  } finally {client.release();}
  try{
    const fresh=await loadStateFromNormalized();
    if(!fresh)throw Error('Refresh failed');
    db=fresh;
    res.json(result);
  }catch(error){
    databaseWriteHealthy=false;
    res.status(503).json({error:'Shift close committed but reload failed. Reconcile before retrying.'});
  }
});

// ── Reports Route ────────────────────────────────────────────────────────────
app.get('/api/reports/sales', (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const { from, to } = req.query;
  const fromDate = from ? new Date(String(from)) : new Date(0);
  const toDate = to ? new Date(String(to) + 'T23:59:59Z') : new Date();
  const filtered = db.transactions.filter((t) => {
    if (t.shopId !== activeShopId) return false;
    const d = new Date(t.date);
    return d >= fromDate && d <= toDate;
  });
  const productCostMap = new Map(db.products.map((p) => [p.id, p.costPrice]));
  const rows = filtered.map((t) => {
    const profit = t.status !== 'Refunded'
      ? t.items.reduce((sum, item) => {
          const rev = item.sellingPrice * item.quantity * (1 - (item.discount || 0) / 100) - (item.discountAmount || 0);
          const cost = (item.costPrice || productCostMap.get(item.productId) || item.sellingPrice) * item.quantity;
          return sum + (rev - cost);
        }, 0) - (t.discountAmount || 0)
      : 0;
    return { invoiceNumber: t.invoiceNumber, date: t.date.split('T')[0], customer: t.customerName, salesRepresentative: t.salesRepName || 'Not recorded', items: t.items.length, subtotal: t.subtotal, tax: t.tax, discount: t.discountAmount, total: t.total, profit: Math.round(profit * 100) / 100, paymentMethod: t.paymentMethod, status: t.status || 'Completed' };
  });
  const totals = { revenue: rows.filter((r) => r.status !== 'Refunded').reduce((sum, r) => sum + r.total, 0), profit: rows.reduce((sum, r) => sum + r.profit, 0), transactions: rows.length, refunds: rows.filter((r) => r.status === 'Refunded').length };
  res.json({ rows, totals, from: fromDate, to: toDate });
});

// ARS import shipment register. Each shipment references an existing, shop-scoped
// purchase order. Receiving uses the existing atomic PO receiver, not a second
// stock posting path. Repeat receipt is rejected at the PO row lock.
const lkrAmount = (raw: unknown) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000_000 &&
    Math.abs(n * 100 - Math.round(n * 100)) <= 0.00001 ? n : null;
};

// Goods receipts are append-only, idempotent and stock updates are transactional.
// The existing full-order receipt is forbidden after a partial receipt.
app.get('/api/ars/purchases/:id/receipts',requireRole(['Super Admin','Store Manager','Inventory Staff']),async(req,res)=>{
  const {activeShopId}=getActiveShopContext(db,req);
  try {
    const order=await pool.query('SELECT id,status FROM purchase_orders WHERE id=$1 AND shop_id=$2',[req.params.id,activeShopId]);
    if(!order.rowCount)return res.status(404).json({error:'Purchase order not found.'});
    const lines=await pool.query(
      `SELECT i.id AS "purchaseOrderItemId",i.product_id AS "productId",i.product_name AS "productName",
         i.quantity AS ordered,COALESCE(SUM(ri.quantity),0)::integer AS received
       FROM purchase_order_items i LEFT JOIN ars_receipt_batch_items ri ON ri.purchase_order_item_id=i.id
       WHERE i.purchase_order_id=$1 GROUP BY i.id ORDER BY i.id`,[req.params.id]);
    const batches=await pool.query(
      `SELECT id,request_key,received_by,note,created_at FROM ars_receipt_batches
       WHERE shop_id=$1 AND purchase_order_id=$2 ORDER BY created_at DESC`,[activeShopId,req.params.id]);
    res.json({status:order.rows[0].status,items:lines.rows.map((line:any)=>({
      ...line,ordered:Number(line.ordered),received:Number(line.received),
      remaining:Number(line.ordered)-Number(line.received)
    })),batches:batches.rows});
  }catch(error){res.status(503).json({error:'Unable to load goods receipts.'});}
});
app.post('/api/ars/purchases/:id/receipts',requireRole(['Super Admin','Store Manager','Inventory Staff']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database writes are disabled until recovery.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const requestKey=String(req.body?.requestKey||'').trim();
  const note=String(req.body?.note||'');
  const rawItems=req.body?.items;
  if(!Array.isArray(rawItems))return res.status(400).json({error:'Receipt items must be an array.'});
  const items=rawItems.map((item:any)=>({purchaseOrderItemId:Number(item?.purchaseOrderItemId),quantity:Number(item?.quantity)}));
  try {
    const result=await receivePartialOrder(pool,{
      shopId:activeShopId,poId:req.params.id,requestKey,
      user:(req as AppRequest).authUser?.name||'Inventory Staff',note,items
    });
    if(!result.repeated) {
      try {
        const refreshed=await loadStateFromNormalized();
        if(!refreshed)throw new Error('Cannot reload committed goods receipt.');
        db=refreshed;
      } catch(error) {
        databaseWriteHealthy=false;
        console.error('Goods receipt committed but refresh failed; writes disabled.',error);
        return res.status(503).json({error:'Goods receipt committed, but cache refresh failed. Do not retry with a new key; reconcile first.',batchId:result.batchId});
      }
    }
    res.status(result.repeated?200:201).json(result);
  }catch(error){res.status(409).json({error:(error as Error).message});}
});

app.get('/api/ars/import-shipments', requireRole(['Super Admin','Store Manager','Inventory Staff']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  try {
    const rows = await pool.query(
      `SELECT s.*, p.po_number, p.supplier_name, p.status AS purchase_status
       FROM ars_import_shipments s
       JOIN purchase_orders p ON p.id=s.purchase_order_id AND p.shop_id=s.shop_id
       WHERE s.shop_id=$1 ORDER BY s.created_at DESC LIMIT 250`, [activeShopId]);
    res.json(rows.rows.map((row) => ({
      ...row,
      status: row.purchase_status === 'Received' ? 'Received' : row.purchase_status === 'Partially Received' ? 'Partially Received' : row.purchase_status === 'Cancelled' ? 'Cancelled' : 'In Transit',
    })));
  } catch { res.status(503).json({error: 'Could not load import shipments.'}); }
});
app.post('/api/ars/import-shipments', requireRole(['Super Admin','Store Manager']), async (req,res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const poId=String(req.body?.purchaseOrderId||'').trim();
  const reference=String(req.body?.shipmentReference||'').trim();
  const currency=String(req.body?.currency||'CNY').toUpperCase();
  const container=String(req.body?.containerNumber||'').trim();
  const notes=String(req.body?.notes||'').trim();
  const eta=String(req.body?.etaDate||'').trim();
  const fx=Number(req.body?.exchangeRateLkr);
  const charges=[req.body?.freightLkr??0,req.body?.customsLkr??0,req.body?.clearanceLkr??0].map(lkrAmount);
  if (!poId || !reference || reference.length>90 || container.length>80 || notes.length>2000 ||
      !['CNY','USD','LKR'].includes(currency) || !Number.isFinite(fx) || fx<=0 || fx>100000 ||
      charges.some(n=>n===null) || (eta && !/^\d{4}-\d{2}-\d{2}$/.test(eta))) {
    return res.status(400).json({error:'Valid purchase order, shipment reference, currency, exchange rate and expenses are required.'});
  }
  try {
    const po=await pool.query('SELECT status FROM purchase_orders WHERE id=$1 AND shop_id=$2',[poId,activeShopId]);
    if (!po.rowCount || !['Pending','Ordered'].includes(po.rows[0].status)) {
      return res.status(409).json({error:'Select an open purchase order belonging to this branch.'});
    }
    const id='shipment-'+randomUUID();
    const auth=(req as AppRequest).authUser!;
    await pool.query(`INSERT INTO ars_import_shipments
      (id,shop_id,purchase_order_id,shipment_reference,container_number,eta_date,invoice_currency,exchange_rate_lkr,freight_lkr,customs_lkr,clearance_lkr,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id,activeShopId,poId,reference,container,eta||null,currency,fx,charges[0],charges[1],charges[2],notes,auth.email]);
    res.status(201).json({id,shipmentReference:reference,status:'In Transit'});
  } catch(e:any) {
    res.status(e?.code==='23505'?409:503).json({error:e?.code==='23505'?'Shipment reference or purchase order already registered.':'Could not register import shipment.'});
  }
});
// Legacy all-at-once receipt has been intentionally disabled. Staff must
// submit a traceable GRN with explicit per-line quantities instead.
app.post('/api/ars/import-shipments/:id/receive', requireRole(['Super Admin','Store Manager','Inventory Staff']), (_req,res)=>{
  res.status(409).json({error:'Use Warehouse Receiving to post verified item quantities. The legacy full-shipment receipt is disabled.'});
});

// Recording a profit allocation is not a payout or confirmation of money sent.
// Only the Super Admin may record an allocation supported by approved statements.
app.get('/api/ars/partner-profits',requireRole(['Super Admin']),async(req,res)=>{
  const {activeShopId}=getActiveShopContext(db,req);
  try {
    const data=await pool.query(
      `SELECT a.id,a.period_key,a.approved_profit_lkr,a.approval_reference,
       a.note,a.approved_by,a.allocated_at,
       COALESCE(jsonb_agg(jsonb_build_object('partnerId',p.id,'name',p.name,
         'ownershipPercent',s.ownership_basis_points / 100.0,'allocatedLkr',s.allocated_lkr)
          ORDER BY p.id) FILTER(WHERE s.partner_id IS NOT NULL),'[]'::jsonb) AS shares
       FROM ars_partner_profit_allocations a
       LEFT JOIN ars_partner_profit_shares s ON s.allocation_id=a.id
       LEFT JOIN ars_business_partners p ON p.id=s.partner_id AND p.shop_id=a.shop_id
       WHERE a.shop_id=$1
       GROUP BY a.id ORDER BY a.period_key DESC LIMIT 120`,[activeShopId]);
    res.json(data.rows);
  }catch(error){res.status(503).json({error:'Could not load confidential partner profit records.'});}
});
app.post('/api/ars/partner-profits',requireRole(['Super Admin']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  try {
    const result=await recordArsProfitAllocation(pool,{
      shopId:activeShopId,
      periodKey:String(req.body?.periodKey||''),
      approvedProfitLkr:Number(req.body?.approvedProfitLkr),
      approvalReference:String(req.body?.approvalReference||''),
      approvedBy:(req as AppRequest).authUser?.email||'System',
      note:String(req.body?.note||''),
    });
    res.status(201).json(result);
  }catch(error){res.status(409).json({error:(error as Error).message});}
});

// Partner records and immutable capital contributions/drawings. Financial
// statements and profit distributions must NOT be inferred from these entries.
app.get('/api/ars/partners',requireRole(['Super Admin']),async(req,res)=>{
  const {activeShopId}=getActiveShopContext(db,req);
  try {
    const [partners,entries]=await Promise.all([
      pool.query('SELECT * FROM ars_business_partners WHERE shop_id=$1 ORDER BY is_active DESC,created_at,id',[activeShopId]),
      pool.query('SELECT * FROM ars_partner_capital_entries WHERE shop_id=$1 ORDER BY entry_date DESC,created_at DESC LIMIT 500',[activeShopId])
    ]);
    res.json({partners:partners.rows,entries:entries.rows});
  }catch{res.status(503).json({error:'Could not load confidential partner ledger.'});}
});
app.post('/api/ars/partners',requireRole(['Super Admin']),async(req,res)=>{
  const {activeShopId}=getActiveShopContext(db,req);
  const name=String(req.body?.name||'').trim();
  const pctRaw=req.body?.ownershipPercent;
  const pct=pctRaw===null || pctRaw===undefined || pctRaw==='' ? null : Number(pctRaw);
  if(name.length<2||name.length>120 || (pct!==null && (!Number.isFinite(pct)||pct<0||pct>100||Math.abs(pct*100-Math.round(pct*100))>0.00001))) {
    return res.status(400).json({error:'Provide partner name and optional valid ownership percentage.'});
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[activeShopId+':ars-partners']);
    const partners=await client.query('SELECT ownership_percent FROM ars_business_partners WHERE shop_id=$1 FOR UPDATE',[activeShopId]);
    const allocated=partners.rows.reduce((sum,row)=>sum+Number(row.ownership_percent||0),0);
    if(pct!==null && allocated+pct>100.000001){await client.query('ROLLBACK');return res.status(409).json({error:'Total partner ownership cannot exceed 100%.'});}
    const id='partner-'+randomUUID();
    await client.query('INSERT INTO ars_business_partners (id,shop_id,name,ownership_percent,created_by) VALUES ($1,$2,$3,$4,$5)',
      [id,activeShopId,name,pct,(req as AppRequest).authUser!.email]);
    await client.query(`INSERT INTO ars_partner_ownership_audit
      (id,shop_id,partner_id,old_percent,new_percent,change_type,reference,changed_by)
      VALUES($1,$2,$3,NULL,$4,'Registered',$5,$6)`,
      ['ownership-audit-'+randomUUID(),activeShopId,id,pct,'New partner registration',(req as AppRequest).authUser!.email]);
    await client.query('COMMIT');
    res.status(201).json({id,name,ownership_percent:pct});
  }catch{await client.query('ROLLBACK').catch(()=>{});res.status(503).json({error:'Could not register partner.'});}
  finally{client.release();}
});
app.put('/api/ars/partners/:id/ownership',requireRole(['Super Admin']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const reference=String(req.body?.reference||'').trim();
  if(reference.length<3||reference.length>160)
    return res.status(400).json({error:'Ownership changes require an approval or reason reference (3–160 characters).'});
  const pctRaw=req.body?.ownershipPercent;
  const pct=pctRaw===null||pctRaw===''?null:Number(pctRaw);
  if(pct!==null && (!Number.isFinite(pct)||pct<0||pct>100||Math.abs(pct*100-Math.round(pct*100))>0.00001)) {
    return res.status(400).json({error:'Ownership must be blank or 0–100% with two decimals.'});
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[activeShopId+':ars-partners']);
    const partners=await client.query('SELECT id,ownership_percent,is_active FROM ars_business_partners WHERE shop_id=$1 FOR UPDATE',[activeShopId]);
    const existing=partners.rows.find(p=>p.id===req.params.id);
    if(!existing){await client.query('ROLLBACK');return res.status(404).json({error:'Partner not found.'});}
    if(!existing.is_active){await client.query('ROLLBACK');return res.status(409).json({error:'Reactivate this partner before changing ownership.'});}
    const others=partners.rows.filter(p=>p.id!==req.params.id && p.is_active).reduce((sum,p)=>sum+Number(p.ownership_percent||0),0);
    if(pct!==null && others+pct>100.000001){await client.query('ROLLBACK');return res.status(409).json({error:'Total partner ownership cannot exceed 100%.'});}
    await client.query('UPDATE ars_business_partners SET ownership_percent=$1 WHERE id=$2 AND shop_id=$3',[pct,req.params.id,activeShopId]);
    await client.query(`INSERT INTO ars_partner_ownership_audit
      (id,shop_id,partner_id,old_percent,new_percent,change_type,reference,changed_by)
      VALUES($1,$2,$3,$4,$5,'Updated',$6,$7)`,
      ['ownership-audit-'+randomUUID(),activeShopId,req.params.id,existing.ownership_percent,pct,
        reference,(req as AppRequest).authUser!.email]);
    await client.query('COMMIT');
    res.json({id:req.params.id,ownership_percent:pct});
  }catch{await client.query('ROLLBACK').catch(()=>{});res.status(503).json({error:'Ownership update failed.'});}
  finally{client.release();}
});
// Historical allocations and capital entries always retain the original partner ID.
// A deactivated partner is never deleted and cannot receive new distributions.
app.post('/api/ars/partners/:id/status',requireRole(['Super Admin']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const isActive=req.body?.isActive;
  const reference=String(req.body?.reference||'').trim();
  if(typeof isActive!=='boolean'||reference.length<3||reference.length>160)
    return res.status(400).json({error:'Provide partner status and a change reference (3–160 characters).'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[activeShopId+':ars-partners']);
    const partner=await client.query(
      'SELECT id,is_active,ownership_percent FROM ars_business_partners WHERE id=$1 AND shop_id=$2 FOR UPDATE',
      [req.params.id,activeShopId]);
    if(!partner.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Partner not found.'});}
    const old=partner.rows[0];
    if(old.is_active===isActive){await client.query('ROLLBACK');return res.status(409).json({error:'Partner already has this status.'});}
    if(!isActive && old.ownership_percent!==null && Number(old.ownership_percent)!==0){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Set this partner ownership to 0% or unassigned before deactivating. Rebalance active shares first.'});
    }
    await client.query('UPDATE ars_business_partners SET is_active=$1 WHERE id=$2 AND shop_id=$3',
      [isActive,req.params.id,activeShopId]);
    await client.query(`INSERT INTO ars_partner_ownership_audit
      (id,shop_id,partner_id,old_percent,new_percent,change_type,reference,changed_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      ['ownership-audit-'+randomUUID(),activeShopId,req.params.id,old.ownership_percent,
        old.ownership_percent,isActive?'Reactivated':'Deactivated',reference,(req as AppRequest).authUser!.email]);
    await client.query('COMMIT');
    res.json({id:req.params.id,is_active:isActive});
  }catch{await client.query('ROLLBACK').catch(()=>{});res.status(503).json({error:'Partner status update failed.'});}
  finally{client.release();}
});

app.get('/api/ars/partner-ownership-audit',requireRole(['Super Admin']),async(req,res)=>{
  const {activeShopId}=getActiveShopContext(db,req);
  try{
    const result=await pool.query(`SELECT a.id,a.partner_id,p.name AS partner_name,a.old_percent,a.new_percent,
      a.change_type,a.reference,a.changed_by,a.changed_at
      FROM ars_partner_ownership_audit a JOIN ars_business_partners p ON p.id=a.partner_id
      WHERE a.shop_id=$1 ORDER BY a.changed_at DESC LIMIT 200`,[activeShopId]);
    res.json(result.rows);
  }catch{res.status(503).json({error:'Could not load ownership audit history.'});}
});

app.post('/api/ars/partner-capital',requireRole(['Super Admin']),async(req,res)=>{
  const {activeShopId}=getActiveShopContext(db,req);
  const partnerId=String(req.body?.partnerId||'').trim();
  const entryType=String(req.body?.entryType||'');
  const amount=lkrAmount(req.body?.amountLkr);
  const reference=String(req.body?.reference||'').trim();
  const note=String(req.body?.note||'').trim();
  const date=String(req.body?.entryDate||'').trim();
  if(!['Contribution','Drawing'].includes(entryType)||amount===null||amount<=0||!partnerId||!reference||reference.length>120||
    note.length>1000|| !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({error:'Partner, valid amount, date, reference and contribution/drawing type are required.'});
  }
  try{
    const partner=await pool.query('SELECT id FROM ars_business_partners WHERE id=$1 AND shop_id=$2',[partnerId,activeShopId]);
    if(!partner.rowCount)return res.status(404).json({error:'Partner not found for this branch.'});
    const id='capital-'+randomUUID();
    await pool.query(`INSERT INTO ars_partner_capital_entries
      (id,shop_id,partner_id,entry_type,amount_lkr,entry_date,reference,note,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id,activeShopId,partnerId,entryType,amount,date,reference,note,(req as AppRequest).authUser!.email]);
    res.status(201).json({id,partnerId,entryType,amountLkr:amount});
  }catch{res.status(503).json({error:'Unable to record partner capital entry.'});}
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

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

async function startServer() {
  // Acquire before any schema creation, seeding, or in-memory hydration.
  await acquireSingleWriterLease();
  await initPostgres();
  await initPartialReceivingTables(pool);
  await initArsProfitLedger(pool);
  await loadDb();

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server fully functional on http://0.0.0.0:${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received. Shutting down gracefully...`);
    const timeout = setTimeout(() => {
      console.error('Graceful shutdown timed out. Forcing exit.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    server.close(async () => {
      clearTimeout(timeout);
      try {
        await releaseSingleWriterLease();
        await pool.end();
      } catch (error) {
        console.error('Error while closing PostgreSQL pool:', error);
      }
      process.exit(0);
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

startServer().catch(async (error) => {
  console.error('Server startup failed:', error);
  try {
    await releaseSingleWriterLease();
    await pool.end();
  } catch (shutdownError) {
    console.error('Cleanup after failed startup failed:', shutdownError);
  }
  process.exit(1);
});
