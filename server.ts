import { initGeneralLedger } from './backend/generalLedger';
import {recordImportChargeRecovery,importRecoveryAvailability} from './backend/importChargeRecoveries';
import {recordSupplierRefund,supplierRefundAvailability} from './backend/supplierRefunds';
import {recordPurchaseReturn} from './backend/purchaseReturns';
import {settleImportCreditor} from './backend/importSettlements';
import {listImportObligations,submitImportObligation,reviewImportObligation} from './backend/importObligations';
import {supplierReconciliation} from './backend/supplierReconciliation';
import {ledgerStatements,ledgerActivity} from './backend/ledgerReports';
import { renderArsDisbursementVoucherPdf } from './src/utils/arsDisbursementVoucherPdf';
import { renderArsHandoverVoucherPdf } from './src/utils/arsHandoverVoucherPdf';
import { inReportPeriod, reportDay, reportTime, saleProfit } from './src/utils/reporting';
import { renderBusinessReportPdf } from './src/utils/businessReportPdf';
import { renderArsInvoicePdf } from './src/utils/arsInvoicePdf';
import { renderArsPaymentReceiptPdf } from './src/utils/arsPaymentReceiptPdf';
import { purchaseVariant } from './backend/purchaseVariant';
import { parsePackagingDraft, initPackagingDrafts, activatePackaging, checkPackagingActivation, getPackagingDraft, savePackagingDraft, updatePackagingPrices, convertLegacyPackaging, listLegacyInvoiceLines, sharedStockActivationEnabled } from './backend/packagingDrafts';
import { initSharedStockSchema } from './backend/sharedStock';
import { baseQuantity } from './src/utils/unitConversion';
import { initPartialReceivingTables, receivePartialOrder } from './backend/partialReceiving';
import { initLandedCostTables, previewLandedCost, approveLandedCost } from './backend/landedCost';
import { inventoryValuation, inventoryCostHistory } from './backend/inventoryValuation';
import { initReceivableAging, receivableAging, registerInvoiceDueDate } from './backend/receivableAging';
import { initPayableAging, supplierPayableAging, registerSupplierDueDate } from './backend/payableAging';
import { financialPosition } from './backend/financialPosition';
import { openingReconciliation } from './backend/openingReconciliation';
import { cutoverReadiness } from './backend/cutoverReadiness';
import { listDocumentaryReviews, submitDocumentaryReview } from './backend/documentaryReconciliation';
import { createLedgerMapping, listLedgerMappings } from './backend/ledgerMappings';
import { postPartnerCapital } from './backend/partnerCapitalPosting';
import { reviewHistoricalCapital, listHistoricalCapitalReviews } from './backend/partnerCapitalReview';
import { partnerCapitalStatement, exportPartnerCapitalStatement } from './backend/partnerCapitalStatement';
import { preparePayroll, reviewPayroll, listPayrollProposals } from './backend/payrollPreparation';
import { calculatePayroll, calculateStatutoryPayroll } from './backend/payrollCalculation';
import { proposePayrollPolicy, reviewPayrollPolicy, listPayrollPolicies, effectivePayrollPolicy } from './backend/payrollPolicies';
import { proposePayrollEligibility, reviewPayrollEligibility, listPayrollEligibility, effectivePayrollEligibility } from './backend/payrollEligibility';
import { prepareEmployeeAdvance, reviewEmployeeAdvance, listEmployeeAdvanceRequests, listEmployeeAdvanceBalances } from './backend/employeeAdvances';
import { listSalaryBalances, listSalaryPayments } from './backend/salaryPayments';
import { readPostedPayslip, renderPostedPayslip } from './backend/payslip';
import { listMonthlyStatutoryLiabilities, listStatutorySettlementHistory } from './backend/statutoryRegister';
import { listStatutoryBankAvailability } from './backend/statutoryBankAvailability';
import { reconcileStatutoryContributions } from './backend/statutoryReconciliation';
import { submitOpeningProposal, listOpeningProposals, reviewOpeningProposal } from './backend/openingBalances';
import { listLedgerAccounts, createLedgerAccount, updateLedgerAccount, seedWholesaleAccounts, ledgerAccountAudit } from './backend/chartOfAccounts';
import { initPositionRegisters, listPositionRegisters, recordPositionBalance, positionKinds, type PositionKind } from './backend/positionRegisters';
import { listImportExpenseReview, linkImportExpense } from './backend/importExpenseReconciliation';
import { initFinancialAccounts, listFinancialAccounts, createFinancialAccount, registerFinancialOpeningBalance, recordFinancialTransfer, registerCustomerCheque, listCustomerCheques, transitionCustomerCheque, registerSupplierCheque, listSupplierCheques, transitionSupplierCheque, recordFinancialReconciliation, listFinancialReconciliations, listFinancialMovements, recordPaidExpense, assignRepresentativeAccount, listRepresentativeAccounts, linkRepresentativeLogin, resolveRepresentativeFinancialIdentity, requestCashHandover, decideCashHandover, financialCashFlow, financialProfitReport, correctHistoricalInvoiceCost, type FinancialAccountKind } from './backend/financialAccounts';
import { initArsProfitLedger, recordArsProfitAllocation, recordArsOwnershipAgreement } from './backend/partnerProfit';
import { checkoutTransaction, refundTransaction, createPurchaseOrder, allocateTradeDocumentNumber, receivePurchaseOrder, updatePurchaseOrderStatus, updateCustomerCreditLimit, updateCustomerContact, addCustomerCreditPayment, insertSupplierPayment, insertSupplier, insertCustomer, createProductWithIntake, updateProductWithAudit, archiveProduct } from './backend/db';
import { invoiceTotals, roundMoney } from './src/utils/invoiceTotals';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { execFile } from 'node:child_process';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
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

// Allow OS-assigned ports only for loopback integration servers using isolated CI databases.
const isolatedEphemeralPort = (() => {
  if (PORT !== 0 || process.env.ARS_LISTEN_HOST !== '127.0.0.1') return false;
  try {
    const url = new URL(process.env.DATABASE_URL || '');
    return ['127.0.0.1','localhost'].includes(url.hostname) &&
      /^\/hardware_pos_(?:ci|bootstrap_ci_[a-f0-9]{12})$/.test(url.pathname);
  } catch { return false; }
})();
if (!Number.isInteger(PORT) || (PORT <= 0 && !isolatedEphemeralPort) || PORT > 65535) {
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
  contact?: { address?: string; phone?: string; email?: string; taxRate?: number },
): Promise<Buffer> => renderArsInvoicePdf(
  {...tx, items: tx.items.map(item => {
    if(item.variantSku) return item;
    const product = db.products.find(p => p.id === item.productId && p.shopId === tx.shopId);
    const sku = item.variantId ? product?.variants?.find(v=>v.id===item.variantId)?.sku : product?.sku;
    return {...item, variantSku:sku || undefined};
  })}, activeShopName, meta,
  resolvePrintableLogoBuffer(logoUrl),
  invoiceCompanyMeta, contact, 'ARS-240x270',
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
      if (!inReportPeriod(row.printedAt, fromDate ? reportDay(fromDate) : '', toDate ? reportDay(toDate) : '')) return false;
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
      storeName: 'ARS Distributors',
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
          name: 'ARS Distributors',
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
      storeName: 'ARS Distributors',
      logoUrl: '',
      address: '',
      phone: '',
      taxRate: 0,
      invoicePrefix: 'ARS-INV',
      shopProfiles: [{
        id: 'shop-main',
        name: 'ARS Distributors',
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
      name: state.settings?.storeName || 'ARS Distributors',
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
        companyTagline: String(shop?.invoiceCompanyMeta?.companyTagline || 'Imports & Wholesale Distribution'),
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

    CREATE TABLE IF NOT EXISTS password_recovery (
      user_id TEXT PRIMARY KEY,
      digest TEXT NOT NULL,
      auth_revision TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS password_recovery_audit (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      event TEXT NOT NULL,
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
      invoice_description TEXT,
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
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS selling_unit_id TEXT;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS selling_unit_label TEXT;
      ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS base_units_per_purchase_unit INTEGER;
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
    ALTER TABLE manual_expenses ADD COLUMN IF NOT EXISTS shop_id TEXT;
    CREATE INDEX IF NOT EXISTS manual_expenses_shop_date ON manual_expenses(shop_id,date);
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
    ALTER TABLE sales_transaction_items ADD COLUMN IF NOT EXISTS invoice_description TEXT;
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

    ALTER TABLE customer_credit_payments ADD COLUMN IF NOT EXISTS invoice_id TEXT;
    ALTER TABLE customer_credit_payments ADD COLUMN IF NOT EXISTS receipt_snapshot JSONB;

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
  const protectedFunds=await client.query('SELECT EXISTS(SELECT 1 FROM ars_financial_accounts) AS has_accounts');
  if(protectedFunds.rows[0]?.has_accounts)throw Error('Legacy full-state rewrite blocked: financial accounts exist. Use targeted SQL updates.');
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
      INSERT INTO manual_expenses (id, description, amount, date, category, shop_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [expense.id, expense.desc, expense.amount, expense.date, expense.category, expense.shopId || null]
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
      `INSERT INTO customer_credit_payments (id, shop_id, customer_id, customer_name, amount, date, payment_method, note, created_by, invoice_id, receipt_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [cp.id, cp.shopId || null, cp.customerId, cp.customerName, cp.amount, cp.date, cp.paymentMethod, cp.note || null, cp.createdBy || null, cp.invoiceId || null, cp.receiptSnapshot ? JSON.stringify(cp.receiptSnapshot) : null]
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
    pool.query('SELECT t.*, d.due_date::text AS credit_due_date FROM sales_transactions t LEFT JOIN ars_invoice_due_dates d ON d.shop_id=t.shop_id AND d.invoice_id=t.id ORDER BY t.date DESC'),
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
    store_name: 'ARS Distributors',
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
        name: 'ARS Distributors',
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
      sharedStockUnits: row.shared_stock_units ?? undefined,
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
      creditDueDate: row.credit_due_date || undefined,
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
        sellingUnitId: item.selling_unit_id ?? undefined,
        sellingUnitLabel: item.selling_unit_label ?? undefined,
        baseUnitsPerSaleUnit: item.base_units_per_sale_unit ?? undefined,
        variantSku: item.variant_sku || undefined,
        variantBarcode: item.variant_barcode || undefined,
        quantity: Number(item.quantity),
        sellingPrice: Number(item.selling_price),
        costPrice: item.cost_price == null ? undefined : Number(item.cost_price),
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
        sellingUnitId: item.selling_unit_id ?? undefined,
        sellingUnitLabel: item.selling_unit_label ?? undefined,
        baseUnitsPerPurchaseUnit: item.base_units_per_purchase_unit ?? undefined,
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
      shopId: row.shop_id || undefined,
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
      date: row.date,
      note: row.note || undefined,
      createdBy: row.created_by || undefined,
    })),
    quotations: quotationsRes.rows.map((row) => ({
      id: row.id,
      shopId: row.shop_id || undefined,
      quoteNumber: row.quote_number,
      date: row.date,
      validUntil: row.valid_until || undefined,
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
      invoiceId: row.invoice_id || undefined,
      receiptSnapshot: row.receipt_snapshot || undefined,
      shopId: row.shop_id || undefined,
      customerId: row.customer_id,
      customerName: row.customer_name,
      amount: Number(row.amount),
      date: row.date,
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
  // Reverse proxies can forward external traffic with a loopback peer address.
  // Hosted containers disable HTTP bootstrap entirely; use trusted console setup.
  if (process.env.ARS_DISABLE_HTTP_FIRST_ADMIN_SETUP === 'true') {
    return res.status(403).json({ error: 'HTTP administrator setup is disabled on this hosted server.' });
  }
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


const recoveryConfig = () => {
  const host = process.env.EMAIL_SMTP_HOST?.trim();
  const user = process.env.EMAIL_SMTP_USER?.trim();
  const pass = process.env.EMAIL_SMTP_PASS;
  const from = process.env.EMAIL_FROM?.trim() || user;
  const secret = process.env.PASSWORD_RECOVERY_SECRET || '';
  const port = Number(process.env.EMAIL_SMTP_PORT || 587);
  const secure = port === 465 || process.env.EMAIL_SMTP_SECURE === 'true';
  return process.env.PASSWORD_RECOVERY_ENABLED === 'true' && host && user && pass && from && secret.length >= 32 && Number.isInteger(port) && port > 0 && port <= 65535
    ? { host, user, pass, from, secret, port, secure } : null;
};
const recoveryDigest = (secret: string, id: string, code: string) =>
  createHmac('sha256', secret).update(JSON.stringify([id, code])).digest('hex');
const recoveryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false });
app.get('/api/auth/recovery-status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ emailEnabled: !!recoveryConfig() });
});
app.post('/api/auth/recovery/request', recoveryLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const config = recoveryConfig();
  if (!config) return res.status(503).json({ error: 'Email recovery is unavailable.' });
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254) return res.status(400).json({error:'Enter a valid email address.'});
  const message = { message: 'If this account is eligible, a verification code will be sent.' };
  const account = db.users.find(u => u.email.toLowerCase() === email);
  // Return the same response for missing accounts and cooldowns.
  if (!account) return res.json(message);
  try {
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const result = await pool.query(`
      INSERT INTO password_recovery (user_id,digest,auth_revision,expires_at)
      VALUES ($1,$2,$3,NOW()+INTERVAL '5 minutes')
      ON CONFLICT (user_id) DO UPDATE SET digest=EXCLUDED.digest,auth_revision=EXCLUDED.auth_revision,
        expires_at=EXCLUDED.expires_at, attempts=0, requested_at=NOW()
      WHERE password_recovery.requested_at < NOW()-INTERVAL '5 minutes'
      RETURNING user_id`, [account.id,recoveryDigest(config.secret,account.id,code),getAuthRevision(account)]);
    if (result.rowCount) {
      await pool.query("INSERT INTO password_recovery_audit (user_id,event) VALUES ($1,'requested')",[account.id]);
      // Never log the code or SMTP credentials. Require TLS even for STARTTLS.
      const transport = nodemailer.createTransport({host:config.host,port:config.port,secure:config.secure,
        requireTLS:!config.secure,auth:{user:config.user,pass:config.pass},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
      // Delivery is intentionally outside the request response; failures fail closed.
      void transport.sendMail({from:config.from,to:account.email,subject:'ARS Distributors password recovery',
        text:'Your verification code is '+code+'. It expires in 5 minutes. Ignore this email if you did not request it.'})
        .catch(() => { console.warn('Password recovery email delivery failed.'); });
    }
  } catch { console.warn('Password recovery request could not be processed.'); }
  return res.json(message);
});
app.post('/api/auth/recovery/complete', recoveryLimiter, async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  const config = recoveryConfig();
  if (!config) return res.status(503).json({error:'Email recovery is unavailable.'});
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || email.length>254 || !/^\d{6}$/.test(code) || password.length<12 || Buffer.byteLength(password,'utf8')>72 || password===DEFAULT_DEMO_PASSWORD || password!==req.body?.confirmPassword)
    return res.status(400).json({error:'Enter a six-digit code and matching new passwords (at least 12 characters, at most 72 UTF-8 bytes).'});
  const invalid = {error:'Invalid or expired verification code.'};
  const account = db.users.find(u=>u.email.toLowerCase()===email);
  if (!account) return res.status(400).json(invalid);
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query("SELECT digest,auth_revision FROM password_recovery WHERE user_id=$1 AND expires_at>NOW() AND attempts<5 FOR UPDATE",[account.id]);
    const row = result.rows[0];
    if (!row || row.auth_revision!==getAuthRevision(account)) {
      await client.query('ROLLBACK'); return res.status(400).json(invalid);
    }
    const expected = Buffer.from(row.digest,'hex'), actual = Buffer.from(recoveryDigest(config.secret,account.id,code),'hex');
    if (expected.length!==actual.length || !timingSafeEqual(expected,actual)) {
      await client.query('UPDATE password_recovery SET attempts=attempts+1 WHERE user_id=$1',[account.id]);
      await client.query("INSERT INTO password_recovery_audit (user_id,event) VALUES ($1,'invalid_code')",[account.id]);
      await client.query('COMMIT'); return res.status(400).json(invalid);
    }
    const hash = await bcrypt.hash(password,12);
    const updated = await client.query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2 AND email=$3 AND password_hash=$4 AND role=$5 RETURNING id',[hash,account.id,account.email,account.passwordHash,account.role]);
    if (!updated.rowCount) { await client.query('ROLLBACK'); return res.status(400).json(invalid); }
    await client.query('UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL',[account.id]);
    await client.query('UPDATE password_recovery SET expires_at=NOW(), attempts=5 WHERE user_id=$1',[account.id]);
    await client.query("INSERT INTO password_recovery_audit (user_id,event) VALUES ($1,'completed')",[account.id]);
    await client.query('COMMIT');
    db.users = db.users.map(u=>u.id===account.id?{...u,passwordHash:hash,updatedAt:new Date().toISOString()}:u);
    return res.json({message:'Password updated. Sign in with your new password.'});
  } catch {
    if (client) await client.query('ROLLBACK').catch(()=>{});
    return res.status(503).json({error:'Recovery could not be completed. Please try again.'});
  } finally { client?.release(); }
});

app.use('/api', requireAuth);

// Safe, read-only support snapshot. Requires an active authorized session and
// deliberately excludes credentials, host names, customer records and tokens.
app.get('/api/support/diagnostics', requireRole(['Super Admin', 'Store Manager']), async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let database = 'unreachable';
  try {
    await pool.query('SELECT 1');
    database = 'reachable';
  } catch {
    // Do not disclose database connection details or internal errors to clients.
  }
  const ready = database === 'reachable' && databaseWriteHealthy && singleWriterLease !== null;
  res.status(ready ? 200 : 503).json({
    service: 'ARS Distributors POS',
    checkedAt: new Date().toISOString(),
    release: String(process.env.ARS_RELEASE_ID || 'not-configured').slice(0, 64),
    environment: NODE_ENV,
    uptimeSeconds: Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000),
    database,
    writes: databaseWriteHealthy && singleWriterLease !== null ? 'enabled' : 'disabled',
    status: ready ? 'ready' : 'degraded',
    // No request headers, account names, shop IDs, database URL or SQL logs.
  });
});


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
// Explicit host opt-in: these fixed commands are never supplied by the browser.
let manualBackupRunning = false;
const manualBackupAvailable = () => {
  if (process.env.ENABLE_LOCAL_BACKUP_UI !== 'true') return false;
  try {
    const url = new URL(process.env.DATABASE_URL || '');
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      ['win32', 'linux'].includes(process.platform) &&
      dotenv.parse(fs.readFileSync(path.resolve('.env.local'))).DATABASE_URL === process.env.DATABASE_URL;
  } catch { return false; }
};
app.get('/api/backup/local-status', requireRole(['Super Admin']), (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ enabled: manualBackupAvailable(), running: manualBackupRunning, platform: process.platform });
});
app.post('/api/backup/local-run', requireRole(['Super Admin']), async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!manualBackupAvailable()) return res.status(403).json({ error: 'Local backup button is not enabled on this database host.' });
  if (manualBackupRunning) return res.status(409).json({ error: 'A manual backup is already running.' });
  manualBackupRunning = true;
  const windows = process.platform === 'win32';
  const executable = windows ? 'powershell.exe' : 'python3';
  const args = windows
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/backup-local-postgres.ps1'), '-OutputArchive']
    : [path.resolve('scripts/mint/backup.py')];
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(executable, args, { cwd: process.cwd(), windowsHide: true, maxBuffer: 1024 * 1024 }, (error, output) => error ? reject(error) : resolve(output));
    });
    const archive = stdout.split(/\r?\n/).find(line => line.startsWith('ARS_ARCHIVE='))?.slice('ARS_ARCHIVE='.length).trim();
    if (!archive || path.dirname(path.resolve(archive)) !== path.resolve('backups') || !/^ars-[a-z0-9_-]+\.dump$/i.test(path.basename(archive))) throw new Error('Missing verified archive');
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, [path.resolve('scripts/verify-backup.mjs'), path.resolve(archive)], { cwd: process.cwd(), windowsHide: true }, error => error ? reject(error) : resolve());
    });
    res.json({ success: true, archive: path.basename(archive), verifiedAt: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: 'Backup or verification failed. Check Docker and the database host configuration.' });
  } finally {
    manualBackupRunning = false;
  }
});

// Only managed archives and their exact companions can be accessed.
const managedBackupName = /^ars-[a-z0-9_-]+-(?:with-uploads|database-only)\.dump$/i;
const backupRoot = path.resolve('backups');
async function managedBackupFile(name: string) {
  if (!managedBackupName.test(name)) throw new Error('Invalid archive');
  const file = path.join(backupRoot, name);
  const info = await fs.promises.lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid archive');
  return { file, info };
}
async function backupCompanions(name: string) {
  await managedBackupFile(name);
  const names = [name, name + '.sha256'];
  if (name.endsWith('-with-uploads.dump')) names.push(name.slice(0,-5) + '-uploads.zip', name.slice(0,-5) + '-uploads.zip.sha256');
  for (const member of names) {
    const info = await fs.promises.lstat(path.join(backupRoot, member));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid backup companion');
  }
  return names;
}
async function verifyManagedBackup(name: string) {
  await backupCompanions(name);
  await new Promise<void>((resolve, reject) => {
    execFile(process.execPath, [path.resolve('scripts/verify-backup.mjs'), path.join(backupRoot, name)], { cwd: process.cwd(), windowsHide: true }, error => error ? reject(error) : resolve());
  });
}
app.get('/api/backup/local-history', requireRole(['Super Admin']), async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!manualBackupAvailable()) return res.status(403).json({ error: 'Local backup tools are disabled.' });
  try {
    const entries = await fs.promises.readdir(backupRoot).catch(error => {
      if (error.code === 'ENOENT') return [] as string[];
      throw error;
    });
    const backups = [];
    for (const name of entries.filter(name => managedBackupName.test(name))) {
      try {
        const {info} = await managedBackupFile(name);
        let complete = false;
        try { await backupCompanions(name); complete = true; } catch { /* incomplete sets remain visible */ }
        backups.push({name, bytes: info.size, createdAt: info.mtime.toISOString(), complete, includesUploads: name.endsWith('-with-uploads.dump')});
      } catch { /* skip non-regular files */ }
    }
    backups.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ backups: backups.slice(0,100) });
  } catch { res.status(500).json({ error: 'Could not read backup history.' }); }
});
app.post('/api/backup/local-verify', requireRole(['Super Admin']), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!manualBackupAvailable()) return res.status(403).json({ error: 'Local backup tools are disabled.' });
  if (manualBackupRunning) return res.status(409).json({ error: 'Wait until the current backup operation finishes.' });
  manualBackupRunning = true;
  try {
    await verifyManagedBackup(String(req.body?.archive || ''));
    res.json({ success: true, verifiedAt: new Date().toISOString() });
  } catch { res.status(400).json({ error: 'Backup set is missing, incomplete or failed checksum verification.' }); }
  finally { manualBackupRunning = false; }
});
app.get('/api/backup/local-download', requireRole(['Super Admin']), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!manualBackupAvailable()) return res.status(403).json({ error: 'Local backup tools are disabled.' });
  if (manualBackupRunning) return res.status(409).json({ error: 'Wait until the current backup operation finishes.' });
  const name = String(req.query.archive || '');
  const member = String(req.query.member || '');
  manualBackupRunning = true;
  try {
    const members = await backupCompanions(name);
    if (!members.includes(member)) return res.status(400).json({ error: 'Invalid backup member.' });
    await verifyManagedBackup(name);
    await new Promise<void>((resolve, reject) => {
      res.download(path.join(backupRoot, member), member, { headers: { 'Cache-Control': 'no-store' } }, error => error ? reject(error) : resolve());
    });
  } catch {
    if (!res.headersSent) res.status(400).json({ error: 'Backup download unavailable or verification failed.' });
    else res.end();
  } finally { manualBackupRunning = false; }
});

// Fixed host commands only; never accept a command, remote name or executable from a request.
const runBackupTool = (file: string, args: string[]) => new Promise<string>((resolve, reject) => {
  execFile(file, args, { cwd: process.cwd(), windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
});
app.get('/api/backup/cloud-readiness', requireRole(['Super Admin']), async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!manualBackupAvailable()) return res.json({ ready: false, installed: false, configured: false });
  try {
    const types = await runBackupTool('rclone', ['listremotes', '--long']);
    const configured = /^ars-drive:\s+drive\s*$/m.test(types) && /^ars-encrypted:\s+crypt\s*$/m.test(types);
    res.json({ installed: true, configured, ready: configured });
  } catch { res.json({ installed: false, configured: false, ready: false }); }
});
app.post('/api/backup/cloud-run', requireRole(['Super Admin']), async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!manualBackupAvailable()) return res.status(403).json({ error: 'Backup tools are disabled.' });
  if (manualBackupRunning) return res.status(409).json({ error: 'Another backup operation is running.' });
  manualBackupRunning = true;
  try {
    await runBackupTool(process.execPath, [path.resolve('scripts/drive-backup.mjs')]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Encrypted cloud backup failed. Check the Google Drive setup and backup status.' }); }
  finally { manualBackupRunning = false; }
});
app.post('/api/backup/cloud-schedule', requireRole(['Super Admin']), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!manualBackupAvailable()) return res.status(403).json({ error: 'Backup tools are disabled.' });
  if (req.body?.confirmation !== 'ENABLE DAILY BACKUP') return res.status(400).json({ error: 'Confirmation required.' });
  if (manualBackupRunning) return res.status(409).json({ error: 'Another backup operation is running.' });
  manualBackupRunning = true;
  try {
    const types = await runBackupTool('rclone', ['listremotes', '--long']);
    if (!/^ars-drive:\s+drive\s*$/m.test(types) || !/^ars-encrypted:\s+crypt\s*$/m.test(types)) throw new Error('Configure remotes');
    if (process.platform === 'win32') await runBackupTool('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/install-drive-backup.ps1'),'-At','20:00']);
    else await runBackupTool('bash', [path.resolve('scripts/mint/install-drive-backup.sh')]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Schedule installation failed. Check the host user and Drive configuration.' }); }
  finally { manualBackupRunning = false; }
});
app.get('/api/backup/local-package', requireRole(['Super Admin']), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!manualBackupAvailable()) return res.status(403).json({ error: 'Backup tools are disabled.' });
  if (manualBackupRunning) return res.status(409).json({ error: 'Another backup operation is running.' });
  manualBackupRunning = true;
  let temporary: string | undefined;
  try {
    const name = String(req.query.archive || '');
    const members = await backupCompanions(name);
    await verifyManagedBackup(name);
    temporary = await fs.promises.mkdtemp(path.join(backupRoot, '.package-'));
    const output = path.join(temporary, name.slice(0,-5) + '.tar');
    // bsdtar on supported Windows versions; tar on Linux. No shell expansion.
    await runBackupTool('tar', ['-cf', output, '-C', backupRoot, ...members]);
    await new Promise<void>((resolve, reject) => res.download(output, path.basename(output), error => error ? reject(error) : resolve()));
  } catch { if (!res.headersSent) res.status(500).json({ error: 'Package creation or download failed.' }); else res.end(); }
  finally {
    if (temporary) await fs.promises.rm(temporary, {recursive:true, force:true}).catch(() => {});
    manualBackupRunning = false;
  }
});

app.post('/api/backup/recovery-test', requireRole(['Super Admin']), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!manualBackupAvailable()) return res.status(403).json({ error: 'Local recovery tools are disabled.' });
  if (req.body?.confirmation !== 'RESTORE TEST') return res.status(400).json({ error: 'Type RESTORE TEST to confirm isolated recovery.' });
  if (manualBackupRunning) return res.status(409).json({ error: 'Another backup operation is running.' });
  manualBackupRunning = true;
  try {
    const name = String(req.body?.archive || '');
    await verifyManagedBackup(name);
    const archive = path.join(backupRoot, name);
    const stdout = process.platform === 'win32'
      ? await runBackupTool('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/restore-local-postgres-test.ps1'),'-BackupFile',archive,'-Confirmation','RESTORE TEST'])
      : await runBackupTool('python3', [path.resolve('scripts/mint/backup.py'),'--restore',archive,'--confirmation','RESTORE TEST']);
    const target = stdout.match(/ars_restore_test_[a-zA-Z0-9_]+/)?.[0];
    if (!target) throw new Error('Recovery database not reported');
    // Return counts from the isolated database, never the original application's credentials or configuration.
    const url = new URL(process.env.DATABASE_URL!);
    if (decodeURIComponent(url.pathname.slice(1)) === target) throw new Error('Unexpected recovery target');
    url.pathname = '/' + target;
    const testPool = new Pool({connectionString:url.toString(), max:1, connectionTimeoutMillis:5000});
    try {
      const counts = await testPool.query('SELECT (SELECT count(*)::text FROM public.products) AS products, (SELECT count(*)::text FROM public.customers) AS customers, (SELECT count(*)::text FROM public.sales_transactions) AS sales');
      // Older archives remain recoverable, but must not be represented as packaging-verified.
      const schema=await testPool.query(`
        SELECT to_regclass('public.ars_packaging_drafts') IS NOT NULL AS drafts,
          EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='shared_stock_units') AS products,
          (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_transaction_items' AND column_name IN ('selling_unit_id','selling_unit_label','base_units_per_sale_unit')) AS sales,
          (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchase_order_items' AND column_name IN ('selling_unit_id','selling_unit_label','base_units_per_purchase_unit')) AS purchases`);
      const shape=schema.rows[0];
      const complete=shape.drafts && shape.products && shape.sales && shape.purchases;
      let packaging;
      if(complete){
        const checks=await testPool.query(`
          SELECT
            (SELECT count(*)::text FROM products WHERE shared_stock_units IS NOT NULL) AS "activeProducts",
            (SELECT count(*)::text FROM ars_packaging_drafts) AS drafts,
            (SELECT count(*)::text FROM sales_transaction_items WHERE selling_unit_id IS NOT NULL) AS "saleLines",
            (SELECT count(*)::text FROM purchase_order_items WHERE selling_unit_id IS NOT NULL) AS "purchaseLines",
            (SELECT count(*)::text FROM sales_transaction_items WHERE
              (selling_unit_id IS NOT NULL OR selling_unit_label IS NOT NULL OR base_units_per_sale_unit IS NOT NULL)
              AND (selling_unit_id IS NULL OR selling_unit_label IS NULL OR base_units_per_sale_unit IS NULL OR base_units_per_sale_unit<=0)) AS "invalidSaleSnapshots",
            (SELECT count(*)::text FROM purchase_order_items WHERE
              (selling_unit_id IS NOT NULL OR selling_unit_label IS NOT NULL OR base_units_per_purchase_unit IS NOT NULL)
              AND (selling_unit_id IS NULL OR selling_unit_label IS NULL OR base_units_per_purchase_unit IS NULL OR base_units_per_purchase_unit<=0)) AS "invalidPurchaseSnapshots"`);
        const configurations=await testPool.query('SELECT shared_stock_units AS configuration FROM products WHERE shared_stock_units IS NOT NULL UNION ALL SELECT configuration FROM ars_packaging_drafts');
        let invalidConfigurations=0;
        for(const row of configurations.rows){try{parsePackagingDraft(row.configuration);}catch{invalidConfigurations++;}}
        const metrics=checks.rows[0];
        packaging={status:invalidConfigurations===0 && Number(metrics.invalidSaleSnapshots)===0 && Number(metrics.invalidPurchaseSnapshots)===0?'structural-check-passed':'invalid',...metrics,invalidConfigurations};
      }else{
        packaging={status:'schema-incomplete',schema:shape};
      }
      res.json({success:true, target, counts:counts.rows[0], packaging, verifiedAt:new Date().toISOString()});
    } finally { await testPool.end(); }
  } catch { res.status(500).json({error:'Recovery test did not complete. An isolated test database may remain; the operational database connection was not switched.'}); }
  finally { manualBackupRunning = false; }
});

app.get('/api/backup/drive-status', requireRole(['Super Admin']), async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const raw = await fs.promises.readFile(path.resolve('backups', 'drive-status.json'), 'utf8');
    const { phase, attemptedAt, verifiedAt } = JSON.parse(raw);
    if (!['local', 'upload', 'verified', 'local-failed', 'upload-failed'].includes(phase) ||
        !Number.isFinite(Date.parse(attemptedAt)) || (verifiedAt !== null && !Number.isFinite(Date.parse(verifiedAt)))) {
      throw new Error('Invalid status');
    }
    res.json({ phase, attemptedAt, verifiedAt });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return res.json({ phase: 'never', attemptedAt: null, verifiedAt: null });
    }
    res.status(503).json({ error: 'Backup status unavailable.' });
  }
});

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
// Render only data submitted by the authenticated operator. This endpoint never
// queries or expands business records, nor accepts filesystem paths from the request.
app.post('/api/reports/render-pdf', requireRole(['Super Admin','Store Manager','Cashier','Inventory Staff']), async (req,res) => {
  res.set('Cache-Control','no-store');
  const data=req.body;
  const validText=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
  const validCell=(v:unknown)=>validText(v,4000)||(typeof v==='number'&&Number.isFinite(v));
  if(!data || !validText(data.title,200) || !validText(data.period,300) ||
    !Array.isArray(data.headers) || data.headers.length<1 || data.headers.length>16 ||
    !data.headers.every((h:unknown)=>validText(h,120)) ||
    !Array.isArray(data.rows) || data.rows.length>2500 ||
    !data.rows.every((row:unknown)=>Array.isArray(row)&&row.length===data.headers.length&&row.every(validCell)) ||
    (data.summary!==undefined&&(!Array.isArray(data.summary)||data.summary.length>12||!data.summary.every((m:any)=>m&&validText(m.label,150)&&validCell(m.value)))) ||
    (data.moneyColumns!==undefined&&(!Array.isArray(data.moneyColumns)||data.moneyColumns.length>16||!data.moneyColumns.every((i:unknown)=>typeof i==='number'&&Number.isInteger(i)&&i>=0&&i<data.headers.length)))) {
    return res.status(400).json({error:'Report exceeds supported limits or contains invalid values. Use Excel for larger reports.'});
  }
  const {activeShopId,activeShopName}=getActiveShopContext(db,req);
  const profile=db.settings.shopProfiles?.find(s=>s.id===activeShopId);
  const logo=profile?.logoUrl||(!db.settings.shopProfiles?.length?db.settings.logoUrl:'')||'';
  let logoBuffer:Buffer|null=null;
  try {
    if(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo)&&logo.length<2000000) logoBuffer=resolvePrintableLogoBuffer(logo);
    else if(/^\/uploads\/shops\/[a-zA-Z0-9_.-]+$/.test(logo)){
      const file=path.resolve(process.cwd(),'.'+logo);
      const info=await fs.promises.lstat(file);
      if(info.isFile()&&!info.isSymbolicLink()&&info.size<2000000&&path.dirname(await fs.promises.realpath(file))===path.resolve(process.cwd(),'uploads','shops')) logoBuffer=await fs.promises.readFile(file);
    }
  } catch { /* fall back to company text */ }
  try {
    const pdf=await renderBusinessReportPdf({title:data.title,filename:'ars-report',period:data.period,headers:data.headers,rows:data.rows,summary:data.summary,moneyColumns:data.moneyColumns},
      {name:profile?.name||activeShopName,address:profile?.address||'',phone:profile?.phone||''},logoBuffer);
    res.type('application/pdf').attachment('ars-report.pdf').send(pdf);
  } catch {
    res.status(422).json({error:'PDF could not fit the report. Use Advanced Excel or reduce the report range.'});
  }
});

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
    manualExpenses: byActiveShop(db.manualExpenses),
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

app.get('/api/manual-expenses',requireRole(['Super Admin','Store Manager']),(req,res)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Expense shop access denied.'});
  res.json(db.manualExpenses.filter(e=>e.shopId===scope.shopId));
});
app.get('/api/manual-expenses/unassigned',requireRole(['Super Admin']),async(req,res)=>{
  const auth=(req as AppRequest).authUser;
  if(!auth||auth.scopedShopId||auth.fixedShopId||(auth.allowedShopIds||[]).length)return res.status(403).json({error:'Global administrator access required.'});
  res.setHeader('Cache-Control','no-store');
  res.json(db.manualExpenses.filter(e=>!e.shopId));
});

app.get('/api/manual-expenses/:id/pdf',requireRole(['Super Admin','Store Manager']),async(req:express.Request,res:express.Response)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Payment voucher access denied.'});
  if(!req.params.id||req.params.id.length>200)return res.status(400).json({error:'Invalid payment reference.'});
  try{
    const result=await pool.query(`SELECT e.id,e.amount,e.date::text AS day,e.description AS payee,e.category AS reference,CASE a.kind WHEN 'Office Cash' THEN 'Cash' WHEN 'Bank' THEN 'Bank Transfer' END AS method,a.name AS account,m.recorded_by,NULL::text AS note
      FROM manual_expenses e JOIN ars_financial_movements m ON m.shop_id=e.shop_id AND m.source_id=e.id AND m.movement_kind='Expense' AND m.amount=-e.amount
      JOIN ars_financial_accounts a ON a.shop_id=m.shop_id AND a.id=m.account_id
      WHERE e.shop_id=$1 AND e.id=$2`,[scope.shopId,req.params.id]);
    if(result.rowCount!==1)return res.status(404).json({error:'Verified ledger-linked payment voucher not found. Historical unlinked records require reconciliation.'});
    const p=result.rows[0];
    if(!p.method||!Number.isFinite(Number(p.amount))||Number(p.amount)<=0)return res.status(409).json({error:'Payment ledger requires reconciliation.'});
    const {activeShopName}=getActiveShopContext(db,req);
    const profile=(db.settings.shopProfiles||[]).find(s=>s.id===scope.shopId);
    const pdf=await renderArsDisbursementVoucherPdf({id:p.id,kind:'Expense',date:p.day,amount:Number(p.amount),payee:p.payee,reference:p.reference,method:p.method,account:p.account,recordedBy:p.recorded_by,note:p.note||undefined},activeShopName,resolvePrintableLogoBuffer(profile?.logoUrl||db.settings.logoUrl||''),profile||db.settings);
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="voucher-'+p.id.replace(/[^a-zA-Z0-9_-]/g,'-')+'.pdf"');return res.send(pdf);
  }catch(error){console.error('Disbursement voucher generation failed',error);return res.status(500).json({error:'Unable to generate payment voucher.'});}
});
app.post('/api/manual-expenses',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database writes are disabled until recovery.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Expense shop access denied.'});
  const desc=String(req.body?.desc||'').trim();
  const category=String(req.body?.category||'Other').trim();
  const amount=Number(req.body?.amount);
  const {sourceAccountId,requestId,paymentMethod}=req.body||{};
  const linked=sourceAccountId!==undefined;
  if(!desc||desc.length>1000||!category||category.length>100||
     !Number.isFinite(amount)||amount<=0||amount>1_000_000_000||
     Math.abs(amount*100-Math.round(amount*100))>0.00001||
     (linked&&(typeof sourceAccountId!=='string'||!sourceAccountId.trim()||sourceAccountId.length>200||!validChequeRequestId(requestId)||!['Cash','Bank Transfer'].includes(paymentMethod)))){
    return res.status(400).json({error:'Enter valid expense details and a matching payment source.'});
  }
  const expense:ManualExpense={id:'exp-'+(linked?requestId:randomUUID()),shopId:scope.shopId,desc,amount,category,date:reportDay(new Date())};
  try{
    const result=await recordPaidExpense(pool,{...expense,shopId:scope.shopId,recordedBy:scope.recordedBy,role:(req as AppRequest).authUser?.role||'Store Manager',sourceAccountId,paymentMethod});
    expense.date=result.date;
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Invalid expense details.','Expense request identifier already used for different details.','Select an active expense account matching the payment method.','Insufficient recorded funds for expense.'].includes(message))return res.status(409).json({error:message});
    console.error('Expense recording failed',error);return res.status(500).json({error:'Unable to confirm expense. Retry the same request identifier.'});
  }
  try{
    const refreshed=await loadStateFromNormalized();
    if(!refreshed)throw Error('Cannot reload committed expense');
    db=refreshed;
  }catch(error){databaseWriteHealthy=false;console.error('Expense committed but refresh failed; writes disabled',error);}
  return res.status(201).json(expense);
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

app.post('/api/admin/sample-records', requireRole(['Super Admin']), async (req, res) => {
  const { activeShopId, activeShopName } = getActiveShopContext(db, req);
  if (req.body?.shopId !== activeShopId) {
    return res.status(409).json({ error: 'Select the test branch again before adding samples.' });
  }
  const actor = (req as AppRequest).authUser!;
  const branchTag = createHash('sha256').update(activeShopId).digest('hex').slice(0, 12);
  const prefix = 'sample-v1-' + branchTag + '-';
  let added = 0;
  let problem = false;
  try {
    const materials = [
      { code: 'TILE', label: 'Floor tiles 2 × 2 ft', unit: 'Box of 4 tiles', cost: 2000, price: 2800, wholesale: 2500, stock: 8 },
      { code: 'BOLT', label: 'M8 hex bolts', unit: 'Box of 100', cost: 950, price: 1500, wholesale: 1250, stock: 40 },
      { code: 'HINGE', label: 'Stainless door hinges', unit: 'Pair', cost: 360, price: 600, wholesale: 490, stock: 60 },
      { code: 'DISC', label: '115 mm cutting discs', unit: 'Pack of 10', cost: 1400, price: 2100, wholesale: 1800, stock: 20 },
    ];
    for (const item of materials) {
      const id = prefix + item.code;
      if (db.products.some(p => p.id === id)) continue;
      const sku = 'TEST-' + item.code + '-' + branchTag;
      const product = normalizeIncomingProduct({
        name: '[TEST] ' + item.label + ' · ' + item.unit, sku, barcode: sku + '-BC',
        brand: 'ARS Test', category: 'Test Hardware', description: item.unit,
        costPrice: item.cost, sellingPrice: item.price, wholesalePrice: item.wholesale,
        quantity: item.stock, reorderLevel: 5, location: 'Test rack A',
      });
      await createProductWithIntake({ ...product, id, shopId: activeShopId }, actor.name, actor.role, activeShopName);
      added++;
    }
    for (const [code, name] of [['north', 'North Road Hardware'], ['central', 'Central Builders Supply']]) {
      const id = prefix + code;
      if (db.customers.some(c => c.id === id)) continue;
      await insertCustomer({ id, shopId: activeShopId, name: '[TEST] ' + name, phone: '', email: '',
        address: 'Sample customer address', creditLimit: 50000, creditBalance: 0, loyaltyBalance: 0, purchaseCount: 0 });
      added++;
    }
    if (!db.suppliers.some(s => s.id === prefix + 'supplier')) {
      await insertSupplier({ id: prefix + 'supplier', shopId: activeShopId, name: '[TEST] Import supplier',
        companyName: '[TEST] Hardware Export Co.', phone: '', email: '', address: 'Sample supplier address', taxNumber: '' });
      added++;
    }
    if (!db.employees.some(e => e.id === prefix + 'rep')) {
      await pool.query(
        `INSERT INTO employees(id,shop_id,name,role,salary,attendance_status,performance_score)
         VALUES($1,$2,$3,'Cashier',0,'Present',85)`,
        [prefix + 'rep', activeShopId, '[TEST] Sales Representative']);
      added++;
    }
  } catch (error) {
    problem = true;
    console.error('Could not finish adding sample records', error);
  }
  // Each ordinary intake commits its own stock and audit records. Refresh even
  // after partial progress so retrying skips completed rows and preserves sales.
  try {
    const fresh = await loadStateFromNormalized();
    if (!fresh) throw new Error('Empty state');
    db = fresh;
  } catch {
    databaseWriteHealthy = false;
    return res.status(503).json({ error: 'Could not reload the database after sample setup.' });
  }
  if (problem) return res.status(409).json({ error: 'Sample setup stopped. Existing records were kept. Check the server log and retry.' });
  return res.json({ added });
});

// Packaging definitions are drafts until shared-stock transaction support is enabled.
app.get('/api/products/:id/packaging-draft', requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  try {
    const configuration = await getPackagingDraft(pool, activeShopId, req.params.id);
    res.json({ configuration, active: false });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});
app.put('/api/products/:id/packaging-draft', requireRole(['Super Admin', 'Store Manager', 'Inventory Staff']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const authUser = (req as AppRequest).authUser;
  try {
    const configuration = await savePackagingDraft(pool, activeShopId, req.params.id, authUser?.name || 'Inventory Staff', req.body?.configuration);
    res.json({ configuration, active: false });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get('/api/products/:id/packaging-eligibility', requireRole(['Super Admin','Store Manager']), async(req,res)=>{
  const {activeShopId}=getActiveShopContext(db,req);
  try {res.json({...await checkPackagingActivation(pool,activeShopId,req.params.id),pilotEnabled:sharedStockActivationEnabled()});}
  catch(error){res.status(409).json({error:(error as Error).message});}
});
app.put('/api/products/:id/packaging-prices',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const auth=(req as AppRequest).authUser;
  try{
    const configuration=await updatePackagingPrices(pool,activeShopId,req.params.id,auth?.name||'Manager',auth?.role||'',req.body?.expected,req.body?.configuration);
    try{const fresh=await loadStateFromNormalized();if(!fresh)throw Error('Reload failed');db=fresh;}
    catch{databaseWriteHealthy=false;return res.status(503).json({error:'Price change committed but reload failed. Reconcile before retrying.'});}
    res.json({configuration,active:true});
  }catch(error){res.status(409).json({error:(error as Error).message});}
});
app.get('/api/products/:id/packaging-history',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  const {activeShopId}=getActiveShopContext(db,req);
  try{
    const product=await pool.query('SELECT id FROM products WHERE id=$1 AND shop_id=$2',[req.params.id,activeShopId]);
    if(!product.rowCount)return res.status(404).json({error:'Product not found in this shop.'});
    res.json({lines:await listLegacyInvoiceLines(pool,activeShopId,req.params.id)});
  }catch(error){res.status(409).json({error:(error as Error).message});}
});
app.post('/api/products/:id/packaging-convert',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const auth=(req as AppRequest).authUser;
  try{
    const conversion=await convertLegacyPackaging(pool,activeShopId,req.params.id,auth?.name||'Manager',auth?.role||'',req.body||{});
    try{const fresh=await loadStateFromNormalized();if(!fresh)throw Error('Reload failed');db=fresh;}
    catch{databaseWriteHealthy=false;return res.status(503).json({error:'Conversion committed but reload failed. Reconcile before retrying.'});}
    res.json({conversion,active:true});
  }catch(error){res.status(409).json({error:(error as Error).message});}
});
app.post('/api/products/:id/packaging-activate',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const auth=(req as AppRequest).authUser;
  try {
    const configuration=await activatePackaging(pool,activeShopId,req.params.id,auth?.name||'Manager',auth?.role||'',req.body?.confirmed);
    try {const fresh=await loadStateFromNormalized();if(!fresh)throw new Error('Reload failed');db=fresh;}
    catch(error){databaseWriteHealthy=false;return res.status(503).json({error:'Activation committed but reload failed. Reconcile before retrying.'});}
    res.json({configuration,active:true});
  }catch(error){res.status(409).json({error:(error as Error).message});}
});

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
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const { destinationAccountId, cartItems, customerId, customerName, customerPhone, customerAddress, cashierName, salesRepId, paymentMethod, paymentStatus, wholesaleMeta, discountAmount, cashReceived } = req.body;
  const requestId=req.body.requestId;
  if(requestId!==undefined&&!validChequeRequestId(requestId))return res.status(400).json({error:'Invalid invoice request identifier.'});
  const txId = requestId ? `tx-${requestId}` : `tx-${randomUUID()}`;
  let financialPayment:{destinationAccountId:string;recordedBy:string;effectiveDate:string}|undefined;
  if(destinationAccountId!==undefined){
    const scope=chequeShopAccess(req);
    const auth=(req as AppRequest).authUser;
    if(!scope||!auth||!['Super Admin','Store Manager'].includes(auth.role))return res.status(403).json({error:'Financial invoice payment access denied.'});
    if(typeof destinationAccountId!=='string'||!destinationAccountId.trim()||destinationAccountId.length>200||!['Cash','Bank Transfer'].includes(paymentMethod))return res.status(400).json({error:'Select a valid cash or bank payment account.'});
    financialPayment={destinationAccountId,recordedBy:scope.recordedBy,effectiveDate:reportDay(new Date())};
  }
  const { activeShopId, activeShopName } = getActiveShopContext(db, req);

  const actor=(req as AppRequest).authUser?.email;
  const request=requestId&&actor?{actor,fingerprint:createHash('sha256').update(JSON.stringify(req.body)).digest('hex')}:undefined;
  let creditTerms:{dueDate:string;evidence:string;recordedBy:string}|undefined;
  if(req.body.creditTerms!==undefined){
    const terms=req.body.creditTerms;
    const auth=(req as AppRequest).authUser;
    if(!request||!auth||!['Super Admin','Store Manager'].includes(auth.role))return res.status(403).json({error:'Credit payment terms require manager authorization and a protected invoice request.'});
    if(paymentMethod!=='Credit Account'||!terms||typeof terms.dueDate!=='string'||typeof terms.evidence!=='string'||!terms.evidence.trim()||terms.evidence.trim().length>500||!/^\d{4}-\d{2}-\d{2}$/.test(terms.dueDate)||!Number.isFinite(Date.parse(terms.dueDate))||new Date(terms.dueDate).toISOString().slice(0,10)!==terms.dueDate)return res.status(400).json({error:'Invalid agreed credit payment terms.'});
    creditTerms={dueDate:terms.dueDate,evidence:terms.evidence.trim(),recordedBy:request.actor};
  }
  if(request){
    const scope=chequeShopAccess(req);
    if(!scope||scope.shopId!==activeShopId)return res.status(403).json({error:'Invoice shop access denied.'});
    const prior=await pool.query('SELECT shop_id,actor,fingerprint FROM ars_invoice_requests WHERE id=$1',[txId]);
    if(prior.rowCount){
      const row=prior.rows[0];
      if(row.shop_id!==activeShopId||row.actor!==actor||row.fingerprint!==request.fingerprint)return res.status(409).json({error:'Invoice request identifier already used for different details.'});
      const saved=await loadStateFromNormalized();
      const existing=saved?.transactions.find(t=>t.id===txId&&t.shopId===activeShopId);
      if(!existing)return res.status(503).json({error:'Invoice recorded but cannot be loaded. Check invoice history.'});
      return res.json(existing);
    }
  }

  if(creditTerms&&creditTerms.dueDate<reportDay(new Date()))return res.status(400).json({error:'Due date cannot precede the invoice date.'});

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

    const sellingUnitId = String(item.sellingUnitId || '').trim();
    const shared = dbProduct.sharedStockUnits;
    const sellingUnit = shared?.units.find(unit => unit.id === sellingUnitId);
    if ((shared || sellingUnitId) && (!sellingUnit || item.variantId || dbProduct.variants?.length)) {
      return res.status(400).json({ error: 'Select a valid shared selling unit for ' + dbProduct.name });
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
    let stockQuantity: number;
    try { stockQuantity = baseQuantity(quantity, sellingUnit?.baseUnits ?? 1); }
    catch { return res.status(400).json({error:'Invalid selling-unit quantity'}); }
    const requestedQty = (requestedQtyByStockKey.get(stockKey) || 0) + stockQuantity;
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
    const standardUnitPrice = sellingUnit ? sellingUnit.sellingPrice : targetVariant ? Number(targetVariant.sellingPrice || 0) : Number(dbProduct.sellingPrice || 0);
    let unitSellingPrice = standardUnitPrice;
    let priceOverride: { standardPrice: number; reason: string } | undefined;
    if (item.customUnitPrice !== undefined || item.priceOverrideReason !== undefined) {
      const role = (req as AppRequest).authUser?.role;
      if (!request || !['Super Admin','Store Manager'].includes(role || '')) return res.status(403).json({error:'Custom pricing requires manager authorization.'});
      const price = item.customUnitPrice;
      const reason = typeof item.priceOverrideReason === 'string' ? item.priceOverrideReason.trim() : '';
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > 1_000_000_000 || roundMoney(price) !== price || !reason || reason.length > 250) return res.status(400).json({error:'Enter a valid custom unit price and reason.'});
      unitSellingPrice = price;
      priceOverride = { standardPrice: standardUnitPrice, reason };
    }
    const unitCostPrice = sellingUnit ? roundMoney(Number(dbProduct.costPrice) * sellingUnit.baseUnits) : targetVariant ? Number(targetVariant.costPrice || 0) : Number(dbProduct.costPrice || 0);
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
      variantUnit: sellingUnit?.label ?? targetVariant?.unit,
      sellingUnitId: sellingUnit?.id,
      sellingUnitLabel: sellingUnit?.label,
      baseUnitsPerSaleUnit: sellingUnit?.baseUnits,
      variantSku: targetVariant?.sku || dbProduct.sku,
      variantBarcode: targetVariant?.barcode,
      quantity,
      sellingPrice: unitSellingPrice,
      priceOverride,
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

  if(financialPayment&&(normalizedPaymentStatus!=='PAID'||total<=0))return res.status(400).json({error:'Financial account posting requires a positive fully paid invoice.'});

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

  // The PostgreSQL checkout transaction allocates the permanent invoice number.

  const tx: SalesTransaction = {
    id: txId,
    shopId: activeShopId,
    invoiceNumber: '',
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
  try {
    const result=await checkoutTransaction(tx, (req as AppRequest).authUser?.role || 'Cashier', activeShopName, undefined, financialPayment,request,creditTerms);
    if(result.replayed){
      const saved=await loadStateFromNormalized();
      const existing=saved?.transactions.find(t=>t.id===txId&&t.shopId===activeShopId);
      if(!existing)return res.status(503).json({error:'Invoice recorded but cannot be loaded. Check invoice history.'});
      return res.json(existing);
    }
  } catch (error) {
    if(error instanceof Error&&['Only fully paid cash or bank invoices can post immediate funds.','Select an active invoice payment account matching the payment method.'].includes(error.message))return res.status(409).json({error:error.message});
    if(error instanceof Error&&error.message==='Invoice request identifier already used for different details.')return res.status(409).json({error:error.message});
    console.error('Checkout database transaction failed:', error);
    return res.status(500).json({error:'Invoice could not be saved. Check the server log and database schema before retrying.'});
  }

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
  if(creditTerms)tx.creditDueDate=creditTerms.dueDate;
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

app.get(['/api/invoice-print-audit/export.csv', '/api/invoice-print-audit/export-report'], requireRole(['Super Admin', 'Store Manager']), (req, res) => {
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
      reportTime(row.printedAt),
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
    if (req.path.endsWith('/export-report')) {
      return res.json({
        title: 'Invoice print audit', filename: 'invoice-print-audit',
        period: (result.normalizedFilters.fromDate || 'All dates') + ' to ' + (result.normalizedFilters.toDate || 'today'),
        headers: header, rows: csvRows.map(row => row.map((value, i) => i === 8 ? Number(value) : value)),
        moneyColumns: [8], summary: [{label:'Matching print events', value:csvRows.length}],
      });
    }
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
      const unit = product.sharedStockUnits?.units.find(u=>u.id===item.sellingUnitId);
      if (product.sharedStockUnits || item.sellingUnitId) {
        if (!unit || item.variantId || product.variants?.length) throw new Error('Select a valid purchasing unit.');
        baseQuantity(quantity,unit.baseUnits);
        sum += quantity * costPrice;
        parts.push({productId:product.id,productName:product.name,quantity,costPrice,sellingUnitId:unit.id,sellingUnitLabel:unit.label,baseUnitsPerPurchaseUnit:unit.baseUnits});
        continue;
      }
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
    poNumber: '',
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

// Customer profile edits are deliberately limited to contact details.
// Existing invoice snapshots, credit balances and payments are never rewritten.
app.put('/api/customers/:id/profile', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  const { activeShopId } = getActiveShopContext(db, req);
  const customer = db.customers.find((c) => c.id === req.params.id && c.shopId === activeShopId);
  if (!customer) return res.status(404).json({ error: 'Customer not found in this shop.' });
  if (customer.id === 'cust-walkin') {
    return res.status(400).json({ error: 'Default walk-in customer cannot be edited.' });
  }
  const details = {
    name: String(req.body?.name ?? '').trim(),
    phone: String(req.body?.phone ?? '').trim(),
    email: String(req.body?.email ?? '').trim(),
    address: String(req.body?.address ?? '').trim(),
  };
  if (!details.name || details.name.length > 160) {
    return res.status(400).json({ error: 'Customer name must be 1–160 characters.' });
  }
  if (details.phone.length > 60 || details.email.length > 254 || details.address.length > 1000) {
    return res.status(400).json({ error: 'Customer contact details exceed the allowed length.' });
  }
  if (details.email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(details.email)) {
    return res.status(400).json({ error: 'Enter a valid email or leave it blank.' });
  }
  try {
    await updateCustomerContact(customer.id, activeShopId, details,
      (req as AppRequest).authUser?.name || 'Manager',
      (req as AppRequest).authUser?.role || 'Store Manager');
  } catch (error) {
    console.error('Unable to update customer profile:', error);
    return res.status(409).json({ error: (error as Error).message });
  }
  try {
    const refreshed = await loadStateFromNormalized();
    if (!refreshed) throw new Error('Could not reload updated customer');
    db = refreshed;
  } catch (error) {
    databaseWriteHealthy = false;
    console.error('Customer edit committed but refresh failed; writes disabled', error);
    return res.status(503).json({ error: 'Customer saved, but refresh failed. Reload before editing again.' });
  }
  return res.json({ customer: db.customers.find((c) => c.id === customer.id) });
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
      date: reportDay(t.date),
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

app.get('/api/supplier-payments/:id/pdf',requireRole(['Super Admin','Store Manager']),async(req:express.Request,res:express.Response)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Payment voucher access denied.'});
  if(!req.params.id||req.params.id.length>200)return res.status(400).json({error:'Invalid payment reference.'});
  try{
    const result=await pool.query(`SELECT p.id,p.amount,p.date::text AS day,p.supplier_name AS payee,COALESCE(o.po_number,p.purchase_order_id,'Supplier account') AS reference,p.payment_method AS method,a.name AS account,m.recorded_by,p.note
      FROM supplier_payments p JOIN ars_financial_movements m ON m.shop_id=p.shop_id AND m.source_id=p.id AND m.movement_kind='Supplier Payment' AND m.amount=-p.amount
      JOIN ars_financial_accounts a ON a.shop_id=m.shop_id AND a.id=m.account_id
      LEFT JOIN purchase_orders o ON o.shop_id=p.shop_id AND o.id=p.purchase_order_id
      WHERE p.shop_id=$1 AND p.id=$2`,[scope.shopId,req.params.id]);
    if(result.rowCount!==1)return res.status(404).json({error:'Verified ledger-linked payment voucher not found. Historical unlinked records require reconciliation.'});
    const p=result.rows[0];
    if(!p.method||!Number.isFinite(Number(p.amount))||Number(p.amount)<=0)return res.status(409).json({error:'Payment ledger requires reconciliation.'});
    const {activeShopName}=getActiveShopContext(db,req);
    const profile=(db.settings.shopProfiles||[]).find(s=>s.id===scope.shopId);
    const pdf=await renderArsDisbursementVoucherPdf({id:p.id,kind:'Supplier Payment',date:p.day,amount:Number(p.amount),payee:p.payee,reference:p.reference,method:p.method,account:p.account,recordedBy:p.recorded_by,note:p.note||undefined},activeShopName,resolvePrintableLogoBuffer(profile?.logoUrl||db.settings.logoUrl||''),profile||db.settings);
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="voucher-'+p.id.replace(/[^a-zA-Z0-9_-]/g,'-')+'.pdf"');return res.send(pdf);
  }catch(error){console.error('Disbursement voucher generation failed',error);return res.status(500).json({error:'Unable to generate payment voucher.'});}
});
app.post('/api/supplier-payments', requireRole(['Super Admin', 'Store Manager']), async (req, res) => {
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const authUser = (req as AppRequest).authUser;
  const { activeShopId } = getActiveShopContext(db, req);
  const { supplierId, purchaseOrderId, amount, paymentMethod, date, note, sourceAccountId, requestId } = req.body || {};
  if(typeof paymentMethod==='string'&&paymentMethod.trim().toLowerCase()==='cheque')return res.status(400).json({error:'Supplier-issued cheques require a separate clearance workflow. Do not record an uncleared cheque as a supplier payment.'});
  if(sourceAccountId!==undefined){
    const scope=chequeShopAccess(req);
    if(!scope||scope.shopId!==activeShopId)return res.status(403).json({error:'Financial source access denied.'});
    if(typeof sourceAccountId!=='string'||!sourceAccountId.trim()||sourceAccountId.length>200||!validChequeRequestId(requestId)||!['Cash','Bank Transfer'].includes(paymentMethod)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>reportDay(new Date()))return res.status(400).json({error:'Select a valid payment source, payment method, date and request identifier.'});
  }
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
    id: 'spay-' + (sourceAccountId?requestId:randomUUID()),
    shopId: activeShopId,
    supplierId: supplier.id,
    supplierName: supplier.companyName || supplier.name,
    purchaseOrderId: purchaseOrderId || undefined,
    amount: paid,
    paymentMethod: String(paymentMethod || 'Bank Transfer'),
    date: String(date || reportDay(new Date())),
    note: typeof note === 'string' ? note.slice(0, 500) : undefined,
    createdBy: sourceAccountId?authUser?.email:authUser?.name,
  };
  try {
    await insertSupplierPayment(sp,sourceAccountId);
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
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const { activeShopId } = getActiveShopContext(db, req);
  const authUser = (req as AppRequest).authUser;
  const { amount, paymentMethod, note, invoiceId, date, requestId, destinationAccountId: requestedDestination } = req.body || {};
  let destinationAccountId=requestedDestination;
  let representative:{userId:string}|undefined;
  if(authUser?.role==='Cashier'){
    const scope=chequeShopAccess(req);
    const user=db.users.find(u=>u.email.toLowerCase()===authUser.email.toLowerCase()&&u.role==='Cashier');
    if(!scope||!user||!eligibleRepresentativeLogin(user,activeShopId))return res.status(403).json({error:'Representative shop access denied.'});
    const identity=await resolveRepresentativeFinancialIdentity(pool,activeShopId,user.id);
    if(!identity)return res.status(403).json({error:'Ask a Super Admin to link your representative cash account before collecting payments.'});
    if((paymentMethod??'Cash')!=='Cash'||!validChequeRequestId(requestId)||(requestedDestination!==undefined&&requestedDestination!==identity.accountId))return res.status(400).json({error:'Representative collections require cash, a protected request ID and your own assigned account.'});
    destinationAccountId=identity.accountId;
    representative={userId:user.id};
  }
  if(destinationAccountId!==undefined&&!representative){
    const requested=getRequestedShopId(req);
    if(!authUser||!['Super Admin','Store Manager'].includes(authUser.role)||
      !db.settings.shopProfiles?.some(s=>s.id===activeShopId)||
      (requested&&requested!==activeShopId)||
      (authUser.scopedShopId&&authUser.scopedShopId!==activeShopId)||
      (authUser.fixedShopId&&authUser.fixedShopId!==activeShopId)||
      (Array.isArray(authUser.allowedShopIds)&&!authUser.allowedShopIds.includes(activeShopId))){
      return res.status(403).json({error:'Financial destination access denied.'});
    }
    if(typeof destinationAccountId!=='string'||!destinationAccountId.trim()||destinationAccountId.length>200||!requestId){
      return res.status(400).json({error:'Select a financial destination and provide a payment request identifier.'});
    }
  }
  const customer = db.customers.find((c) => c.id === req.params.id && c.shopId === activeShopId);
  if (!customer) return res.status(404).json({ error: 'Customer not found in this shop' });
  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0 ||
      Math.abs(normalizedAmount * 100 - Math.round(normalizedAmount * 100)) > 0.00001) {
    return res.status(400).json({ error: 'Payment amount must be positive with up to two decimal places.' });
  }
  if(invoiceId!==undefined && (typeof invoiceId!=='string'||!invoiceId.trim()||invoiceId.length>200))return res.status(400).json({error:'Invalid invoice reference.'});
  const method=paymentMethod ?? 'Cash';
  if(!['Cash','Bank Transfer','Credit Card','QR Code'].includes(method))return res.status(400).json({error:'Unsupported payment method.'});
  const today=reportDay(new Date());
  const paymentDay=date ?? today;
  if(typeof paymentDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(paymentDay)||!Number.isFinite(Date.parse(paymentDay+'T00:00:00Z'))||new Date(paymentDay+'T00:00:00Z').toISOString().slice(0,10)!==paymentDay||paymentDay>today)return res.status(400).json({error:'Enter a valid payment date, not later than today.'});
  if(requestId!==undefined && (typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)))return res.status(400).json({error:'Invalid payment request identifier.'});
  const payment: CustomerCreditPayment = {
    invoiceId: invoiceId || undefined,
    id: 'cpay-' + (requestId || randomUUID()),
    shopId: activeShopId,
    customerId: customer.id,
    customerName: customer.name,
    amount: normalizedAmount,
    date: paymentDay,
    paymentMethod: method,
    note: typeof note === 'string' ? note.slice(0, 500) : undefined,
    createdBy: authUser?.name,
  };
  try {
    payment.receiptSnapshot = await addCustomerCreditPayment(payment,Boolean(requestId),destinationAccountId,undefined,representative);
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
  res.json({ customer: db.customers.find(c=>c.id===customer.id&&c.shopId===activeShopId) || result, payment });
});

app.get('/api/customer-credit-payments', (_req, res) => {
  const { activeShopId } = getActiveShopContext(db, _req);
  res.json(db.customerCreditPayments.filter((p) => p.shopId === activeShopId));
});

app.get('/api/customer-credit-payments/:id/pdf', requireRole(['Super Admin','Store Manager','Cashier']), async(req,res)=>{
  const scope=chequeShopAccess(req),auth=(req as AppRequest).authUser;
  if(!scope||!auth)return res.status(403).json({error:'Payment receipt access denied.'});
  const {activeShopId,activeShopName}=getActiveShopContext(db,req);
  const payment=db.customerCreditPayments.find(p=>p.id===req.params.id&&p.shopId===activeShopId);
  if(!payment)return res.status(404).json({error:'Payment not found in this shop.'});
  const profile=(db.settings.shopProfiles||[]).find(s=>s.id===activeShopId);
  try{
    if(auth.role==='Cashier'){
      const user=db.users.find(u=>u.email.toLowerCase()===auth.email.toLowerCase());
      if(!user||!eligibleRepresentativeLogin(user,scope.shopId))return res.status(403).json({error:'Payment receipt access denied.'});
      const identity=await resolveRepresentativeFinancialIdentity(pool,scope.shopId,user.id);
      if(!identity)return res.status(403).json({error:'Payment receipt access denied.'});
      const owned=await pool.query("SELECT 1 FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2 AND movement_kind='Customer Collection' AND source_id=$3 AND recorded_by=$4",[scope.shopId,identity.accountId,payment.id,user.id]);
      if(!owned.rowCount)return res.status(403).json({error:'Only your own recorded collection receipts are available.'});
    }
    const pdf=await renderArsPaymentReceiptPdf(payment,activeShopName,resolvePrintableLogoBuffer(profile?.logoUrl||db.settings.logoUrl||''),profile||db.settings);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="payment-'+payment.id.replace(/[^a-zA-Z0-9_-]/g,'-')+'.pdf"');
    res.send(pdf);
  }catch(error){console.error('Payment receipt PDF generation failed',error);res.status(500).json({error:'Failed to generate payment receipt.'});}
});

const eligibleRepresentativeLogin=(user:UserAccount,shopId:string)=>{
  if(user.role!=='Cashier')return false;
  const fixed=getUserFixedShop(user.email);
  const allowed=getUserAllowedShops(user);
  if((fixed&&fixed!==shopId)||(allowed&&!allowed.includes(shopId)))return false;
  const access=resolveUserShopAccess(toAuthRecordFromUser(user),shopId);
  return !('error' in access)&&access.scopedShopId===shopId;
};
app.get('/api/representative/me',requireRole(['Cashier']),async(req,res)=>{
  const scope=chequeShopAccess(req);
  const auth=(req as AppRequest).authUser;
  const user=db.users.find(u=>u.email.toLowerCase()===auth?.email.toLowerCase()&&u.role==='Cashier');
  if(!scope||!user||!eligibleRepresentativeLogin(user,scope.shopId))return res.status(403).json({error:'Representative access denied.'});
  try{
    const identity=await resolveRepresentativeFinancialIdentity(pool,scope.shopId,user.id);
    if(!identity)return res.status(404).json({error:'No assigned representative cash account.'});
    const account=(await listFinancialAccounts(pool,scope.shopId)).find(a=>a.id===identity.accountId);
    if(!account)return res.status(404).json({error:'Assigned cash account unavailable.'});
    res.setHeader('Cache-Control','no-store');return res.json({...identity,balance:account.balance});
  }catch(error){console.error('Representative identity read failed',error);return res.status(500).json({error:'Unable to load your cash account.'});}
});
app.get('/api/representative/collections',requireRole(['Cashier']),async(req,res)=>{
  const scope=chequeShopAccess(req);
  const auth=(req as AppRequest).authUser;
  const user=db.users.find(u=>u.email.toLowerCase()===auth?.email.toLowerCase()&&u.role==='Cashier');
  if(!scope||!user||!eligibleRepresentativeLogin(user,scope.shopId))return res.status(403).json({error:'Representative access denied.'});
  const day=reportDay(new Date());
  try{
    const identity=await resolveRepresentativeFinancialIdentity(pool,scope.shopId,user.id);
    if(!identity)return res.status(403).json({error:'No assigned representative cash account.'});
    const result=await pool.query(`WITH movements AS (
      SELECT * FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2
    ), recent AS (
      SELECT m.source_id AS id,m.amount,m.effective_date::text AS date,p.customer_name,p.invoice_id,t.invoice_number
      FROM movements m JOIN customer_credit_payments p ON p.id=m.source_id AND p.shop_id=m.shop_id
      LEFT JOIN sales_transactions t ON t.id=p.invoice_id AND t.shop_id=p.shop_id
      WHERE m.movement_kind='Customer Collection' AND m.recorded_by=$3
      ORDER BY m.effective_date DESC,m.recorded_at DESC,m.id DESC LIMIT 100
    )
    SELECT COALESCE(SUM(amount),0) AS balance,
      COALESCE(SUM(amount) FILTER(WHERE movement_kind='Customer Collection' AND recorded_by=$3 AND effective_date=$4::date),0) AS today_collected,
      COUNT(*) FILTER(WHERE movement_kind='Customer Collection' AND recorded_by=$3 AND effective_date=$4::date) AS today_count,
      (SELECT COALESCE(json_agg(recent),'[]'::json) FROM recent) AS recent
    FROM movements`,[scope.shopId,identity.accountId,user.id,day]);
    const row=result.rows[0];
    res.setHeader('Cache-Control','no-store');
    return res.json({...identity,day,balance:Number(row.balance),todayCollected:Number(row.today_collected),todayCount:Number(row.today_count),recent:row.recent.map((r:any)=>({...r,amount:Number(r.amount)}))});
  }catch(error){console.error('Representative collections read failed',error);return res.status(500).json({error:'Unable to load your collections.'});}
});
app.get('/api/cash-handovers',requireRole(['Super Admin','Store Manager','Cashier']),async(req,res)=>{
  const scope=chequeShopAccess(req),auth=(req as AppRequest).authUser;
  if(!scope||!auth)return res.status(403).json({error:'Cash handover access denied.'});
  const user=db.users.find(u=>u.email.toLowerCase()===auth.email.toLowerCase());
  if(!user)return res.status(403).json({error:'Cash handover access denied.'});
  try{
    const isRep=auth.role==='Cashier';
    const identity=isRep&&eligibleRepresentativeLogin(user,scope.shopId)?await resolveRepresentativeFinancialIdentity(pool,scope.shopId,user.id):null;
    if(isRep&&!identity)return res.status(403).json({error:'No assigned representative cash account.'});
    const result=await pool.query(`SELECT h.id,h.employee_id,e.name AS employee_name,h.from_account_id,f.name AS from_account_name,h.to_account_id,t.name AS to_account_name,h.amount,h.status,h.requested_at,h.request_note,h.decided_by,h.decided_at,h.decision_note,h.effective_date::text AS effective_date
      FROM ars_cash_handovers h LEFT JOIN employees e ON e.id=h.employee_id AND e.shop_id=h.shop_id
      JOIN ars_financial_accounts f ON f.id=h.from_account_id AND f.shop_id=h.shop_id
      JOIN ars_financial_accounts t ON t.id=h.to_account_id AND t.shop_id=h.shop_id
      WHERE h.shop_id=$1 AND ($2::text IS NULL OR (h.user_id=$2 AND h.from_account_id=$3))
      ORDER BY (h.status='Pending') DESC,h.requested_at DESC,h.id DESC LIMIT 200`,[scope.shopId,isRep?user.id:null,identity?.accountId||null]);
    const accounts=await listFinancialAccounts(pool,scope.shopId);
    const officeAccounts=accounts.filter(a=>a.kind==='Office Cash'&&a.active).map(a=>({id:a.id,name:a.name}));
    let balance:number|null=null,pendingAmount:number|null=null;
    if(identity){
      const totals=await pool.query(`SELECT (SELECT COALESCE(SUM(amount),0) FROM ars_financial_movements WHERE shop_id=$1 AND account_id=$2) AS balance,
        (SELECT COALESCE(SUM(amount),0) FROM ars_cash_handovers WHERE shop_id=$1 AND from_account_id=$2 AND status='Pending') AS pending`,[scope.shopId,identity.accountId]);
      balance=Number(totals.rows[0].balance);pendingAmount=Number(totals.rows[0].pending);
    }
    res.setHeader('Cache-Control','no-store');
    return res.json({handovers:result.rows.map(h=>({...h,amount:Number(h.amount)})),officeAccounts,balance,pendingAmount,available:balance===null?null:Math.max(0,balance-(pendingAmount||0))});
  }catch(error){console.error('Cash handover read failed',error);return res.status(500).json({error:'Unable to load cash handovers.'});}
});
app.post('/api/cash-handovers',requireRole(['Cashier']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req),auth=(req as AppRequest).authUser;
  const user=db.users.find(u=>u.email.toLowerCase()===auth?.email.toLowerCase());
  if(!scope||!user||!eligibleRepresentativeLogin(user,scope.shopId))return res.status(403).json({error:'Cash handover access denied.'});
  const {requestId,toAccountId,amount,note}=req.body||{};
  if(!validChequeRequestId(requestId)||typeof toAccountId!=='string'||!toAccountId.trim()||toAccountId.length>200||typeof amount!=='number'||!Number.isFinite(amount)||(note!==undefined&&(typeof note!=='string'||note.length>500)))return res.status(400).json({error:'Invalid cash handover details.'});
  try{
    const result=await requestCashHandover(pool,{id:requestId,shopId:scope.shopId,userId:user.id,toAccountId,amount,note});
    return res.status(result.replayed?200:201).json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Invalid cash handover request.','Representative cash account authorization required.','Handover request identifier already used for different details.','Select an active office cash account in this shop.','Handover exceeds cash balance after pending requests.'].includes(message))return res.status(409).json({error:message});
    console.error('Cash handover request failed',error);return res.status(500).json({error:'Unable to confirm handover request. Retry the same request.'});
  }
});
app.get('/api/cash-handovers/:id/pdf',requireRole(['Super Admin','Store Manager','Cashier']),async(req,res)=>{
  const scope=chequeShopAccess(req),auth=(req as AppRequest).authUser;
  if(!scope||!auth)return res.status(403).json({error:'Handover voucher access denied.'});
  if(!validChequeRequestId(req.params.id))return res.status(400).json({error:'Invalid handover reference.'});
  try{
    const user=db.users.find(u=>u.email.toLowerCase()===auth.email.toLowerCase());
    if(!user)return res.status(403).json({error:'Handover voucher access denied.'});
    const isRep=auth.role==='Cashier';
    const identity=isRep&&eligibleRepresentativeLogin(user,scope.shopId)?await resolveRepresentativeFinancialIdentity(pool,scope.shopId,user.id):null;
    if(isRep&&!identity)return res.status(403).json({error:'Handover voucher access denied.'});
    const result=await pool.query(`SELECT h.*,h.effective_date::text AS business_day,e.name AS employee_name,f.name AS from_name,t.name AS to_name
      FROM ars_cash_handovers h LEFT JOIN employees e ON e.id=h.employee_id AND e.shop_id=h.shop_id
      JOIN ars_financial_accounts f ON f.id=h.from_account_id AND f.shop_id=h.shop_id
      JOIN ars_financial_accounts t ON t.id=h.to_account_id AND t.shop_id=h.shop_id
      WHERE h.shop_id=$1 AND h.id=$2 AND h.status='Confirmed'
      AND ($3::text IS NULL OR (h.user_id=$3 AND h.from_account_id=$4))`,[scope.shopId,req.params.id,isRep?user.id:null,identity?.accountId||null]);
    const h=result.rows[0];
    if(!h)return res.status(404).json({error:'Confirmed handover voucher not found.'});
    const {activeShopName}=getActiveShopContext(db,req);
    const profile=(db.settings.shopProfiles||[]).find(s=>s.id===scope.shopId);
    const stamp=(value:Date|string)=>new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Colombo'})+' (Sri Lanka)';
    const pdf=await renderArsHandoverVoucherPdf({id:h.id,amount:Number(h.amount),employeeName:h.employee_name||h.employee_id,fromAccount:h.from_name,toAccount:h.to_name,requestedAt:stamp(h.requested_at),confirmedAt:stamp(h.decided_at),effectiveDate:h.business_day,confirmedBy:h.decided_by,requestNote:h.request_note||undefined,decisionNote:h.decision_note||undefined},activeShopName,resolvePrintableLogoBuffer(profile?.logoUrl||db.settings.logoUrl||''),profile||db.settings);
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="handover-'+h.id+'.pdf"');return res.send(pdf);
  }catch(error){console.error('Handover voucher generation failed',error);return res.status(500).json({error:'Unable to generate handover voucher.'});}
});
app.post('/api/cash-handovers/:id/decision',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req),auth=(req as AppRequest).authUser;
  const user=db.users.find(u=>u.email.toLowerCase()===auth?.email.toLowerCase());
  if(!scope||!user)return res.status(403).json({error:'Cash handover decision access denied.'});
  const {decision,note}=req.body||{};
  if(!validChequeRequestId(req.params.id)||!['Confirmed','Rejected'].includes(decision)||(note!==undefined&&(typeof note!=='string'||note.length>500))||(decision==='Rejected'&&!note?.trim()))return res.status(400).json({error:'Select a valid decision and provide a reason for rejection.'});
  try{
    const result=await decideCashHandover(pool,{id:req.params.id,...scope,managerUserId:user.id,decision,effectiveDate:reportDay(new Date()),note});
    return res.json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Invalid handover decision.','Manager authorization required.','Handover not found in this shop.','A representative cannot approve their own handover.','Handover already decided.','Handover accounts are unavailable.','Insufficient recorded funds to confirm handover.'].includes(message))return res.status(409).json({error:message});
    console.error('Cash handover decision failed',error);return res.status(500).json({error:'Unable to confirm handover decision. Refresh or retry the same decision.'});
  }
});
app.get('/api/representative-logins',requireRole(['Super Admin']),async(req,res)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Representative login access denied.'});
  try{
    const links=await pool.query('SELECT employee_id AS "employeeId",user_id AS "userId",linked_by AS "linkedBy",linked_at AS "linkedAt" FROM ars_representative_logins WHERE shop_id=$1',[scope.shopId]);
    const assignments=await listRepresentativeAccounts(pool,scope.shopId);
    const users=db.users.filter(u=>eligibleRepresentativeLogin(u,scope.shopId)).map(u=>({id:u.id,name:u.name,email:u.email}));
    res.setHeader('Cache-Control','no-store');
    return res.json({links:links.rows,assignments,users});
  }catch(error){console.error('Representative login directory failed',error);return res.status(500).json({error:'Unable to load representative logins.'});}
});
app.post('/api/representative-logins',requireRole(['Super Admin']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Representative login access denied.'});
  const {employeeId,userId}=req.body||{};
  if(typeof employeeId!=='string'||!employeeId.trim()||employeeId.length>200||typeof userId!=='string'||!userId.trim()||userId.length>200)return res.status(400).json({error:'Select a representative and login.'});
  const user=db.users.find(u=>u.id===userId);
  if(!user||!eligibleRepresentativeLogin(user,scope.shopId))return res.status(403).json({error:'Login is not authorized for this shop.'});
  try{
    const result=await linkRepresentativeLogin(pool,{...scope,employeeId,userId});
    return res.status(result.replayed?200:201).json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Invalid representative login link.','Select an existing sales representative login.','Select an active representative staff record.','Assign an active representative cash account first.','Login or employee already linked. Administrative reconciliation required.'].includes(message))return res.status(409).json({error:message});
    console.error('Representative login link failed',error);return res.status(500).json({error:'Unable to confirm link. Refresh or retry the same selection.'});
  }
});
app.get('/api/representative-accounts',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Representative account access denied.'});
  try{
    const assignments=await listRepresentativeAccounts(pool,scope.shopId);
    const employees=await pool.query("SELECT id,name FROM employees WHERE shop_id=$1 AND role='Cashier' ORDER BY name,id",[scope.shopId]);
    const accounts=await listFinancialAccounts(pool,scope.shopId);
    res.setHeader('Cache-Control','no-store');
    return res.json({assignments,employees:employees.rows,accounts:accounts.filter(a=>a.kind==='Representative Cash'&&a.active)});
  }catch(error){console.error('Representative account read failed',error);return res.status(500).json({error:'Unable to load representative accounts.'});}
});
app.post('/api/representative-accounts',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Representative account access denied.'});
  const {employeeId,accountId}=req.body||{};
  if(typeof employeeId!=='string'||!employeeId.trim()||employeeId.length>200||typeof accountId!=='string'||!accountId.trim()||accountId.length>200)return res.status(400).json({error:'Select a representative and cash account.'});
  try{
    const result=await assignRepresentativeAccount(pool,{...scope,employeeId,accountId});
    return res.status(result.replayed?200:201).json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Invalid representative assignment.','Select a registered sales representative in this shop.','Select an active representative cash account in this shop.','Representative or cash account already assigned. Reconcile before reassignment.','Assign a new cash account with no recorded movements; historical balances require reconciliation.'].includes(message))return res.status(409).json({error:message});
    console.error('Representative assignment failed',error);return res.status(500).json({error:'Unable to confirm assignment. Reload or retry the same selection.'});
  }
});
app.get('/api/invoice-cost-review',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Historical cost review access denied.'});
 const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,160):'';
 const missingOnly=req.query.missingOnly==='true';
 const offset=Number(req.query.offset||0);
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)return res.status(400).json({error:'Invalid page.'});
 try{
  const result=await pool.query(`SELECT t.id AS transaction_id,t.invoice_number,(t.date AT TIME ZONE 'Asia/Colombo')::date::text AS day,t.status,
    i.id::text AS item_id,i.product_name,i.quantity,i.variant_unit,i.selling_unit_label,i.cost_price AS original_cost,
    COALESCE(c.corrected_cost,i.cost_price) AS current_cost,c.recorded_at AS corrected_at
    FROM sales_transactions t JOIN sales_transaction_items i ON i.transaction_id=t.id
    LEFT JOIN LATERAL (SELECT corrected_cost,recorded_at FROM ars_invoice_cost_corrections WHERE shop_id=t.shop_id AND transaction_id=t.id AND item_id=i.id AND original_cost=i.cost_price ORDER BY revision DESC LIMIT 1) c ON TRUE
    WHERE t.shop_id=$1 AND t.status IN ('Completed','Refunded') AND ($2='' OR strpos(lower(t.invoice_number),lower($2))>0 OR strpos(lower(i.product_name),lower($2))>0)
    AND (NOT $3::boolean OR COALESCE(c.corrected_cost,i.cost_price)<=0)
    ORDER BY t.date DESC,t.id,i.id LIMIT 101 OFFSET $4`,[scope.shopId,search,missingOnly,offset]);
  res.setHeader('Cache-Control','no-store');
  return res.json({rows:result.rows.slice(0,100).map(r=>({...r,original_cost:Number(r.original_cost),current_cost:Number(r.current_cost),quantity:Number(r.quantity)})),offset,hasMore:result.rows.length>100});
 }catch(error){console.error('Historical cost review failed',error);return res.status(500).json({error:'Unable to load invoice cost review.'});}
});
app.get('/api/invoice-cost-review/:transactionId/:itemId/history',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Historical cost review access denied.'});
 const {transactionId,itemId}=req.params;
 if(!/^\d{1,18}$/.test(itemId)||transactionId.length>200)return res.status(400).json({error:'Invalid invoice item.'});
 try{
  const line=await pool.query('SELECT 1 FROM sales_transaction_items i JOIN sales_transactions t ON t.id=i.transaction_id WHERE t.shop_id=$1 AND t.id=$2 AND i.id=$3::bigint',[scope.shopId,transactionId,itemId]);
  if(!line.rowCount)return res.status(404).json({error:'Invoice item not found.'});
  const result=await pool.query('SELECT id,original_cost,previous_cost,corrected_cost,evidence,reason,recorded_by,recorded_at,revision::text FROM ars_invoice_cost_corrections WHERE shop_id=$1 AND transaction_id=$2 AND item_id=$3::bigint ORDER BY revision DESC',[scope.shopId,transactionId,itemId]);
  res.setHeader('Cache-Control','no-store');return res.json(result.rows.map(r=>({...r,original_cost:Number(r.original_cost),previous_cost:Number(r.previous_cost),corrected_cost:Number(r.corrected_cost)})));
 }catch(error){console.error('Cost history failed',error);return res.status(500).json({error:'Unable to load correction history.'});}
});
app.post('/api/invoice-cost-review/:transactionId/:itemId/corrections',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Historical cost correction access denied.'});
 const {transactionId,itemId}=req.params;
 const {requestId,expectedCost,correctedCost,evidence,reason}=req.body||{};
 if(!validChequeRequestId(requestId)||!/^\d{1,18}$/.test(itemId)||transactionId.length>200||typeof expectedCost!=='number'||typeof correctedCost!=='number'||typeof evidence!=='string'||typeof reason!=='string'||evidence.length>500||reason.length>500)return res.status(400).json({error:'Enter a valid cost, reason and evidence reference.'});
 try{
  const result=await correctHistoricalInvoiceCost(pool,{id:requestId,...scope,transactionId,itemId,expectedCost,correctedCost,evidence,reason});
  return res.status(result.replayed?200:201).json(result);
 }catch(error){
  const message=error instanceof Error?error.message:'';
  if(['Invalid historical cost correction.','Correction request identifier already used for different details.','Invoice item not found in this shop.','Historical cost changed. Refresh before correcting.','Corrected cost must differ from the current cost.'].includes(message))return res.status(409).json({error:message});
  console.error('Cost correction failed',error);return res.status(500).json({error:'Unable to confirm correction. Retry the same request.'});
 }
});
app.get('/api/import-expense-reconciliation',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Import expense review access denied.'});
 try{const data=await listImportExpenseReview(pool,scope.shopId);res.setHeader('Cache-Control','no-store');return res.json(data);}
 catch(error){console.error('Import expense review failed',error);return res.status(500).json({error:'Unable to load import expense review.'});}
});
app.post('/api/import-expense-reconciliation',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Import expense approval access denied.'});
 const {requestId,approvalId,expenseId,chargeKind,expectedAmount,evidence}=req.body||{};
 if(!validChequeRequestId(requestId)||typeof approvalId!=='string'||!approvalId||typeof expenseId!=='string'||!expenseId||!['Freight','Customs','Clearance'].includes(chargeKind)||typeof expectedAmount!=='number'||!Number.isFinite(expectedAmount)||expectedAmount<=0||typeof evidence!=='string'||!evidence.trim()||evidence.length>500)return res.status(400).json({error:'Select a verified payment, approved charge and evidence.'});
 try{const result=await linkImportExpense(pool,{id:requestId,shopId:scope.shopId,approvalId,expenseId,chargeKind,expectedAmount,evidence,recordedBy:scope.recordedBy});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(['Valid verified payment and evidence required.','Reconciliation request identifier already used.','Approved shipment not found in this shop.','Expense missing or amount changed. Refresh before linking.','Expense must have one matching verified financial payment.','Expense already reconciled.','Invalid approved charge amount.','Payment exceeds remaining approved shipment charge.'].includes(message))return res.status(409).json({error:message});console.error('Import expense reconciliation failed',error);return res.status(500).json({error:'Unable to confirm reconciliation. Retry the same request.'});}
});
function importObligationError(res:express.Response,error:unknown){
 const message=error instanceof Error?error.message:'';
 if(['Valid creditor, document, due date and evidence required.','Positive obligation amount required.','Approved shipment not found.','Existing import charges require reconciliation.','Obligation identifier already used.','Obligation exceeds remaining approved charge.','Valid obligation review required.','Import obligation not found.','Independent obligation reviewer required.','Obligation review already recorded.'].includes(message))return res.status(409).json({error:message});
 if((error as any)?.code==='23505')return res.status(409).json({error:'Obligation document or identifier already registered.'});
 console.error('Import obligation operation failed',error);return res.status(500).json({error:'Unable to complete import obligation operation.'});
}
app.get('/api/import-obligations/:approvalId',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Import obligation access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await listImportObligations(pool,scope.shopId,req.params.approvalId));}catch(error){return importObligationError(res,error);}
});
app.post('/api/import-obligations',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Import obligation access denied.'});
 const {requestId,approvalId,chargeKind,creditorName,documentReference,amount,dueDate,evidence}=req.body||{};
 if(!validChequeRequestId(requestId)||typeof amount!=='string'||!/^\d{1,14}(\.\d{1,2})?$/.test(amount)||typeof dueDate!=='string')return res.status(400).json({error:'Valid obligation details required.'});
 try{const result=await submitImportObligation(pool,{id:requestId,shopId:scope.shopId,actor:scope.recordedBy,approvalId,chargeKind,creditorName,documentReference,amount,dueDate,evidence});return res.status(result.replayed?200:201).json(result);}catch(error){return importObligationError(res,error);}
});
app.post('/api/import-obligations/:id/review',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Import obligation approval access denied.'});
 const {decision,evidence}=req.body||{};
 try{return res.json(await reviewImportObligation(pool,{shopId:scope.shopId,id:req.params.id,actor:scope.recordedBy,decision,evidence}));}catch(error){return importObligationError(res,error);}
});
app.post('/api/import-obligations/:id/settlements',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Import settlement access denied.'});
 const {requestId,accountId,amount,date,evidence}=req.body||{};
 if(!validChequeRequestId(requestId)||typeof accountId!=='string'||typeof amount!=='string'||!/^\d{1,14}(\.\d{1,2})?$/.test(amount)||typeof date!=='string'||typeof evidence!=='string')return res.status(400).json({error:'Valid settlement details required.'});
 try{const result=await settleImportCreditor(pool,{shopId:scope.shopId,id:requestId,obligationId:req.params.id,accountId,amount,date,evidence,actor:scope.recordedBy});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';
 if(['Valid creditor settlement details required.','Positive settlement required.','Settlement identifier already used.','Active accounting required for creditor settlement.','Approved creditor obligation required.','Payment exceeds recognized outstanding liability.','Active cash or bank account required.','Insufficient recorded funds.','Missing active settlement accounting mapping.'].includes(message))return res.status(409).json({error:message});
 console.error('Import creditor settlement failed',error);return res.status(500).json({error:'Unable to confirm settlement. Retry the same request.'});}
});
app.get('/api/import-obligations/:id/settlements',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Import settlement access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{const result=await pool.query('SELECT s.id,s.amount::text,s.payment_date::text,s.evidence,s.recorded_by,s.journal_id,s.account_id,a.name AS account_name FROM ars_gl_import_settlements s LEFT JOIN ars_financial_accounts a ON a.shop_id=s.shop_id AND a.id=s.account_id WHERE s.shop_id=$1 AND s.obligation_id=$2 ORDER BY s.payment_date DESC,s.id LIMIT 500',[scope.shopId,req.params.id]);return res.json(result.rows);}
 catch(error){console.error('Import settlement history failed',error);return res.status(500).json({error:'Unable to load settlement history.'});}
});
// Read-only return candidates; the posting transaction revalidates every quantity.
app.get('/api/ledger/purchase-returns/:poId/candidates',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Purchase return access denied.'});
 res.setHeader('Cache-Control','no-store');
 const day=typeof req.query.date==='string'?req.query.date:reportDay(new Date());
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||day>reportDay(new Date()))return res.status(400).json({error:'Valid return date required.'});
 try{
 const result=await pool.query(`SELECT i.id AS "itemId",i.product_name AS "productName",i.variant_id AS "variantId",i.selling_unit_label AS "purchaseUnit",i.base_units_per_purchase_unit AS "purchaseFactor",i.cost_price::text AS "purchaseCost",i.quantity AS ordered,p.id AS "productId",p.quantity AS stock,p.shared_stock_units AS packaging,p.variants_json AS variants,
 po.status,cut.posting_enabled,cut.cutover_date::text AS cutover,
 EXISTS(SELECT 1 FROM ars_landed_cost_approvals a WHERE a.shop_id=po.shop_id AND a.purchase_order_id=po.id) AS imported,
 EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=po.shop_id AND j.source_kind='PurchaseReceipt' AND j.source_id=po.id AND j.posting_date<=$3) AS full,
 EXISTS(SELECT 1 FROM ars_receipt_batches b WHERE b.shop_id=po.shop_id AND b.purchase_order_id=po.id AND NOT EXISTS(SELECT 1 FROM ars_gl_journals j WHERE j.shop_id=b.shop_id AND j.source_kind='ReceiptBatch' AND j.source_id=b.id)) AS unposted,
 COALESCE((SELECT sum(ri.quantity) FROM ars_receipt_batch_items ri JOIN ars_receipt_batches b ON b.id=ri.batch_id JOIN ars_gl_journals j ON j.shop_id=b.shop_id AND j.source_kind='ReceiptBatch' AND j.source_id=b.id WHERE b.shop_id=po.shop_id AND b.purchase_order_id=po.id AND ri.purchase_order_item_id=i.id AND j.posting_date<=$3),0)::text AS received,
 COALESCE((SELECT sum(l.base_quantity) FROM ars_gl_purchase_return_lines l JOIN ars_gl_purchase_returns h ON h.shop_id=l.shop_id AND h.id=l.return_id WHERE h.shop_id=po.shop_id AND h.purchase_order_id=po.id AND l.purchase_order_item_id=i.id),0)::text AS returned
 FROM purchase_orders po JOIN purchase_order_items i ON i.purchase_order_id=po.id LEFT JOIN products p ON p.shop_id=po.shop_id AND p.id=i.product_id LEFT JOIN ars_gl_cutover cut ON cut.shop_id=po.shop_id WHERE po.shop_id=$1 AND po.id=$2 ORDER BY i.id`,[scope.shopId,req.params.poId,day]);
 if(!result.rows.length)return res.status(404).json({error:'Purchase order lines not found.'});
 const first=result.rows[0];
 if(!['Received','Partially Received'].includes(first.status)||!first.posting_enabled||day<first.cutover||first.imported||first.unposted)return res.status(409).json({error:'Purchase order requires receipt or accounting reconciliation before return.'});
 const items=result.rows.map(row=>{
 const factor=Number(row.purchaseFactor??1);
 const received=Number(row.full?row.ordered:row.received)*factor;
 const returned=Number(row.returned);
 const variants=Array.isArray(row.variants)?row.variants:[];
 const variant=variants.find((v:any)=>v.id===row.variantId);
 const stock=Number(variant?variant.quantity:row.stock);
 const safe=!!row.productId&&Number.isSafeInteger(factor)&&factor>0&&Number.isSafeInteger(received)&&Number.isSafeInteger(returned)&&Number.isSafeInteger(stock)&&!(row.full&&Number(row.received)>0)&&(!variants.length||!!variant)&&(!row.packaging||(!variants.length&&!!row.purchaseFactor&&!!row.purchaseUnit));
 const units=safe&&row.packaging&&Array.isArray(row.packaging.units)?row.packaging.units.filter((u:any)=>Number.isSafeInteger(u.baseUnits)&&u.baseUnits>0&&typeof u.label==='string').map((u:any)=>({id:u.id,label:u.label,baseUnits:u.baseUnits})):[{id:'base',label:'Base unit',baseUnits:1}];
 return {itemId:Number(row.itemId),productName:row.productName,purchaseUnit:row.purchaseUnit,purchaseFactor:factor,purchaseCost:row.purchaseCost,receivedBaseQuantity:received,returnedBaseQuantity:returned,availableBaseQuantity:safe?Math.max(0,Math.min(stock,received-returned)):0,units};
 });
 return res.json({date:day,items});
 }catch(error){console.error('Purchase return candidates failed',error);return res.status(500).json({error:'Unable to load verified purchase return lines.'});}
});
app.post('/api/ledger/purchase-returns',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Purchase return access denied.'});
 const {requestId,poId,date,reason,evidence,items}=req.body||{};
 if(!validChequeRequestId(requestId)||typeof poId!=='string'||typeof date!=='string'||typeof reason!=='string'||typeof evidence!=='string'||!Array.isArray(items)||items.length<1||items.length>200||items.some((x:any)=>!x||typeof x.supplierCredit!=='string'||!/^\d{1,14}(\.\d{1,2})?$/.test(x.supplierCredit)))return res.status(400).json({error:'Valid purchase return details required.'});
 try{const result=await recordPurchaseReturn(pool,{shopId:scope.shopId,id:requestId,poId,date,reason,evidence,items,actor:scope.recordedBy});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';
 if(['Valid purchase return details required.','Valid unique return lines required.','Return identifier already used.','Active accounting required for purchase returns.','Received purchase order required.','Import returns require landed charge reconciliation.','Unposted receipt history requires reconciliation.','Return line not found in purchase order.','Returned product unavailable.','Incompatible purchase unit snapshot.','Mixed receipt history requires reconciliation.','Return exceeds received quantity or available stock.','Return credit exceeds verified purchase cost.','Historical supplier payments require reconciliation.','Supplier balances require reconciliation.'].includes(message)||message.startsWith('Missing purchase return accounting mapping:'))return res.status(409).json({error:message});
 console.error('Purchase return failed',error);return res.status(500).json({error:'Unable to confirm purchase return. Retry the same request.'});}
});
app.get('/api/ledger/purchase-returns/:poId',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Purchase return access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{const result=await pool.query(`SELECT h.id,h.return_date::text,h.reason,h.evidence,h.recorded_by,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('itemId',l.purchase_order_item_id,'baseQuantity',l.base_quantity,'inventoryCost',l.inventory_cost::text,'supplierCredit',l.supplier_credit::text) ORDER BY l.purchase_order_item_id) FROM ars_gl_purchase_return_lines l WHERE l.shop_id=h.shop_id AND l.return_id=h.id),'[]'::jsonb) AS items
 FROM ars_gl_purchase_returns h WHERE h.shop_id=$1 AND h.purchase_order_id=$2 ORDER BY h.return_date DESC,h.id LIMIT 500`,[scope.shopId,req.params.poId]);return res.json(result.rows);}
 catch(error){console.error('Purchase return history failed',error);return res.status(500).json({error:'Unable to load purchase returns.'});}
});
app.post('/api/ledger/import-charge-recoveries',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Import recovery access denied.'});
 const {requestId,returnId,chargeKind,payer,documentReference,accountId,amount,date,evidence}=req.body||{};
 if(!validChequeRequestId(requestId)||![returnId,payer,documentReference,accountId,evidence].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)||!['Freight','Customs','Clearance'].includes(chargeKind)||typeof amount!=='string'||!/^\d{1,12}(\.\d{1,2})?$/.test(amount)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>reportDay(new Date()))return res.status(400).json({error:'Valid documented import recovery required.'});
 try{const result=await recordImportChargeRecovery(pool,{shopId:scope.shopId,id:requestId,returnId,chargeKind,payer,documentReference,accountId,amount,date,evidence,actor:scope.recordedBy});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';
 if(['Valid documented import recovery required.','Valid positive recovery amount required.','Recovery identifier already used.','Active accounting required for import recovery.','Posted import return required before recovery.','Import purchase order not found.','Approved landed charges required.','Verified import return cost records required.','Active return variance account required.','Approved import charge breakdown required.','Import recovery balances require reconciliation.','Recovery date precedes later recovery.','Recovery exceeds documented available import charge loss.','Recovery document already used.','Active cash or bank account required.','Active recovery financial mapping required.','Accounting period is closed'].includes(message))return res.status(409).json({error:message});
 console.error('Import recovery failed',error);return res.status(500).json({error:'Unable to confirm import recovery. Retry the same request.'});}
});
app.get('/api/ledger/import-charge-recoveries/:returnId/availability',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Import recovery access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await importRecoveryAvailability(pool,scope.shopId,req.params.returnId));}
 catch(error){const message=error instanceof Error?error.message:'';
 if(message==='Posted import return required before recovery.')return res.status(404).json({error:message});
 if(['Active accounting required for import recovery.','Import purchase order not found.','Approved landed charges required.','Verified import return cost records required.','Active return variance account required.','Approved import charge breakdown required.','Import recovery balances require reconciliation.'].includes(message))return res.status(409).json({error:message});
 console.error('Import recovery availability failed',error);return res.status(500).json({error:'Unable to calculate available import recovery.'});}
});
app.get('/api/ledger/import-charge-recoveries/:returnId',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Import recovery access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{
 const h=await pool.query('SELECT id FROM ars_gl_purchase_returns WHERE shop_id=$1 AND id=$2',[scope.shopId,req.params.returnId]);
 if(!h.rowCount)return res.status(404).json({error:'Purchase return not found.'});
 const rows=await pool.query(`SELECT r.id,r.charge_kind,r.payer,r.document_reference,r.amount::text,r.recovery_date::text,r.evidence,r.recorded_by,r.journal_id,r.account_id,a.name AS account_name FROM ars_gl_import_charge_recoveries r LEFT JOIN ars_financial_accounts a ON a.shop_id=r.shop_id AND a.id=r.account_id WHERE r.shop_id=$1 AND r.return_id=$2 ORDER BY r.recovery_date DESC,r.id LIMIT 500`,[scope.shopId,req.params.returnId]);
 return res.json(rows.rows);
 }catch(error){console.error('Import recovery history failed',error);return res.status(500).json({error:'Unable to load import recovery history.'});}
});
app.post('/api/ledger/supplier-refunds',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Supplier refund access denied.'});
 const {requestId,returnId,accountId,amount,date,evidence}=req.body||{};
 if(!validChequeRequestId(requestId)||![returnId,accountId,evidence].every(v=>typeof v==='string'&&v.trim()&&v.length<=500)||typeof amount!=='string'||!/^\d{1,12}(\.\d{1,2})?$/.test(amount)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>reportDay(new Date()))return res.status(400).json({error:'Valid supplier refund details required.'});
 try{const result=await recordSupplierRefund(pool,{shopId:scope.shopId,id:requestId,returnId,accountId,amount,date,evidence,actor:scope.recordedBy});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';
 if(['Valid supplier refund details required.','Valid positive refund amount required.','Refund identifier already used.','Active accounting required for supplier refunds.','Posted purchase return required before refund.','Refund date precedes later supplier transactions.','Refund exceeds available supplier return credit.','Active cash or bank account required.','Distinct active refund accounting mapping required.','Supplier order not found.','Historical supplier payments require reconciliation.','Supplier balances require reconciliation.','Accounting period is closed'].includes(message)||message.startsWith('Missing supplier accounting mapping:'))return res.status(409).json({error:message});
 console.error('Supplier refund failed',error);return res.status(500).json({error:'Unable to confirm supplier refund. Retry the same request.'});}
});
app.get('/api/ledger/supplier-refunds/:returnId/availability',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Supplier refund access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await supplierRefundAvailability(pool,scope.shopId,req.params.returnId));}
 catch(error){const message=error instanceof Error?error.message:'';
 if(message==='Posted purchase return required before refund.')return res.status(404).json({error:message});
 if(['Active accounting required for supplier refunds.','Supplier order not found.','Historical supplier payments require reconciliation.','Supplier balances require reconciliation.'].includes(message)||message.startsWith('Missing supplier accounting mapping:'))return res.status(409).json({error:message});
 console.error('Supplier refund availability failed',error);return res.status(500).json({error:'Unable to calculate refundable credit.'});}
});
app.get('/api/ledger/import-charge-recovery-receipts/:id/pdf',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Import recovery receipt access denied.'});
 try{
 const result=await pool.query(`SELECT f.id,f.recovery_date::text AS day,f.amount::text,f.evidence,f.recorded_by,f.payer,f.charge_kind,f.document_reference,h.id AS return_id,p.id AS po_id,a.name AS account,a.kind
 FROM ars_gl_import_charge_recoveries f JOIN ars_gl_purchase_returns h ON h.shop_id=f.shop_id AND h.id=f.return_id
 JOIN purchase_orders p ON p.shop_id=h.shop_id AND p.id=h.purchase_order_id
 JOIN ars_gl_journals j ON j.shop_id=f.shop_id AND j.id=f.journal_id AND j.source_kind='ImportChargeRecovery' AND j.source_id=f.id
 JOIN ars_financial_movements m ON m.shop_id=f.shop_id AND m.source_id=f.id AND m.movement_kind='Import Charge Recovery' AND m.account_id=f.account_id AND m.amount=f.amount AND m.effective_date=f.recovery_date
 JOIN ars_financial_accounts a ON a.shop_id=f.shop_id AND a.id=f.account_id
 WHERE f.shop_id=$1 AND f.id=$2`,[scope.shopId,req.params.id]);
 if(result.rowCount!==1)return res.status(404).json({error:'Verified import recovery receipt not found.'});
 const f=result.rows[0];const amount=Number(f.amount);
 if(!Number.isFinite(amount)||amount<=0||!['Office Cash','Bank'].includes(f.kind))return res.status(409).json({error:'Recovery requires reconciliation.'});
 const {activeShopName}=getActiveShopContext(db,req);
 const profile=(db.settings.shopProfiles||[]).find(s=>s.id===scope.shopId);
 const pdf=await renderArsDisbursementVoucherPdf({id:f.id,kind:'Import Charge Recovery',date:f.day,amount,payee:f.payer,reference:f.po_id+' / '+f.return_id+' / '+f.charge_kind+' / '+f.document_reference,method:f.kind==='Bank'?'Bank Transfer':'Cash',account:f.account,recordedBy:f.recorded_by,note:f.evidence},activeShopName,resolvePrintableLogoBuffer(profile?.logoUrl||db.settings.logoUrl||''),profile||db.settings);
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="import-charge-recovery-'+f.id.replace(/[^a-zA-Z0-9_-]/g,'-')+'.pdf"');return res.send(pdf);
 }catch(error){console.error('Import recovery receipt failed',error);return res.status(500).json({error:'Unable to generate import recovery receipt.'});}
});
app.get('/api/ledger/supplier-refund-receipts/:id/pdf',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Supplier refund receipt access denied.'});
 try{
 const result=await pool.query(`SELECT f.id,f.refund_date::text AS day,f.amount::text,f.evidence,f.recorded_by,h.id AS return_id,p.id AS po_id,p.supplier_name,a.name AS account,a.kind
 FROM ars_gl_supplier_refunds f JOIN ars_gl_purchase_returns h ON h.shop_id=f.shop_id AND h.id=f.return_id
 JOIN purchase_orders p ON p.shop_id=h.shop_id AND p.id=h.purchase_order_id
 JOIN ars_gl_journals j ON j.shop_id=f.shop_id AND j.id=f.journal_id AND j.source_kind='SupplierReturnRefund' AND j.source_id=f.id
 JOIN ars_financial_movements m ON m.shop_id=f.shop_id AND m.source_id=f.id AND m.movement_kind='Supplier Return Refund' AND m.account_id=f.account_id AND m.amount=f.amount AND m.effective_date=f.refund_date
 JOIN ars_financial_accounts a ON a.shop_id=f.shop_id AND a.id=f.account_id
 WHERE f.shop_id=$1 AND f.id=$2`,[scope.shopId,req.params.id]);
 if(result.rowCount!==1)return res.status(404).json({error:'Verified supplier refund receipt not found.'});
 const f=result.rows[0];const amount=Number(f.amount);
 if(!Number.isFinite(amount)||amount<=0||!['Office Cash','Bank'].includes(f.kind))return res.status(409).json({error:'Refund requires reconciliation.'});
 const {activeShopName}=getActiveShopContext(db,req);
 const profile=(db.settings.shopProfiles||[]).find(s=>s.id===scope.shopId);
 const pdf=await renderArsDisbursementVoucherPdf({id:f.id,kind:'Supplier Refund',date:f.day,amount,payee:f.supplier_name,reference:f.po_id+' / '+f.return_id,method:f.kind==='Bank'?'Bank Transfer':'Cash',account:f.account,recordedBy:f.recorded_by,note:f.evidence},activeShopName,resolvePrintableLogoBuffer(profile?.logoUrl||db.settings.logoUrl||''),profile||db.settings);
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="supplier-refund-'+f.id.replace(/[^a-zA-Z0-9_-]/g,'-')+'.pdf"');return res.send(pdf);
 }catch(error){console.error('Supplier refund receipt failed',error);return res.status(500).json({error:'Unable to generate supplier refund receipt.'});}
});
app.get('/api/ledger/supplier-refunds/:returnId',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);if(!scope)return res.status(403).json({error:'Supplier refund access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{
 const h=await pool.query('SELECT id FROM ars_gl_purchase_returns WHERE shop_id=$1 AND id=$2',[scope.shopId,req.params.returnId]);
 if(!h.rowCount)return res.status(404).json({error:'Purchase return not found.'});
 const history=await pool.query(`SELECT f.id,f.amount::text,f.refund_date::text,f.evidence,f.recorded_by,f.journal_id,f.account_id,a.name AS account_name FROM ars_gl_supplier_refunds f LEFT JOIN ars_financial_accounts a ON a.shop_id=f.shop_id AND a.id=f.account_id WHERE f.shop_id=$1 AND f.return_id=$2 ORDER BY f.refund_date DESC,f.id LIMIT 500`,[scope.shopId,req.params.returnId]);
 return res.json(history.rows);
 }catch(error){console.error('Supplier refund history failed',error);return res.status(500).json({error:'Unable to load supplier refunds.'});}
});
function ledgerApiError(res:express.Response,error:unknown){
 const message=error instanceof Error?error.message:'';
 if(['Valid account code, name, classification and status required.','Account code already exists.','Account not found in this shop.','Account classification is immutable; create a new account.','Shop and account code required.'].includes(message))return res.status(409).json({error:message});
 console.error('Chart of accounts operation failed',error);return res.status(500).json({error:'Unable to complete accounting account operation.'});
}
app.get('/api/ledger/supplier-orders/:id/reconciliation',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await supplierReconciliation(pool,scope.shopId,req.params.id));}
 catch(error){const message=error instanceof Error?error.message:'';
 if(message==='Valid purchase order required.')return res.status(400).json({error:message});
 if(message==='Purchase order not found.')return res.status(404).json({error:message});
 console.error('Supplier reconciliation failed',error);return res.status(500).json({error:'Unable to load supplier reconciliation.'});}
});
app.get('/api/ledger/statements',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 const asOf=typeof req.query.asOf==='string'?req.query.asOf:'';
 try{return res.json(await ledgerStatements(pool,scope.shopId,asOf));}
 catch(error){if(error instanceof Error&&error.message==='Valid shop and reporting date required.')return res.status(400).json({error:error.message});console.error('Ledger statements failed',error);return res.status(500).json({error:'Unable to load provisional ledger statements.'});}
});
app.get('/api/ledger/activity',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 const from=typeof req.query.from==='string'?req.query.from:'',to=typeof req.query.to==='string'?req.query.to:'';
 const offset=req.query.offset===undefined?0:typeof req.query.offset==='string'&&/^\d{1,6}$/.test(req.query.offset)?Number(req.query.offset):NaN;
 try{const rows=await ledgerActivity(pool,scope.shopId,from,to,offset);return res.json({rows,offset,nextOffset:rows.length===50&&offset<100000?offset+50:null,complete:false,operationallyReconciled:false,note:'Ledger activity only; not proof of operational completeness.'});}
 catch(error){if(error instanceof Error&&error.message==='Valid reporting range and page required.')return res.status(400).json({error:error.message});console.error('Ledger activity failed',error);return res.status(500).json({error:'Unable to load ledger activity.'});}
});
app.get('/api/ledger/opening-proposals',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await listOpeningProposals(pool,scope.shopId));}
 catch(error){console.error('Opening proposals failed',error);return res.status(500).json({error:'Unable to load opening proposals.'});}
});
app.post('/api/ledger/opening-proposals',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const {id,cutoverDate,evidence,lines}=req.body||{};
 try{const result=await submitOpeningProposal(pool,scope.shopId,scope.recordedBy,{id,cutoverDate,evidence,lines});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';
 if(['Valid cutover date and supporting evidence required.','A journal needs between 2 and 500 lines.','Invalid ledger account code.','Use a non-negative decimal amount with at most two decimal places.','Each line must have exactly one positive debit or credit.','Journal debits and credits must balance.','Use one opening balance line per account.','Opening proposal identifier already used.','Accounting already active; opening proposal not permitted.','Opening balances require active asset, liability or equity accounts in this shop.'].includes(message))return res.status(409).json({error:message});
 console.error('Opening proposal submission failed',error);return res.status(500).json({error:'Unable to confirm opening proposal. Retry the identical proposal.'});}
});
app.get('/api/ledger/opening-proposals/:id/readiness',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await cutoverReadiness(pool,scope.shopId,req.params.id));}
 catch(error){const message=error instanceof Error?error.message:'';
 if(message==='Valid opening proposal required.')return res.status(400).json({error:message});
 if(message==='Opening proposal not found in this shop.')return res.status(404).json({error:message});
 if(message==='Opening proposal integrity check failed.')return res.status(409).json({error:message});
 console.error('Cutover readiness failed',error);return res.status(500).json({error:'Unable to verify cutover readiness. Accounting activation is unavailable.'});}
});
app.get('/api/ledger/opening-proposals/:id/reconciliation',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await openingReconciliation(pool,scope.shopId,req.params.id));}
 catch(error){const message=error instanceof Error?error.message:'';
 if(message==='Valid opening proposal required.')return res.status(400).json({error:message});
 if(message==='Opening proposal not found in this shop.')return res.status(404).json({error:message});
 if(message==='Opening proposal integrity check failed.')return res.status(409).json({error:message});
 console.error('Opening reconciliation failed',error);return res.status(500).json({error:'Unable to compare opening balances.'});}
});
app.get('/api/ledger/opening-proposals/:id/documents',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await listDocumentaryReviews(pool,scope.shopId,req.params.id));}
 catch(error){if(error instanceof Error&&error.message==='Valid opening proposal required.')return res.status(400).json({error:error.message});
 console.error('Documentary history failed',error);return res.status(500).json({error:'Unable to load documentary review history.'});}
});
app.post('/api/ledger/opening-proposals/:id/documents',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const {id,snapshotHash,evidence}=req.body||{};
 try{const result=await submitDocumentaryReview(pool,scope.shopId,scope.recordedBy,{id,proposalId:req.params.id,snapshotHash,evidence});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';
 if(['Valid documentary review required.','Document reference and explanation required for each reconciliation row.','Duplicate documentary evidence row.','Documentary review identifier already used.','Reconciliation snapshot changed. Refresh and review the new balances.','Evidence must cover every reconciliation row exactly once.','Opening proposal not found in this shop.','An independent administrator must record documentary review.','Rejected proposal cannot receive a new documentary review.','Accounting already active.','Opening proposal integrity check failed.'].includes(message))return res.status(409).json({error:message});
 console.error('Documentary review failed',error);return res.status(500).json({error:'Unable to confirm documentary review. Retry identical details.'});}
});
app.post('/api/ledger/opening-proposals/:id/review',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const {decision,evidence}=req.body||{};
 try{return res.json(await reviewOpeningProposal(pool,scope.shopId,scope.recordedBy,{id:req.params.id,decision,evidence}));}
 catch(error){const message=error instanceof Error?error.message:'';
 if(['Valid proposal decision and review evidence required.','Opening proposal not found in this shop.','Proposal review already recorded.','An independent administrator must review the opening proposal.','Opening proposal integrity check failed.','Opening accounts changed; submit a corrected proposal.','Accounting already active.','An approved opening proposal already exists; audited supersession is required.'].includes(message))return res.status(409).json({error:message});
 console.error('Opening review failed',error);return res.status(500).json({error:'Unable to confirm review. Retry identical details.'});}
});
app.get('/api/ledger/mappings',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await listLedgerMappings(pool,scope.shopId));}
 catch(error){console.error('Ledger mappings failed',error);return res.status(500).json({error:'Unable to load mappings.'});}
});
app.get('/api/ledger/partner-mapping-sources',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json((await pool.query('SELECT id,name FROM ars_business_partners WHERE shop_id=$1 AND is_active ORDER BY name,id',[scope.shopId])).rows);}
 catch(error){console.error('Partner mapping sources failed',error);return res.status(500).json({error:'Unable to load partner mapping sources.'});}
});
app.post('/api/ledger/mappings',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const {kind,sourceId,accountCode,evidence}=req.body||{};
 try{const result=await createLedgerMapping(pool,scope.shopId,scope.recordedBy,{kind,sourceId,accountCode,evidence});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';
 if(['Valid account mapping and evidence required.','Control mappings require the control source identifier.','Mapping already exists; audited correction required.','Active accounting requires an audited mapping amendment.','Active cash, bank or representative account required.','Active ledger account with matching classification required.','Use a distinct ledger account for each mapping.','Active partner required in this shop.'].includes(message))return res.status(409).json({error:message});
 console.error('Ledger mapping failed',error);return res.status(500).json({error:'Unable to confirm mapping. Retry identical details.'});}
});
app.get('/api/ledger/accounts',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await listLedgerAccounts(pool,scope.shopId));}catch(error){return ledgerApiError(res,error);}
});
app.get('/api/ledger/accounts/:code/audit',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 try{return res.json(await ledgerAccountAudit(pool,scope.shopId,req.params.code));}catch(error){return ledgerApiError(res,error);}
});
app.post('/api/ledger/accounts/defaults',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 if(req.body?.confirm!==true)return res.status(400).json({error:'Explicit default account setup confirmation required.'});
 try{return res.json(await seedWholesaleAccounts(pool,scope.shopId,scope.recordedBy));}catch(error){return ledgerApiError(res,error);}
});
app.post('/api/ledger/accounts',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const {code,name,kind,active}=req.body||{};
 try{return res.status(201).json(await createLedgerAccount(pool,scope.shopId,scope.recordedBy,{code,name,kind,active}));}catch(error){return ledgerApiError(res,error);}
});
app.put('/api/ledger/accounts/:code',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const {name,kind,active}=req.body||{};
 try{return res.json(await updateLedgerAccount(pool,scope.shopId,scope.recordedBy,{code:req.params.code,name,kind,active}));}catch(error){return ledgerApiError(res,error);}
});
app.get('/api/position-registers',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting register access denied.'});
 try{const rows=await listPositionRegisters(pool,scope.shopId);res.setHeader('Cache-Control','no-store');return res.json(rows);}
 catch(error){console.error('Position registers failed',error);return res.status(500).json({error:'Unable to load accounting registers.'});}
});
app.post('/api/position-registers',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting register access denied.'});
 const {requestId,reference,kind,label,amount,effectiveDate,evidence}=req.body||{};
 if(!validChequeRequestId(requestId)||typeof reference!=='string'||typeof kind!=='string'||!positionKinds.includes(kind as PositionKind)||typeof label!=='string'||typeof amount!=='number'||typeof effectiveDate!=='string'||typeof evidence!=='string')return res.status(400).json({error:'Valid evidenced carrying balance required.'});
 try{const result=await recordPositionBalance(pool,{id:requestId,shopId:scope.shopId,reference,kind:kind as PositionKind,label,amount,effectiveDate,evidence,recordedBy:scope.recordedBy});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(['Valid evidenced carrying balance required.','Position request identifier already used.','Future carrying balances are not allowed.','A balance already exists for this reference and date. Audited correction required.'].includes(message))return res.status(409).json({error:message});console.error('Position balance registration failed',error);return res.status(500).json({error:'Unable to confirm balance. Retry the same details.'});}
});
app.get('/api/financial-position',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Financial position access denied.'});
 try{const data=await financialPosition(pool,scope.shopId);res.setHeader('Cache-Control','no-store');return res.json(data);}
 catch(error){console.error('Financial position failed',error);return res.status(500).json({error:'Unable to load financial position.'});}
});
app.get('/api/supplier-payable-aging',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Supplier payable access denied.'});
 try{const data=await supplierPayableAging(pool,scope.shopId);res.setHeader('Cache-Control','no-store');return res.json(data);}
 catch(error){console.error('Supplier payable aging failed',error);return res.status(500).json({error:'Unable to load supplier payable aging.'});}
});
app.post('/api/supplier-payable-aging/:purchaseOrderId/due-date',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Supplier due date access denied.'});
 const {dueDate,evidence}=req.body||{};
 if(typeof dueDate!=='string'||typeof evidence!=='string'||!evidence.trim()||evidence.length>500)return res.status(400).json({error:'Valid supplier due date and evidence required.'});
 try{const result=await registerSupplierDueDate(pool,{shopId:scope.shopId,purchaseOrderId:req.params.purchaseOrderId,dueDate,evidence,recordedBy:scope.recordedBy});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(['Valid supplier due date and evidence required.','Purchase order not found in this shop.','Supplier due date already registered. An audited amendment is required.','Only received purchase orders can receive verified payable terms.','Due date cannot precede the purchase order date.'].includes(message))return res.status(409).json({error:message});console.error('Supplier due date registration failed',error);return res.status(500).json({error:'Unable to confirm supplier due date. Retry the same details.'});}
});
app.get('/api/receivable-aging',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Receivable aging access denied.'});
 try{const data=await receivableAging(pool,scope.shopId);res.setHeader('Cache-Control','no-store');return res.json(data);}
 catch(error){console.error('Receivable aging failed',error);return res.status(500).json({error:'Unable to load receivable aging.'});}
});
app.post('/api/receivable-aging/:invoiceId/due-date',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Invoice due date access denied.'});
 const {dueDate,evidence}=req.body||{};
 if(typeof dueDate!=='string'||typeof evidence!=='string'||!evidence.trim()||evidence.length>500)return res.status(400).json({error:'Valid due date and supporting evidence required.'});
 try{const result=await registerInvoiceDueDate(pool,{shopId:scope.shopId,invoiceId:req.params.invoiceId,dueDate,evidence,recordedBy:scope.recordedBy});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(['Valid due date and supporting evidence required.','Credit invoice not found in this shop.','Due date already registered. An audited amendment is required.','Only completed credit invoices can receive due dates.','Due date cannot precede the invoice date.','Customer not found in this shop.'].includes(message))return res.status(409).json({error:message});console.error('Invoice due date registration failed',error);return res.status(500).json({error:'Unable to confirm due date. Retry the same details.'});}
});
app.get('/api/inventory-valuation',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Inventory valuation access denied.'});
 try{const data=await inventoryValuation(pool,scope.shopId);res.setHeader('Cache-Control','no-store');return res.json(data);}
 catch(error){console.error('Inventory valuation failed',error);return res.status(500).json({error:'Unable to load inventory valuation.'});}
});
app.get('/api/inventory-valuation/:productId/history',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Inventory costing history access denied.'});
 const offset=Number(req.query.offset||0);
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)return res.status(400).json({error:'Invalid history page.'});
 try{const data=await inventoryCostHistory(pool,scope.shopId,req.params.productId,offset);res.setHeader('Cache-Control','no-store');return res.json(data);}
 catch(error){console.error('Inventory costing history failed',error);return res.status(500).json({error:'Unable to load inventory costing history.'});}
});
app.get('/api/financial-profit-report',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Profit report access denied.'});
 const {fromDate,toDate}=req.query;
 if(typeof fromDate!=='string'||typeof toDate!=='string'||toDate>reportDay(new Date()))return res.status(400).json({error:'Select a valid historical period.'});
 try{const result=await financialProfitReport(pool,scope.shopId,fromDate,toDate);res.setHeader('Cache-Control','no-store');return res.json(result);}
 catch(error){if(error instanceof Error&&error.message==='Invalid profit report period.')return res.status(400).json({error:error.message});console.error('Profit report failed',error);return res.status(500).json({error:'Unable to load profit report.'});}
});
app.get('/api/financial-cash-flow',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Cash flow access denied.'});
 const {fromDate,toDate}=req.query;
 if(typeof fromDate!=='string'||typeof toDate!=='string'||toDate>reportDay(new Date()))return res.status(400).json({error:'Select a valid historical business period.'});
 try{const result=await financialCashFlow(pool,scope.shopId,fromDate,toDate);res.setHeader('Cache-Control','no-store');return res.json(result);}
 catch(error){if(error instanceof Error&&error.message==='Invalid cash flow period.')return res.status(400).json({error:error.message});console.error('Cash flow failed',error);return res.status(500).json({error:'Unable to load cash flow.'});}
});
app.get('/api/financial-accounts',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  const {activeShopId}=getActiveShopContext(db,req);
  try{res.json(await listFinancialAccounts(pool,activeShopId));}
  catch(error){console.error('Financial account read failed',error);res.status(500).json({error:'Unable to load financial accounts.'});}
});
app.post('/api/financial-accounts',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  const authUser=(req as AppRequest).authUser;
  const {name,kind}=req.body||{};
  if(typeof name!=='string'||!name.trim()||name.trim().length>120||!['Office Cash','Bank','Representative Cash','Settlement'].includes(kind))return res.status(400).json({error:'Enter a valid account name and type.'});
  const client=await pool.connect();
  const id='fund-'+randomUUID();
  try{
    await client.query('BEGIN');
    await createFinancialAccount(client,{id,shopId:activeShopId,name,kind:kind as FinancialAccountKind,recordedBy:authUser?.name||'Manager'});
    await client.query("INSERT INTO activity_logs(id,shop_id,date,user_name,role,action,details) VALUES($1,$2,NOW(),$3,$4,'Financial Account Created',$5)",['act-'+randomUUID(),activeShopId,authUser?.name||'Manager',authUser?.role||'Store Manager',name.trim()+' ('+kind+')']);
    await client.query('COMMIT');
    res.status(201).json({id,name:name.trim(),kind,active:true,balance:0});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Financial account creation failed',error);res.status(409).json({error:'Unable to create account. Check whether that account name already exists.'});}
  finally{client.release();}
});


app.post('/api/financial-accounts/:id/opening-balance',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const auth=(req as AppRequest).authUser;
  const {activeShopId}=getActiveShopContext(db,req);
  const requested=getRequestedShopId(req);
  if(!auth||!db.settings.shopProfiles?.some(s=>s.id===activeShopId)||
    (requested&&requested!==activeShopId)||
    (auth.scopedShopId&&auth.scopedShopId!==activeShopId)||
    (auth.fixedShopId&&auth.fixedShopId!==activeShopId)||
    (Array.isArray(auth.allowedShopIds)&&!auth.allowedShopIds.includes(activeShopId))){
    return res.status(403).json({error:'Financial account shop access denied.'});
  }
  const {amount,effectiveDate,note}=req.body||{};
  if(typeof amount!=='number'||!Number.isFinite(amount)||amount===0||
    Math.abs(amount)>999999999999.99||Math.abs(amount*100-Math.round(amount*100))>0.001||
    typeof effectiveDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||
    (note!==undefined&&(typeof note!=='string'||note.length>500))){
    return res.status(400).json({error:'Enter a valid nonzero amount, effective date and optional note.'});
  }
  const date=new Date(effectiveDate+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==effectiveDate||effectiveDate>reportDay(new Date())){
    return res.status(400).json({error:'Opening balance date must be valid and not in the future.'});
  }
  const id='fund-movement-'+randomUUID();
  try{
    await registerFinancialOpeningBalance(pool,{id,shopId:activeShopId,accountId:String(req.params.id),amount,effectiveDate,recordedBy:auth.email,note});
    return res.status(201).json({id,accountId:req.params.id,amount,effectiveDate});
  }catch(error){
    if(error instanceof Error&&error.message==='Active financial account not found.')return res.status(404).json({error:error.message});
    if(error instanceof Error&&error.message==='Opening balance requires an account with no recorded movements.')return res.status(409).json({error:error.message});
    console.error('Opening balance registration failed',error);
    return res.status(500).json({error:'Unable to register opening balance. Check the account before retrying.'});
  }
});


app.post('/api/financial-transfers',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const auth=(req as AppRequest).authUser;
  const {activeShopId}=getActiveShopContext(db,req);
  const requested=getRequestedShopId(req);
  if(!auth||!db.settings.shopProfiles?.some(s=>s.id===activeShopId)||
    (requested&&requested!==activeShopId)||
    (auth.scopedShopId&&auth.scopedShopId!==activeShopId)||
    (auth.fixedShopId&&auth.fixedShopId!==activeShopId)||
    (Array.isArray(auth.allowedShopIds)&&!auth.allowedShopIds.includes(activeShopId))){
    return res.status(403).json({error:'Financial account shop access denied.'});
  }
  const {requestId,fromAccountId,toAccountId,amount,effectiveDate,note,handover}=req.body||{};
  if(typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)||
    typeof fromAccountId!=='string'||!fromAccountId||fromAccountId.length>200||
    typeof toAccountId!=='string'||!toAccountId||toAccountId.length>200||fromAccountId===toAccountId||
    typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||amount>999999999999.99||
    Math.abs(amount*100-Math.round(amount*100))>0.001||
    typeof effectiveDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||
    (handover!==undefined&&typeof handover!=='boolean')||
    (handover&&(typeof note!=='string'||!note.trim()||note.trim().length>460))||
    (note!==undefined&&(typeof note!=='string'||note.length>500))){
    return res.status(400).json({error:'Enter two different accounts, a positive amount, a request ID and a valid transfer date.'});
  }
  try{
    const result=await recordFinancialTransfer(pool,{requestId,shopId:activeShopId,fromAccountId,toAccountId,amount,effectiveDate,recordedBy:auth.email,note,handover,currentBusinessDate:reportDay(new Date())});
    return res.status(result.replayed?200:201).json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Select two active financial accounts in this shop.','Settlement accounts are not supported for fund transfers.','Insufficient recorded funds in source account.','Transfer request identifier already used for different details.','Invalid financial transfer details.','Only previously committed transfers can be retried for earlier dates.','Handover requires a representative cash account and an office cash account.'].includes(message))return res.status(409).json({error:message});
    console.error('Financial transfer failed',error);
    return res.status(500).json({error:'Unable to confirm transfer. Reconcile or retry the same request identifier.'});
  }
});


const chequeShopAccess=(req:express.Request)=>{
  const auth=(req as AppRequest).authUser;
  const {activeShopId}=getActiveShopContext(db,req);
  const requested=getRequestedShopId(req);
  if(!auth||!db.settings.shopProfiles?.some(s=>s.id===activeShopId)||
    (requested&&requested!==activeShopId)||(auth.scopedShopId&&auth.scopedShopId!==activeShopId)||
    (auth.fixedShopId&&auth.fixedShopId!==activeShopId)||
    (Array.isArray(auth.allowedShopIds)&&!auth.allowedShopIds.includes(activeShopId)))return null;
  return {shopId:activeShopId,recordedBy:auth.email};
};
const validChequeRequestId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
app.get('/api/supplier-cheques',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Cheque shop access denied.'});
  res.setHeader('Cache-Control','no-store');
  try{return res.json(await listSupplierCheques(pool,scope.shopId));}
  catch(error){console.error('Supplier cheque register read failed',error);return res.status(500).json({error:'Unable to load supplier cheque register.'});}
});
app.get('/api/supplier-cheques/requests/:requestId',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Cheque shop access denied.'});
  const requestId=req.params.requestId;
  if(!validChequeRequestId(requestId))return res.status(400).json({error:'Invalid request identifier.'});
  res.setHeader('Cache-Control','no-store');
  try{
    const result=await pool.query(`SELECT e.id AS "eventId",e.cheque_id AS "chequeId",e.next_status AS "operation",e.effective_date::text AS "effectiveDate",e.note,c.status,c.payment_id AS "paymentId",c.supplier_id AS "supplierId",c.purchase_order_id AS "purchaseOrderId",c.bank_account_id AS "bankAccountId",c.cheque_number AS "chequeNumber",c.amount::text AS amount,c.issued_date::text AS "issuedDate",c.due_date::text AS "dueDate"
      FROM ars_supplier_cheque_events e JOIN ars_supplier_cheques c ON c.shop_id=e.shop_id AND c.id=e.cheque_id
      WHERE e.shop_id=$1 AND e.recorded_by=$2 AND e.id=ANY($3::text[])`,[scope.shopId,scope.recordedBy,['supplier-cheque-'+requestId+'-issued','supplier-cheque-event-'+requestId]]);
    if(result.rowCount===0)return res.json({found:false});
    if(result.rowCount!==1)return res.status(409).json({error:'Request identifier matches multiple events. Manager review required.'});
    return res.json({found:true,...result.rows[0]});
  }catch(error){console.error('Supplier cheque request lookup failed',error);return res.status(500).json({error:'Unable to verify supplier cheque request.'});}
});
app.get('/api/supplier-cheques/:id/history',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Cheque shop access denied.'});
  const chequeId=String(req.params.id);
  if(!chequeId.trim()||chequeId.length>200)return res.status(400).json({error:'Invalid cheque identifier.'});
  res.setHeader('Cache-Control','no-store');
  try{
    const result=await pool.query(`SELECT c.id,c.status,c.payment_id AS "paymentId",
      COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'previousStatus',e.previous_status,'nextStatus',e.next_status,'effectiveDate',e.effective_date::text,'recordedBy',e.recorded_by,'recordedAt',e.recorded_at,'note',e.note) ORDER BY e.recorded_at,e.id) FILTER (WHERE e.id IS NOT NULL),'[]'::jsonb) AS events
      FROM ars_supplier_cheques c LEFT JOIN ars_supplier_cheque_events e ON e.shop_id=c.shop_id AND e.cheque_id=c.id
      WHERE c.shop_id=$1 AND c.id=$2 GROUP BY c.id,c.status,c.payment_id`,[scope.shopId,chequeId]);
    if(!result.rowCount)return res.status(404).json({error:'Supplier cheque not found in this shop.'});
    return res.json(result.rows[0]);
  }catch(error){console.error('Supplier cheque history read failed',error);return res.status(500).json({error:'Unable to load supplier cheque history.'});}
});
app.post('/api/supplier-cheques',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Cheque shop access denied.'});
  const {requestId,supplierId,purchaseOrderId,bankAccountId,chequeNumber,amount,issuedDate,dueDate,note}=req.body||{};
  const validId=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
  if(!validChequeRequestId(requestId)||!validId(supplierId)||!validId(bankAccountId)||
    (purchaseOrderId!==undefined&&!validId(purchaseOrderId))||
    typeof chequeNumber!=='string'||chequeNumber.length>80||typeof amount!=='number'||
    typeof issuedDate!=='string'||issuedDate>reportDay(new Date())||typeof dueDate!=='string'||
    (note!==undefined&&(typeof note!=='string'||note.length>500)))return res.status(400).json({error:'Enter valid supplier cheque details.'});
  try{
    const result=await registerSupplierCheque(pool,{...scope,id:'supplier-cheque-'+requestId,supplierId,purchaseOrderId,bankAccountId,chequeNumber,amount,issuedDate,dueDate,note});
    return res.status(result.replayed?200:201).json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Invalid supplier cheque details.','Supplier cheque request identifier already used for different details.','Select a non-cancelled purchase order belonging to this supplier.','Supplier not found in this shop.','Select an active bank account in this shop.','Supplier cheque number already registered for this bank account.'].includes(message))return res.status(409).json({error:message});
    console.error('Supplier cheque registration failed',error);return res.status(500).json({error:'Unable to confirm supplier cheque registration. Retry the same request identifier.'});
  }
});
app.post('/api/supplier-cheques/:id/status',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Cheque shop access denied.'});
  const {requestId,nextStatus,effectiveDate,note}=req.body||{};
  const chequeId=String(req.params.id);
  if(!validChequeRequestId(requestId)||!chequeId.trim()||chequeId.length>200||
    !['Cancelled','Dishonoured'].includes(nextStatus)||typeof effectiveDate!=='string'||
    !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||effectiveDate>reportDay(new Date())||
    typeof note!=='string'||!note.trim()||note.length>500)return res.status(400).json({error:'Enter a valid cancellation or dishonour date and reason. Clearance requires a separate payment workflow.'});
  try{
    const result=await transitionSupplierCheque(pool,{...scope,chequeId,eventId:'supplier-cheque-event-'+requestId,nextStatus,effectiveDate,note});
    return res.status(result.replayed?200:201).json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(message==='Supplier cheque not found in this shop.')return res.status(404).json({error:message});
    if(['Invalid supplier cheque transition details.','Supplier cheque event identifier already used for different details.','Only issued supplier cheques can be cancelled or dishonoured.','Supplier cheque event date precedes its history.'].includes(message))return res.status(409).json({error:message});
    console.error('Supplier cheque status update failed',error);return res.status(500).json({error:'Unable to confirm supplier cheque status. Retry the same request identifier.'});
  }
});
app.post('/api/supplier-cheques/:id/clear',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Cheque shop access denied.'});
  const {requestId,effectiveDate,evidence}=req.body||{};
  const chequeId=String(req.params.id);
  if(!validChequeRequestId(requestId)||!chequeId.trim()||chequeId.length>200||
    typeof effectiveDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||
    !Number.isFinite(Date.parse(effectiveDate+'T00:00:00Z'))||new Date(effectiveDate+'T00:00:00Z').toISOString().slice(0,10)!==effectiveDate||
    effectiveDate>reportDay(new Date())||typeof evidence!=='string'||!evidence.trim()||evidence.trim().length>500)
    return res.status(400).json({error:'Enter a valid clearance date and bank evidence reference.'});
  try{
    const c=(await pool.query("SELECT c.*,COALESCE(NULLIF(s.company_name,''),s.name) AS supplier_name FROM ars_supplier_cheques c JOIN suppliers s ON s.shop_id=c.shop_id AND s.id=c.supplier_id WHERE c.shop_id=$1 AND c.id=$2",[scope.shopId,chequeId])).rows[0];
    if(!c)return res.status(404).json({error:'Supplier cheque not found in this shop.'});
    if(!c.purchase_order_id)return res.status(409).json({error:'A linked purchase order is required for supplier cheque clearance.'});
    const payment:SupplierPayment={id:'spay-cheque-'+chequeId,shopId:scope.shopId,supplierId:c.supplier_id,supplierName:c.supplier_name,purchaseOrderId:c.purchase_order_id,amount:Number(c.amount),paymentMethod:'Cheque',date:effectiveDate,note:'Supplier cheque '+c.cheque_number,createdBy:scope.recordedBy};
    await insertSupplierPayment(payment,c.bank_account_id,{chequeId,eventId:'supplier-cheque-event-'+requestId,evidence:evidence.trim()});
    try{const fresh=await loadStateFromNormalized();if(!fresh)throw Error('Unable to reload cleared supplier payment.');db=fresh;}
    catch(error){databaseWriteHealthy=false;console.error('Supplier cheque clearance committed but reload failed; writes disabled.',error);}
    return res.json({id:chequeId,status:'Cleared',paymentId:payment.id});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Invalid supplier cheque clearance details.','Supplier cheque clearance details do not match the issued cheque.','Supplier cheque already cleared; review original payment.','Only issued supplier cheques can be cleared.','Enable verified accounting before supplier cheque clearance.','Supplier payment request identifier already used for different details.','Supplier not found in this shop.','Purchase order does not belong to this supplier and shop.','Supplier payment exceeds the remaining purchase order balance.','Select an active supplier payment account matching the payment method.','Insufficient recorded funds for supplier payment.','Verified linked supplier order required.','Payment exceeds verified received-order payable.','Supplier cheque clearance state changed.'].includes(message))return res.status(409).json({error:message});
    console.error('Supplier cheque clearance failed',error);return res.status(500).json({error:'Unable to confirm supplier cheque clearance. Review the register or retry the same request.'});
  }
});
app.get('/api/customer-cheques',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Cheque shop access denied.'});
  try{res.setHeader('Cache-Control','no-store');return res.json(await listCustomerCheques(pool,scope.shopId));}
  catch(error){console.error('Cheque register read failed',error);return res.status(500).json({error:'Unable to load cheque register.'});}
});
app.post('/api/customer-cheques',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Cheque shop access denied.'});
  const {requestId,customerId,invoiceId,chequeNumber,issuingBank,drawerName,amount,receivedDate,dueDate,note}=req.body||{};
  if(!validChequeRequestId(requestId)||typeof customerId!=='string'||!customerId.trim()||customerId.length>200||
    (invoiceId!==undefined&&(typeof invoiceId!=='string'||!invoiceId.trim()||invoiceId.length>200))||
    typeof chequeNumber!=='string'||typeof issuingBank!=='string'||typeof drawerName!=='string'||typeof amount!=='number'||
    typeof receivedDate!=='string'||receivedDate>reportDay(new Date())||typeof dueDate!=='string'||
    (note!==undefined&&typeof note!=='string'))return res.status(400).json({error:'Enter valid cheque details.'});
  try{
    const result=await registerCustomerCheque(pool,{...scope,id:'cheque-'+requestId,customerId,invoiceId,chequeNumber,issuingBank,drawerName,amount,receivedDate,dueDate,note});
    return res.status(result.replayed?200:201).json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Invalid cheque details.','Cheque request identifier already used for different details.','Select a valid customer credit invoice.','Cheque exceeds invoice outstanding balance.','Cheque exceeds customer outstanding balance or customer is unavailable.','Pending cheques plus this cheque exceed customer outstanding balance.','Pending cheques plus this cheque exceed invoice outstanding balance.','Cheque already registered for this customer.'].includes(message))return res.status(409).json({error:message});
    console.error('Cheque registration failed',error);return res.status(500).json({error:'Unable to confirm cheque registration. Retry the same request identifier.'});
  }
});
app.post('/api/customer-cheques/:id/status',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Cheque shop access denied.'});
  const {requestId,nextStatus,effectiveDate,depositAccountId,note}=req.body||{};
  if(!validChequeRequestId(requestId)||!['Deposited','Bounced','Cancelled','Returned'].includes(nextStatus)||
    typeof effectiveDate!=='string'||effectiveDate>reportDay(new Date())||
    (depositAccountId!==undefined&&(typeof depositAccountId!=='string'||depositAccountId.length>200))||
    (note!==undefined&&typeof note!=='string'))return res.status(400).json({error:'Enter valid cheque transition details. Use the separate bank clearance action to confirm payment.'});
  try{
    const result=await transitionCustomerCheque(pool,{...scope,chequeId:String(req.params.id),eventId:'cheque-event-'+requestId,nextStatus,effectiveDate,depositAccountId,note});
    return res.status(result.replayed?200:201).json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Invalid cheque transition details.','Cheque not found in this shop.','Cheque event identifier already used for different details.','Invalid cheque status transition.','Cheque event date precedes its history.','Post-dated cheque cannot be deposited before its due date.','Select an active bank account in this shop.'].includes(message))return res.status(409).json({error:message});
    console.error('Cheque transition failed',error);return res.status(500).json({error:'Unable to confirm cheque status. Retry the same request identifier.'});
  }
});


app.post('/api/customer-cheques/:id/clear',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Cheque shop access denied.'});
  const {requestId,effectiveDate}=req.body||{};
  if(!validChequeRequestId(requestId)||typeof effectiveDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||
    !Number.isFinite(Date.parse(effectiveDate+'T00:00:00Z'))||new Date(effectiveDate+'T00:00:00Z').toISOString().slice(0,10)!==effectiveDate||effectiveDate>reportDay(new Date())){
    return res.status(400).json({error:'Enter a valid clearance date and request identifier.'});
  }
  try{
    const result=await pool.query("SELECT c.*,u.name AS customer_name FROM ars_customer_cheques c JOIN customers u ON u.id=c.customer_id AND u.shop_id=c.shop_id WHERE c.shop_id=$1 AND c.id=$2",[scope.shopId,String(req.params.id)]);
    const cheque=result.rows[0];
    if(!cheque)return res.status(404).json({error:'Cheque not found in this shop.'});
    if(!['Deposited','Cleared'].includes(cheque.status)||!cheque.deposit_account_id)return res.status(409).json({error:'Only deposited cheques can be cleared.'});
    const payment:CustomerCreditPayment={
      id:'cpay-cheque-'+cheque.id,shopId:scope.shopId,customerId:cheque.customer_id,customerName:cheque.customer_name,
      invoiceId:cheque.invoice_id||undefined,amount:Number(cheque.amount),date:effectiveDate,paymentMethod:'Cheque',
      note:'Cheque '+cheque.cheque_number+' / '+cheque.issuing_bank,createdBy:scope.recordedBy
    };
    payment.receiptSnapshot=await addCustomerCreditPayment(payment,true,cheque.deposit_account_id,{chequeId:cheque.id,eventId:'cheque-event-'+requestId,recordedBy:scope.recordedBy});
    try{
      const fresh=await loadStateFromNormalized();
      if(!fresh)throw Error('Unable to reload cleared cheque payment.');
      db=fresh;
    }catch(error){
      databaseWriteHealthy=false;
      console.error('Cheque clearance committed but reload failed; writes disabled.',error);
    }
    return res.json({id:cheque.id,status:'Cleared',payment});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Cheque clearance details do not match the registered cheque.','Cheque already cleared. Review the original payment.','Only deposited cheques can be cleared.','Clearance date precedes cheque history.','Payment request ID already used for different details.','Payment request ID already used for a different financial destination.','Select an outstanding credit invoice belonging to this customer.','Customer not found in this shop.','Customer has no outstanding credit balance.','Payment exceeds the customer outstanding credit balance.','Historical unallocated payments require reconciliation before invoice-specific collection.','Payment exceeds the invoice outstanding balance.','Select an invoice for this customer payment.','Select an active financial account matching the payment method.','Cheque clearance state changed.'].includes(message))return res.status(409).json({error:message});
    console.error('Cheque clearance failed',error);
    return res.status(500).json({error:'Unable to confirm cheque clearance. Review the register or retry the same request.'});
  }
});


app.get('/api/financial-reconciliations',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Financial shop access denied.'});
  try{res.setHeader('Cache-Control','no-store');return res.json(await listFinancialReconciliations(pool,scope.shopId));}
  catch(error){console.error('Financial reconciliation read failed',error);return res.status(500).json({error:'Unable to load reconciliation history.'});}
});
app.post('/api/financial-reconciliations',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Financial shop access denied.'});
  const {requestId,accountId,effectiveDate,observedAmount,reference,note}=req.body||{};
  if(!validChequeRequestId(requestId)||typeof accountId!=='string'||!accountId.trim()||accountId.length>200||
    typeof effectiveDate!=='string'||typeof observedAmount!=='number'||typeof reference!=='string'||
    (note!==undefined&&typeof note!=='string'))return res.status(400).json({error:'Enter valid reconciliation details.'});
  try{
    const result=await recordFinancialReconciliation(pool,{...scope,id:'reconcile-'+requestId,accountId,effectiveDate,observedAmount,reference,note,currentBusinessDate:reportDay(new Date())});
    return res.status(result.replayed?200:201).json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(['Invalid reconciliation details.','Reconciliation request identifier already used for different details.','New reconciliations must use the current business date.','Select an active cash or bank account in this shop.','Counted cash cannot be negative.','Explain the discrepancy before saving.'].includes(message))return res.status(409).json({error:message});
    console.error('Financial reconciliation failed',error);return res.status(500).json({error:'Unable to confirm reconciliation. Retry the same request identifier.'});
  }
});


app.get('/api/financial-accounts/:id/statement',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Financial shop access denied.'});
  const {fromDate,toDate,offset='0',limit='100'}=req.query;
  if(typeof fromDate!=='string'||typeof toDate!=='string'||typeof offset!=='string'||typeof limit!=='string'||!/^\d+$/.test(offset)||!/^\d+$/.test(limit))return res.status(400).json({error:'Invalid financial statement filters.'});
  try{
    const result=await listFinancialMovements(pool,{shopId:scope.shopId,accountId:String(req.params.id),fromDate,toDate,offset:Number(offset),limit:Number(limit)});
    res.setHeader('Cache-Control','no-store');return res.json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(message==='Invalid financial statement filters.')return res.status(400).json({error:message});
    if(message==='Financial account not found in this shop.')return res.status(404).json({error:message});
    console.error('Financial statement read failed',error);return res.status(500).json({error:'Unable to load account statement.'});
  }
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
    const unit=product.sharedStockUnits?.units.find(u=>u.id===raw.sellingUnitId);
    if (product.sharedStockUnits || raw.sellingUnitId) {
      if (!unit || product.variants?.length || unit.sellingPrice!==unitPrice) return res.status(400).json({error:'Choose a current selling unit and price.'});
      try {baseQuantity(quantity,unit.baseUnits);} catch {return res.status(400).json({error:'Invalid packaging quantity.'});}
    }
    const lineAmount=roundMoney(unitPrice*quantity*(1-discount/100)-discountFixed);
    lineSubtotal+=lineAmount;
    normalizedItems.push({productId:product.id,productName:product.name,
      quantity,sellingPrice:unitPrice,discount,discountAmount:discountFixed,sellingUnitId:unit?.id,sellingUnitLabel:unit?.label,baseUnitsPerSaleUnit:unit?.baseUnits});
  }
  if(!Number.isFinite(lineSubtotal)||lineSubtotal>9_000_000_000)
    return res.status(400).json({error:'Quotation total exceeds allowed range.'});
  const profile=db.settings.shopProfiles?.find(shop=>shop.id===activeShopId);
  const {subtotal,tax,total}=invoiceTotals(lineSubtotal,profile?.taxRate??db.settings.taxRate,discountAmount);
  if(!Number.isFinite(total)||total<0)return res.status(400).json({error:'Invalid quotation totals.'});
  const quotation:Quotation={
    id:'quo-'+randomUUID(),shopId:activeShopId,quoteNumber:'',
    date:new Date().toISOString(),validUntil:dateRaw||undefined,
    customerId:customer.id,customerName:customer.name,customerPhone:customer.phone||undefined,
    items:normalizedItems,subtotal,tax,discountAmount,total,status:'Draft',
    notes:notes||undefined,createdBy:auth?.name||'System'
  };
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    quotation.quoteNumber=await allocateTradeDocumentNumber(client,'QTN',quotation.date);
    await client.query(
      `INSERT INTO quotations(id,shop_id,quote_number,date,valid_until,customer_id,customer_name,customer_phone,
       items,subtotal,tax,discount_amount,total,status,notes,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,'Draft',$14,$15)`,
      [quotation.id,activeShopId,quotation.quoteNumber,quotation.date,quotation.validUntil||null,
       quotation.customerId,quotation.customerName,quotation.customerPhone||null,
       JSON.stringify(quotation.items),quotation.subtotal,quotation.tax,quotation.discountAmount,
       quotation.total,quotation.notes||null,quotation.createdBy]);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');return res.status(409).json({error:'Could not save quotation.'});}finally{client.release();}
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
    const unit=product.sharedStockUnits?.units.find(u=>u.id===line.sellingUnitId);
    if ((product.sharedStockUnits || line.sellingUnitId) && (!unit || unit.baseUnits!==line.baseUnitsPerSaleUnit || unit.label!==line.sellingUnitLabel || unit.sellingPrice!==line.sellingPrice)) return res.status(409).json({error:'Quotation packaging or price changed. Issue a new quotation.'});
    items.push({...line,variantSku:product.sku,variantUnit:unit?.label,costPrice:roundMoney((product.costPrice||0)*(unit?.baseUnits ?? 1))});
  }
  const tx:SalesTransaction={
    id:'tx-'+randomUUID(),shopId:activeShopId,
    invoiceNumber:'',
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
  const first = from ? String(from) : '1970-01-01';
  const last = to ? String(to) : reportDay(new Date());
  const fromDate = new Date(first + 'T00:00:00+05:30');
  const toDate = to ? new Date(last + 'T23:59:59.999+05:30') : new Date();
  if (!Number.isFinite(+fromDate) || !Number.isFinite(+toDate)) return res.status(400).json({error:'Invalid report dates'});
  const filtered = db.transactions.filter(t => t.shopId === activeShopId && new Date(t.date) >= fromDate && new Date(t.date) <= toDate);
  const productCostMap = new Map(db.products.filter(p => p.shopId === activeShopId).map(p => [p.id, p.costPrice]));
  const rows = filtered.map((t) => {
    const profit = saleProfit(t, productCostMap);
    return { invoiceNumber: t.invoiceNumber, date: reportDay(t.date), customer: t.customerName, salesRepresentative: t.salesRepName || 'Not recorded', items: t.items.length, subtotal: t.subtotal, tax: t.tax, discount: t.discountAmount, total: t.total, profit: Math.round(profit * 100) / 100, paymentMethod: t.paymentMethod, status: t.status || 'Completed' };
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
         i.quantity AS ordered,i.selling_unit_label AS "sellingUnitLabel",i.base_units_per_purchase_unit AS "baseUnitsPerPurchaseUnit",COALESCE(SUM(ri.quantity),0)::integer AS received
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
app.get('/api/ars/import-shipments/:id/landed-cost',requireRole(['Super Admin','Store Manager']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Shipment cost access denied.'});
 try{const result=await previewLandedCost(pool,scope.shopId,req.params.id);res.setHeader('Cache-Control','no-store');return res.json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(message==='Shipment not found in this shop.')return res.status(404).json({error:message});if(['Review invalid or missing purchase unit cost or conversion.','Purchase order total does not reconcile to line costs.'].includes(message))return res.status(409).json({error:message});console.error('Landed cost preview failed',error);return res.status(500).json({error:'Unable to calculate landed cost.'});}
});
app.post('/api/ars/import-shipments/:id/landed-cost',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Shipment cost approval access denied.'});
 const {requestId,evidence,expectedSnapshot}=req.body||{};
 if(!validChequeRequestId(requestId)||typeof evidence!=='string'||!evidence.trim()||evidence.length>500||!expectedSnapshot||typeof expectedSnapshot!=='object'||Array.isArray(expectedSnapshot))return res.status(400).json({error:'Review the shipment and provide an approval reference.'});
 try{const result=await approveLandedCost(pool,{id:requestId,shopId:scope.shopId,shipmentId:req.params.id,evidence,approvedBy:scope.recordedBy,expectedSnapshot});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(['Shipment not found in this shop.','Review invalid or missing purchase unit cost or conversion.','Purchase order total does not reconcile to line costs.','Approval reference and reviewed cost snapshot are required.','Approval request identifier already used.','Only shipments with open, unreceived purchase orders can be approved.','Existing receipts require a separate historical costing review.','Shipment costs changed. Refresh and review again.','Shipment already has an approved landed cost.'].includes(message))return res.status(409).json({error:message});console.error('Landed cost approval failed',error);return res.status(500).json({error:'Unable to confirm approval. Retry the same request.'});}
});
app.post('/api/ars/import-shipments/:id/receive', requireRole(['Super Admin','Store Manager','Inventory Staff']), (_req,res)=>{
  res.status(409).json({error:'Use Warehouse Receiving to post verified item quantities. The legacy full-shipment receipt is disabled.'});
});

// Recording a profit allocation is not a payout or confirmation of money sent.
// Only the Super Admin may record an allocation supported by approved statements.
// Immutable partner agreements: each applies from its accounting month onward.
app.get('/api/ars/ownership-agreements',requireRole(['Super Admin']),async(req,res)=>{
  const {activeShopId}=getActiveShopContext(db,req);
  try{
    const rows=await pool.query(
      'SELECT id,effective_period,approval_reference,approved_by,approved_at,shares FROM ars_partner_ownership_agreements WHERE shop_id=$1 ORDER BY effective_period DESC LIMIT 100',
      [activeShopId]);
    res.json(rows.rows);
  }catch{res.status(503).json({error:'Could not load ownership agreements.'});}
});
app.post('/api/ars/ownership-agreements',requireRole(['Super Admin']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery is required.'});
  const {activeShopId}=getActiveShopContext(db,req);
  try{
    const result=await recordArsOwnershipAgreement(pool,{
      shopId:activeShopId,
      effectivePeriod:String(req.body?.effectivePeriod||''),
      approvalReference:String(req.body?.approvalReference||''),
      approvedBy:(req as AppRequest).authUser?.email||'System',
      shares:req.body?.shares,
    });
    res.status(201).json(result);
  }catch(error){res.status(409).json({error:(error as Error).message});}
});

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
      pool.query(`SELECT e.*,m.account_id AS financial_account_id,a.name AS financial_account_name,m.id AS movement_id,j.id AS journal_id,
      CASE WHEN m.id IS NULL AND j.id IS NULL THEN 'Historical'
      WHEN m.id='partner-capital:'||e.id AND j.id='partner-capital:'||e.id
      AND m.amount=CASE WHEN e.entry_type='Contribution' THEN e.amount_lkr ELSE -e.amount_lkr END
      AND m.effective_date=e.entry_date AND j.posting_date=e.entry_date AND m.recorded_by=e.created_by AND j.recorded_by=e.created_by
      AND (SELECT COUNT(*) FROM ars_gl_lines l WHERE l.shop_id=j.shop_id AND l.journal_id=j.id)=2
      AND (SELECT COALESCE(SUM(l.debit),0)=e.amount_lkr AND COALESCE(SUM(l.credit),0)=e.amount_lkr FROM ars_gl_lines l WHERE l.shop_id=j.shop_id AND l.journal_id=j.id)
      AND (SELECT COUNT(*) FROM ars_financial_movements x WHERE x.shop_id=e.shop_id AND x.source_id=e.id AND x.movement_kind='Partner Capital')=1
      THEN 'Posted' ELSE 'Review required' END AS posting_status
      FROM ars_partner_capital_entries e
      LEFT JOIN LATERAL (SELECT x.* FROM ars_financial_movements x WHERE x.shop_id=e.shop_id AND x.source_id=e.id AND x.movement_kind='Partner Capital' ORDER BY x.id LIMIT 1) m ON TRUE
      LEFT JOIN ars_financial_accounts a ON a.shop_id=e.shop_id AND a.id=m.account_id
      LEFT JOIN ars_gl_journals j ON j.shop_id=e.shop_id AND j.source_kind='PartnerCapital' AND j.source_id=e.id
      WHERE e.shop_id=$1 ORDER BY e.entry_date DESC,e.created_at DESC,e.id DESC LIMIT 500`,[activeShopId])
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

const payrollErrors=new Set(['Payroll calculation base salary must match the proposal.','Payroll proposal identifier already used with different calculation.','Payroll calculation integrity verification failed.','Explicit payroll policy and component lists required.','Unique component identifier and supporting evidence required.','Invalid earnings component.','Positive earnings required.','Invalid deduction component.','Positive deduction required.','Invalid contribution party or rate.','Contribution basis exceeds gross earnings.','Payroll deductions exceed gross earnings.','Payroll amount outside supported range.','Invalid payroll snapshot data.','Valid payroll proposal and evidence required.','Positive base salary required.','Use a non-negative decimal amount with at most two decimal places.','Payroll proposal identifier already used with different details.','Employee not found in this shop.','Base salary changed. Refresh and review payroll.','Employee payroll already accrued for this month.','An unresolved or approved payroll proposal already exists for this month.','Valid payroll decision and evidence required.','Payroll proposal not found in this shop.','Payroll proposal already reviewed.','Employee or base salary changed. Reject and prepare a new proposal.','Valid payroll month required.']);
const payrollPolicyErrors=new Set(['Valid payroll policy and documentary evidence required.','Documented eligibility rules required.','Payroll policy identifier already used with different details.','A pending or approved policy already exists for this effective month.','Valid payroll policy review required.','Payroll policy not found in this shop.','Payroll policy already reviewed.','Independent payroll policy reviewer required.','Approved policy already exists for this effective month.','Existing approved detailed payroll requires policy reconciliation before retrospective approval.','Valid payroll month required.','No approved payroll policy for this month.','Conflicting approved payroll policies require reconciliation.']);
app.get('/api/ars/payroll/policies',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 try{return res.json(await listPayrollPolicies(pool,scope.shopId));}
 catch(error){console.error('Payroll policy listing failed',error);return res.status(503).json({error:'Unable to load payroll policies.'});}
});
app.get('/api/ars/payroll/policies/effective',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const period=req.query.period;
 if(typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return res.status(400).json({error:'Valid payroll month required.'});
 try{return res.json({policy:await effectivePayrollPolicy(pool,scope.shopId,period),statutoryVerified:false,postingEnabled:false});}
 catch(error){const message=error instanceof Error?error.message:'';if(payrollPolicyErrors.has(message))return res.status(409).json({error:message});console.error('Effective payroll policy read failed',error);return res.status(503).json({error:'Unable to confirm effective payroll policy.'});}
});
app.post('/api/ars/payroll/policies',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const {requestId,effectiveMonth,employeeEpfBp,employerEpfBp,employerEtfBp,eligibilityRules,authorityReference,evidence}=req.body||{};
 if(!validChequeRequestId(requestId))return res.status(400).json({error:'Valid payroll policy request identifier required.'});
 try{const result=await proposePayrollPolicy(pool,scope.shopId,scope.recordedBy,{id:requestId,effectiveMonth,employeeEpfBp,employerEpfBp,employerEtfBp,eligibilityRules,authorityReference,evidence});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(payrollPolicyErrors.has(message))return res.status(409).json({error:message});console.error('Payroll policy preparation failed',error);return res.status(503).json({error:'Unable to confirm policy preparation. Retry identical request.'});}
});
app.post('/api/ars/payroll/policies/:id/review',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const id=req.params.id,{decision,evidence}=req.body||{};
 if(!validChequeRequestId(id)||!['Approved','Rejected'].includes(decision)||typeof evidence!=='string')return res.status(400).json({error:'Valid payroll policy review required.'});
 try{const result=await reviewPayrollPolicy(pool,scope.shopId,scope.recordedBy,{id,decision,evidence});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(payrollPolicyErrors.has(message))return res.status(409).json({error:message});console.error('Payroll policy review failed',error);return res.status(503).json({error:'Unable to confirm policy review. Retry identical decision.'});}
});
app.get('/api/ars/payroll/proposals',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const period=req.query.period;
 if(typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return res.status(400).json({error:'Valid payroll month required.'});
 try{return res.json(await listPayrollProposals(pool,scope.shopId,period));}
 catch(error){console.error('Payroll listing failed',error);return res.status(503).json({error:'Unable to load payroll proposals.'});}
});
app.get('/api/ars/payroll/statutory-settlements/reconciliation',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const period=req.query.period;
 if(typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return res.status(400).json({error:'Valid payroll month required.'});
 try{return res.json(await reconcileStatutoryContributions(pool,scope.shopId,period));}
 catch(error){console.error('Statutory reconciliation failed',error);return res.status(503).json({error:'Unable to confirm statutory reconciliation.'});}
});
app.get('/api/ars/payroll/statutory-settlements/banks',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 try{const day=reportDay(new Date());return res.json({day,accounts:await listStatutoryBankAvailability(pool,scope.shopId,day),postingEnabled:false});}
 catch(error){console.error('Statutory bank availability failed',error);return res.status(503).json({error:'Unable to confirm bank availability.'});}
});
app.get('/api/ars/payroll/statutory-settlements/balances',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const period=req.query.period;
 if(typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return res.status(400).json({error:'Valid payroll month required.'});
 try{return res.json(await listMonthlyStatutoryLiabilities(pool,scope.shopId,period));}
 catch(error){console.error('Statutory liability register failed',error);return res.status(503).json({error:'Unable to confirm statutory liabilities.'});}
});
app.get('/api/ars/payroll/statutory-settlements',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const period=req.query.period;
 if(typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return res.status(400).json({error:'Valid payroll month required.'});
 try{return res.json(await listStatutorySettlementHistory(pool,scope.shopId,period));}
 catch(error){console.error('Statutory settlement history failed',error);return res.status(503).json({error:'Unable to confirm statutory settlement history.'});}
});
app.post('/api/ars/payroll/statutory-settlements',requireRole(['Super Admin']),(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!chequeShopAccess(req))return res.status(403).json({error:'Accounting access denied.'});
 return res.status(409).json({error:'Statutory payment posting is disabled pending accounting verification.'});
});
app.get('/api/ars/payroll/payslips/:id/pdf',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const id=req.params.id;if(typeof id!=='string'||!id.trim()||id.length>200)return res.status(400).json({error:'Valid payroll accrual identifier required.'});
 try{
  const slip=await readPostedPayslip(pool,scope.shopId,id);
  if(!slip)return res.status(404).json({error:'Posted payroll not found.'});
  const {activeShopId,activeShopName}=getActiveShopContext(db,req);
  if(activeShopId!==scope.shopId)return res.status(403).json({error:'Accounting access denied.'});
  const pdf=await renderPostedPayslip(slip,activeShopName);
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="payslip-'+slip.period+'.pdf"');return res.send(pdf);
 }catch(error){if(error instanceof Error&&error.message==='Payroll requires reconciliation before payslip export.')return res.status(409).json({error:error.message});console.error('Payslip export failed',error);return res.status(503).json({error:'Unable to verify posted payroll for payslip.'});}
});
app.get('/api/ars/payroll/salary-payments/balances',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const employeeId=req.query.employeeId;
 if(employeeId!==undefined&&(typeof employeeId!=='string'||!employeeId.trim()||employeeId.length>200))return res.status(400).json({error:'Valid employee identifier required.'});
 try{return res.json(await listSalaryBalances(pool,scope.shopId,employeeId as string|undefined));}
 catch(error){console.error('Salary balance listing failed',error);return res.status(503).json({error:'Unable to confirm salary balances.'});}
});
app.get('/api/ars/payroll/salary-payments',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const accrualId=req.query.accrualId;
 if(accrualId!==undefined&&(typeof accrualId!=='string'||!accrualId.trim()||accrualId.length>200))return res.status(400).json({error:'Valid payroll accrual identifier required.'});
 try{return res.json(await listSalaryPayments(pool,scope.shopId,accrualId as string|undefined));}
 catch(error){console.error('Salary payment history failed',error);return res.status(503).json({error:'Unable to confirm salary payment history.'});}
});
app.post('/api/ars/payroll/salary-payments',requireRole(['Super Admin']),(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!chequeShopAccess(req))return res.status(403).json({error:'Accounting access denied.'});
 return res.status(409).json({error:'Salary payment posting is disabled pending accounting verification.'});
});
const employeeAdvanceErrors=new Set(['Valid employee advance request and evidence required.','Positive employee advance amount required.','Advance request identifier already used with different details.','Employee not found in this shop.','Valid employee advance review required.','Advance request not found in this shop.','Advance request already reviewed.','Independent advance reviewer required.','Valid payroll shop required.','Valid payroll shop and employee required.','Use a non-negative decimal amount with at most two decimal places.']);
app.get('/api/ars/payroll/advances',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 try{return res.json(await listEmployeeAdvanceRequests(pool,scope.shopId));}
 catch(error){console.error('Employee advance register failed',error);return res.status(503).json({error:'Unable to load employee advance requests.'});}
});
app.get('/api/ars/payroll/advances/balances',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const employeeId=req.query.employeeId;
 if(employeeId!==undefined&&(typeof employeeId!=='string'||!employeeId.trim()||employeeId.length>200))return res.status(400).json({error:'Valid payroll shop and employee required.'});
 try{return res.json(await listEmployeeAdvanceBalances(pool,scope.shopId,employeeId as string|undefined));}
 catch(error){console.error('Employee advance balances failed',error);return res.status(503).json({error:'Unable to confirm employee advance balances.'});}
});
app.post('/api/ars/payroll/advances',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const {requestId,employeeId,amount,requestedDate,evidence}=req.body||{};
 if(!validChequeRequestId(requestId)||typeof amount!=='string'||typeof employeeId!=='string'||typeof requestedDate!=='string'||typeof evidence!=='string')return res.status(400).json({error:'Valid employee advance request and evidence required.'});
 try{const result=await prepareEmployeeAdvance(pool,scope.shopId,scope.recordedBy,{id:requestId,employeeId,amount,requestedDate,currentBusinessDate:reportDay(new Date()),evidence});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(employeeAdvanceErrors.has(message))return res.status(409).json({error:message});console.error('Employee advance preparation failed',error);return res.status(503).json({error:'Unable to confirm advance preparation. Retry identical request.'});}
});
app.post('/api/ars/payroll/advances/:id/review',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const {decision,evidence}=req.body||{},id=req.params.id;
 if(!validChequeRequestId(id)||!['Approved','Rejected'].includes(decision)||typeof evidence!=='string')return res.status(400).json({error:'Valid employee advance review required.'});
 try{const result=await reviewEmployeeAdvance(pool,scope.shopId,scope.recordedBy,{id,decision,evidence});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(employeeAdvanceErrors.has(message))return res.status(409).json({error:message});console.error('Employee advance review failed',error);return res.status(503).json({error:'Unable to confirm advance review. Retry identical decision.'});}
});
app.post('/api/ars/payroll/advances/:id/disburse',requireRole(['Super Admin']),(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!chequeShopAccess(req))return res.status(403).json({error:'Accounting access denied.'});
 return res.status(409).json({error:'Employee advance disbursement is disabled pending accounting verification.'});
});
app.post('/api/ars/payroll/advances/:id/repay',requireRole(['Super Admin']),(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!chequeShopAccess(req))return res.status(403).json({error:'Accounting access denied.'});
 return res.status(409).json({error:'Employee advance repayment is disabled pending accounting verification.'});
});
const payrollEligibilityErrors=new Set(['Valid employee eligibility proposal and evidence required.','Eligibility request identifier already used with different details.','Employee not found in this shop.','Pending or approved eligibility record already exists for this month.','Valid eligibility review and evidence required.','Eligibility record not found in this shop.','Eligibility record already reviewed.','Independent eligibility reviewer required.','Approved eligibility already exists for this month.','Approved payroll requires eligibility reconciliation before retrospective approval.','Valid payroll shop required.','Valid employee and payroll month required.','No employee eligibility record for this month.','Conflicting eligibility records require reconciliation.','Latest employee eligibility requires independent approval.','Employee requires special statutory review.']);
app.get('/api/ars/payroll/eligibility',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 try{return res.json(await listPayrollEligibility(pool,scope.shopId));}
 catch(error){console.error('Payroll eligibility listing failed',error);return res.status(503).json({error:'Unable to load eligibility records.'});}
});
app.get('/api/ars/payroll/eligibility/effective',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const {employeeId,period}=req.query;
 if(typeof employeeId!=='string'||typeof period!=='string')return res.status(400).json({error:'Valid employee and payroll month required.'});
 try{return res.json({eligibility:await effectivePayrollEligibility(pool,scope.shopId,employeeId,period),statutoryVerified:false,postingEnabled:false});}
 catch(error){const message=error instanceof Error?error.message:'';if(payrollEligibilityErrors.has(message))return res.status(409).json({error:message});console.error('Eligibility lookup failed',error);return res.status(503).json({error:'Unable to confirm employee eligibility.'});}
});
app.post('/api/ars/payroll/eligibility',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const {requestId,employeeId,effectiveMonth,classification,authorityReference,evidence}=req.body||{};
 if(!validChequeRequestId(requestId))return res.status(400).json({error:'Valid eligibility request identifier required.'});
 try{const result=await proposePayrollEligibility(pool,scope.shopId,scope.recordedBy,{id:requestId,employeeId,effectiveMonth,classification,authorityReference,evidence});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(payrollEligibilityErrors.has(message))return res.status(409).json({error:message});console.error('Eligibility preparation failed',error);return res.status(503).json({error:'Unable to confirm eligibility preparation. Retry identical request.'});}
});
app.post('/api/ars/payroll/eligibility/:id/review',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const id=req.params.id,{decision,evidence}=req.body||{};
 if(!validChequeRequestId(id)||!['Approved','Rejected'].includes(decision)||typeof evidence!=='string')return res.status(400).json({error:'Valid eligibility review and evidence required.'});
 try{const result=await reviewPayrollEligibility(pool,scope.shopId,scope.recordedBy,{id,decision,evidence});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(payrollEligibilityErrors.has(message))return res.status(409).json({error:message});console.error('Eligibility review failed',error);return res.status(503).json({error:'Unable to confirm eligibility review. Retry identical decision.'});}
});
app.post('/api/ars/payroll/calculate-statutory',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const {employeeId,period,calculation,eligibilityEvidence}=req.body||{};
 if(typeof employeeId!=='string'||!employeeId.trim()||employeeId.length>200||typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||period>reportDay(new Date()).slice(0,7)||typeof eligibilityEvidence!=='string'||!eligibilityEvidence.trim()||eligibilityEvidence.trim().length>500||!calculation||typeof calculation!=='object'||Array.isArray(calculation))return res.status(400).json({error:'Valid employee, payroll month, calculation and provisional eligibility evidence required.'});
 try{
  const employee=(await pool.query('SELECT salary::text AS salary FROM employees WHERE shop_id=$1 AND id=$2',[scope.shopId,employeeId])).rows[0];
  if(!employee)return res.status(404).json({error:'Employee not found in this shop.'});
  const preliminary=calculatePayroll(calculation);
  if(preliminary.baseSalary!==calculatePayroll({baseSalary:employee.salary,earnings:[],deductions:[],contributions:[],policyReference:'Salary verification'}).baseSalary)return res.status(409).json({error:'Base salary changed. Refresh and review payroll.'});
  const policy=await effectivePayrollPolicy(pool,scope.shopId,period);
  const eligibility=await effectivePayrollEligibility(pool,scope.shopId,employeeId,period);
  const result=calculateStatutoryPayroll(calculation,policy);
  return res.json({employeeId,period,policyId:result.policyId,effectiveMonth:policy.effective_month,eligibilityId:eligibility.id,eligibilityEffectiveMonth:eligibility.effective_month,calculation:result.results,eligibilityEvidence:eligibilityEvidence.trim(),statutoryVerified:false,postingEnabled:false});
 }catch(error){
  const message=error instanceof Error?error.message:'';
  if(payrollErrors.has(message)||payrollPolicyErrors.has(message)||payrollEligibilityErrors.has(message)||['Approved policy terms and payroll without manual contributions required.','Executable statutory eligibility rules required.','Explicit statutory earnings and unpaid leave treatment required.','Statutory contribution basis cannot be negative.'].includes(message))return res.status(409).json({error:message});
  console.error('Statutory payroll preview failed',error);return res.status(503).json({error:'Unable to verify provisional statutory calculation.'});
 }
});
app.post('/api/ars/payroll/calculate',requireRole(['Super Admin']),(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!chequeShopAccess(req))return res.status(403).json({error:'Accounting access denied.'});
 try{return res.json({calculation:calculatePayroll(req.body),postingEnabled:false,statutoryVerified:false});}
 catch(error){const message=error instanceof Error?error.message:'';return res.status(400).json({error:payrollErrors.has(message)?message:'Invalid payroll calculation inputs.'});}
});
const statutorySnapshotErrors=new Set(["Advance recovery requires a disbursement reference.","Advance recovery requires matching disbursement before payroll date.","Payroll recovery exceeds outstanding employee advance.","Reversed employee advance requires reconciliation.","Valid statutory snapshot request required.","Statutory calculations require verified source bindings.","Statutory policy or eligibility changed. Recalculate payroll.","Statutory calculation changed. Recalculate payroll.","Independent statutory payroll review and intact snapshot required.","Statutory policy or eligibility changed. Reject and prepare a new proposal.","Statutory payroll snapshot integrity verification failed.","Approved policy terms and payroll without manual contributions required.","Executable statutory eligibility rules required.","Explicit statutory earnings and unpaid leave treatment required.","Statutory contribution basis cannot be negative."]);
app.post('/api/ars/payroll/proposals',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const {requestId,employeeId,period,expectedBaseSalary,postingDate,evidence,calculation,statutory}=req.body||{};
 if(!validChequeRequestId(requestId)||typeof employeeId!=='string'||typeof period!=='string'||typeof expectedBaseSalary!=='string'||typeof postingDate!=='string'||typeof evidence!=='string')return res.status(400).json({error:'Valid payroll proposal and evidence required.'});
 try{
  const result=await preparePayroll(pool,scope.shopId,scope.recordedBy,{id:requestId,employeeId,period,expectedBaseSalary,postingDate,evidence,currentBusinessDate:reportDay(new Date()),calculation,statutory});
  return res.status(result.replayed?200:201).json(result);
 }catch(error){const message=error instanceof Error?error.message:'';if(payrollErrors.has(message)||payrollPolicyErrors.has(message)||payrollEligibilityErrors.has(message)||statutorySnapshotErrors.has(message))return res.status(409).json({error:message});console.error('Payroll preparation failed',error);return res.status(503).json({error:'Unable to confirm payroll preparation. Retry identical request.'});}
});
app.post('/api/ars/payroll/proposals/:id/review',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);res.setHeader('Cache-Control','no-store');
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const {decision,evidence}=req.body||{},proposalId=req.params.id;
 if(!validChequeRequestId(proposalId)||!['Approved','Rejected'].includes(decision)||typeof evidence!=='string')return res.status(400).json({error:'Valid payroll decision and evidence required.'});
 try{const result=await reviewPayroll(pool,scope.shopId,scope.recordedBy,{proposalId,decision,evidence});return res.status(result.replayed?200:201).json(result);}
 catch(error){const message=error instanceof Error?error.message:'';if(payrollErrors.has(message)||payrollPolicyErrors.has(message)||payrollEligibilityErrors.has(message)||statutorySnapshotErrors.has(message))return res.status(409).json({error:message});console.error('Payroll review failed',error);return res.status(503).json({error:'Unable to confirm payroll review. Retry identical decision.'});}
});
app.post('/api/ars/payroll/proposals/:id/post',requireRole(['Super Admin']),(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!chequeShopAccess(req))return res.status(403).json({error:'Accounting access denied.'});
 return res.status(409).json({error:'Payroll posting is disabled pending statutory payroll and deduction verification.'});
});
app.get('/api/ars/partners/:partnerId/capital-statement/export',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 const {fromDate,toDate}=req.query,partnerId=req.params.partnerId;
 if(typeof partnerId!=='string'||!partnerId.trim()||partnerId.length>200||typeof fromDate!=='string'||typeof toDate!=='string')return res.status(400).json({error:'Invalid partner statement filters.'});
 try{return res.json(await exportPartnerCapitalStatement(pool,{shopId:scope.shopId,partnerId,fromDate,toDate}));}
 catch(error){
  const message=error instanceof Error?error.message:'';
  if(message==='Invalid partner statement filters.')return res.status(400).json({error:message});
  if(message==='Partner not found in this shop.')return res.status(404).json({error:message});
  if(message==='Partner statement exceeds 2500 export rows. Select a shorter date range.')return res.status(422).json({error:message});
  console.error('Partner capital statement export failed',error);return res.status(503).json({error:'Unable to prepare complete partner statement. Retry export.'});
 }
});
app.get('/api/ars/partners/:partnerId/capital-statement',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 const {fromDate,toDate,offset='0',limit='100'}=req.query,partnerId=req.params.partnerId;
 if(typeof partnerId!=='string'||!partnerId.trim()||partnerId.length>200||typeof fromDate!=='string'||typeof toDate!=='string'||typeof offset!=='string'||typeof limit!=='string'||!/^\d+$/.test(offset)||!/^\d+$/.test(limit))return res.status(400).json({error:'Invalid partner statement filters.'});
 try{return res.json(await partnerCapitalStatement(pool,{shopId:scope.shopId,partnerId,fromDate,toDate,offset:Number(offset),limit:Number(limit)}));}
 catch(error){
  const message=error instanceof Error?error.message:'';
  if(message==='Invalid partner statement filters.')return res.status(400).json({error:message});
  if(message==='Partner not found in this shop.')return res.status(404).json({error:message});
  console.error('Partner capital statement failed',error);return res.status(503).json({error:'Unable to load partner capital statement.'});
 }
});
app.get('/api/ars/partner-capital/:entryId/reviews',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 const entryId=req.params.entryId;
 if(typeof entryId!=='string'||!entryId.trim()||entryId.length>200)return res.status(400).json({error:'Invalid capital entry identifier.'});
 try{
  if(!(await pool.query('SELECT 1 FROM ars_partner_capital_entries WHERE shop_id=$1 AND id=$2',[scope.shopId,entryId])).rowCount)return res.status(404).json({error:'Capital entry not found.'});
  return res.json(await listHistoricalCapitalReviews(pool,scope.shopId,entryId));
 }catch(error){console.error('Historical capital review history failed',error);return res.status(503).json({error:'Unable to load capital review history.'});}
});
app.post('/api/ars/partner-capital/:entryId/reviews',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const entryId=req.params.entryId,{requestId,decision,evidence,openingJournalId}=req.body||{};
 if(typeof entryId!=='string'||!entryId.trim()||entryId.length>200||!validChequeRequestId(requestId)||!['Included in opening balances','Discrepancy identified'].includes(decision)||typeof evidence!=='string'||!evidence.trim()||evidence.trim().length>500||(openingJournalId!==undefined&&(typeof openingJournalId!=='string'||!openingJournalId.trim()||openingJournalId.length>200))||(decision==='Included in opening balances')!==!!openingJournalId)return res.status(400).json({error:'Valid historical review details and evidence required.'});
 try{
  const result=await reviewHistoricalCapital(pool,scope.shopId,scope.recordedBy,{requestId,entryId,decision,evidence,openingJournalId});
  return res.status(result.replayed?200:201).json(result);
 }catch(error){
  const message=error instanceof Error?error.message:'';
  if(message==='Historical capital entry not found.')return res.status(404).json({error:message});
  if(['Valid historical capital review and evidence required.','Opening journal required only for inclusion review.','Review request already used with different details.','Linked financial posting requires a different reconciliation workflow.','Approved opening journal at accounting cutover required.'].includes(message))return res.status(409).json({error:message});
  console.error('Historical capital review failed',error);return res.status(503).json({error:'Unable to confirm review. Retry identical details and request identifier.'});
 }
});
app.get('/api/ars/partner-capital/requests/:requestId',requireRole(['Super Admin']),async(req,res)=>{
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 res.setHeader('Cache-Control','no-store');
 if(!validChequeRequestId(req.params.requestId))return res.status(400).json({error:'Invalid capital request identifier.'});
 try{
  const rows=(await pool.query(`SELECT e.id,e.partner_id AS "partnerId",e.entry_type AS "entryType",e.amount_lkr::text AS "amountLkr",e.entry_date::text AS "entryDate",e.reference,e.note,
   m.account_id AS "accountId",m.id AS "movementId",j.id AS "journalId",
   (m.amount=CASE WHEN e.entry_type='Contribution' THEN e.amount_lkr ELSE -e.amount_lkr END AND m.effective_date=e.entry_date AND m.recorded_by=e.created_by AND j.posting_date=e.entry_date AND j.recorded_by=e.created_by
   AND (SELECT COUNT(*) FROM ars_gl_lines l WHERE l.shop_id=j.shop_id AND l.journal_id=j.id)=2
   AND (SELECT COALESCE(SUM(l.debit),0)=e.amount_lkr AND COALESCE(SUM(l.credit),0)=e.amount_lkr FROM ars_gl_lines l WHERE l.shop_id=j.shop_id AND l.journal_id=j.id)) AS consistent
   FROM ars_partner_capital_entries e LEFT JOIN ars_financial_movements m ON m.shop_id=e.shop_id AND m.source_id=e.id AND m.movement_kind='Partner Capital'
   LEFT JOIN ars_gl_journals j ON j.shop_id=e.shop_id AND j.source_id=e.id AND j.source_kind='PartnerCapital'
   WHERE e.shop_id=$1 AND e.id=$2 AND e.created_by=$3`,[scope.shopId,'capital-'+req.params.requestId,scope.recordedBy])).rows;
  if(!rows.length)return res.json({status:'NotConfirmed'});
  const p=rows[0];
  if(rows.length!==1||p.consistent!==true||p.journalId!=='partner-capital:'+p.id||p.movementId!=='partner-capital:'+p.id)return res.status(409).json({error:'Capital transaction requires accounting reconciliation.'});
  return res.json({status:'Committed',requestId:req.params.requestId,...p});
 }catch(error){console.error('Capital request verification failed',error);return res.status(503).json({error:'Unable to verify capital request.'});}
});
app.post('/api/ars/partner-capital/post',requireRole(['Super Admin']),async(req,res)=>{
 if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
 const scope=chequeShopAccess(req);
 if(!scope)return res.status(403).json({error:'Accounting access denied.'});
 const {requestId,partnerId,accountId,entryType,amountLkr,entryDate,reference,note}=req.body||{};
 if(!validChequeRequestId(requestId)||typeof partnerId!=='string'||typeof accountId!=='string'||!['Contribution','Drawing'].includes(entryType)||typeof amountLkr!=='string'||!/^\d{1,12}(?:\.\d{1,2})?$/.test(amountLkr)||typeof entryDate!=='string'||typeof reference!=='string'||typeof note!=='string')return res.status(400).json({error:'Enter valid capital posting details and request identifier.'});
 try{
  const result=await postPartnerCapital(pool,{id:'capital-'+requestId,shopId:scope.shopId,partnerId,accountId,entryType,amount:amountLkr,date:entryDate,reference,note,actor:scope.recordedBy,currentBusinessDate:reportDay(new Date())});
  return res.status(result.replayed?200:201).json(result);
 }catch(error){
  const message=error instanceof Error?error.message:'';
  if(['Invalid partner capital transaction details.','Invalid partner capital amount.','Capital request already used or requires reconciliation.','Verified accounting required for partner capital posting.','Active partner required in this shop.','Active bank or office cash account required.','Insufficient uncommitted funds for partner drawing.','Missing active accounting mapping: financialAccount','Missing active accounting mapping: partnerCapital','Missing active accounting mapping: partnerDrawings'].includes(message))return res.status(409).json({error:message});
  console.error('Partner capital posting failed',error);return res.status(500).json({error:'Unable to confirm capital posting. Retry the exact original request.'});
 }
});
app.post('/api/ars/partner-capital',requireRole(['Super Admin']),async(req,res)=>{
  if(!databaseWriteHealthy)return res.status(503).json({error:'Database recovery required.'});
  const scope=chequeShopAccess(req);
  if(!scope)return res.status(403).json({error:'Accounting access denied.'});
  try{
    if((await pool.query('SELECT 1 FROM ars_gl_cutover WHERE shop_id=$1 AND posting_enabled',[scope.shopId])).rowCount)return res.status(409).json({error:'Active accounting requires the financial account capital posting workflow.'});
  }catch{return res.status(503).json({error:'Unable to verify accounting status.'});}

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
  await pool.query(`CREATE TABLE IF NOT EXISTS ars_invoice_counter (
    id TEXT PRIMARY KEY, last_number BIGINT NOT NULL CHECK (last_number >= 10009)
  )`);
  await initPartialReceivingTables(pool);
  await initLandedCostTables(pool);
  await initPackagingDrafts(pool);
  await initFinancialAccounts(pool);
  await initReceivableAging(pool);
  await initPayableAging(pool);
  await initPositionRegisters(pool);
  await initGeneralLedger(pool);
  await initSharedStockSchema(pool);
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

  const listenHost = process.env.ARS_LISTEN_HOST || '0.0.0.0';
  const server = app.listen(PORT, listenHost, () => {
    const address = server.address();
    const actualPort = address && typeof address === 'object' ? address.port : PORT;
    console.log(`Server fully functional on http://${listenHost}:${actualPort}`);
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
