import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: '.env.local' });
dotenv.config();

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const PORT = Number(process.env.PORT || 3000);
export const SHUTDOWN_TIMEOUT_MS = 10_000;
export const PROCESS_STARTED_AT = Date.now();

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
export const CORS_ALLOWED_ORIGINS = configuredCorsOrigins.length > 0
  ? configuredCorsOrigins
  : (IS_PRODUCTION ? [] : DEV_ALLOWED_ORIGINS);

export const CORS_ALLOW_CREDENTIALS = String(process.env.CORS_ALLOW_CREDENTIALS || 'true').toLowerCase() !== 'false';
export const CORS_ALLOWED_HEADERS = parseCsvList(process.env.CORS_ALLOWED_HEADERS).length > 0
  ? parseCsvList(process.env.CORS_ALLOWED_HEADERS)
  : ['Authorization', 'Content-Type', 'X-Shop-Id'];
export const CORS_ALLOWED_METHODS = parseCsvList(process.env.CORS_ALLOWED_METHODS).length > 0
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

export const CONTENT_SECURITY_POLICY = [
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

export const isCorsOriginAllowed = (origin: string) => CORS_ALLOWED_ORIGINS.includes(origin);

export const UPLOADS_ROOT_DIR = path.join(process.cwd(), 'uploads');
export const PRODUCT_UPLOADS_DIR = path.join(UPLOADS_ROOT_DIR, 'products');
export const SHOP_UPLOADS_DIR = path.join(UPLOADS_ROOT_DIR, 'shops');
export const ALLOWED_UPLOAD_IMAGE_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

export const getUploadImageExtension = (file: any, fallback = '.jpg') => {
  return ALLOWED_UPLOAD_IMAGE_TYPES.get(file.mimetype) || fallback;
};

if (!fs.existsSync(PRODUCT_UPLOADS_DIR)) {
  fs.mkdirSync(PRODUCT_UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(SHOP_UPLOADS_DIR)) {
  fs.mkdirSync(SHOP_UPLOADS_DIR, { recursive: true });
}

export const DEFAULT_DEMO_PASSWORD = 'ChangeMe123!';

const requireConfiguredSecret = (name: string, value?: string, minimumLength = 32) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${name} is required. Refusing to start without a configured secret.`);
  }

  if (IS_PRODUCTION) {
    const weakSecretPattern = /(change[_-]?me|replace[_-]?with|example|password)/i;
    if (normalized.length < minimumLength || weakSecretPattern.test(normalized)) {
      throw new Error(`${name} must be a strong, non-placeholder secret in production.`);
    }
  }

  return normalized;
};

export const resolveDemoPassword = (name: string) => {
  const configuredValue = String(process.env[name] || '').trim();
  if (!configuredValue) {
    if (IS_PRODUCTION) {
      throw new Error(`${name} is required in production. Demo logins must use explicit passwords.`);
    }
    return DEFAULT_DEMO_PASSWORD;
  }

  if (IS_PRODUCTION) {
    const weakPasswordPattern = /(change[_-]?me|password|example)/i;
    if (configuredValue === DEFAULT_DEMO_PASSWORD || configuredValue.length < 12 || weakPasswordPattern.test(configuredValue)) {
      throw new Error(`${name} must be set to a unique, non-default password in production.`);
    }
  }

  return configuredValue;
};

export const JWT_SECRET = requireConfiguredSecret('JWT_SECRET', process.env.JWT_SECRET);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Refusing to start without PostgreSQL.');
}

export const DATABASE_URL = process.env.DATABASE_URL;

export const DB_STATE_KEY = 'default';
export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;

export const INVOICE_COPY_TYPES = [
  'Original Copy',
  'Duplicate Copy',
  'Office Copy',
  'Accounts Copy',
  'Delivery Copy',
  'Store Copy',
  'Reprinted Invoice',
] as const;
