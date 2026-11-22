export type Role = 'Super Admin' | 'Store Manager' | 'Cashier' | 'Inventory Staff';
export type PaymentStatus = 'PAID' | 'PARTIALLY PAID' | 'UNPAID' | 'CREDIT SALE' | 'CANCELLED';
export type InvoiceCopyType =
  | 'Original Copy'
  | 'Duplicate Copy'
  | 'Office Copy'
  | 'Accounts Copy'
  | 'Delivery Copy'
  | 'Store Copy'
  | 'Reprinted Invoice';

export interface WholesaleInvoiceMeta {
  transportCharges?: number;
  deliveryCharges?: number;
  warrantyInformation?: string;
  dispatchMethod?: string;
  vehicleNumber?: string;
  deliveryNoteNumber?: string;
  batchNumber?: string;
  supplierReference?: string;
  deliveryStatus?: string;
}

export interface InvoiceCompanyMeta {
  companyLegalName?: string;
  companyTagline?: string;
  businessRegistrationNo?: string;
  vatRegistrationNo?: string;
  tinNo?: string;
  supportPhone?: string;
  supportEmail?: string;
  websiteUrl?: string;
  socialLinks?: string;
}

export interface Product {
  id: string;
  shopId?: string;
  name: string;
  sku: string;
  barcode: string;
  qrCode?: string;
  internalCode?: string;  // Admin-only unique code like YMV, TSK
  imageUrl?: string;
  images?: string[];
  brand: string;
  category: string;
  longDescription?: string;
  status?: 'Active' | 'Inactive';
  costPrice: number;
  sellingPrice: number;
  wholesalePrice?: number;
  dealerPrice?: number;
  quantity: number;
  reorderLevel: number;
  warranty: string;
  description: string;
  location?: string;
  variants?: ProductVariant[];
}

export interface ProductVariant {
  id: string;
  name: string;
  unit: string;
  sku: string;
  barcode: string;
  qrCode?: string;
  costPrice: number;
  sellingPrice: number;
  wholesalePrice?: number;
  dealerPrice?: number;
  quantity: number;
  reorderLevel: number;
  weight?: number;
  attributes?: Record<string, string>;
}

export interface Supplier {
  id: string;
  shopId?: string;
  name: string;
  companyName: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
}

export interface Customer {
  id: string;
  shopId?: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  loyaltyBalance: number;
  purchaseCount: number;
  creditLimit?: number;
  creditBalance?: number;
}

export interface Employee {
  id: string;
  shopId?: string;
  name: string;
  role: Role;
  phone: string;
  email: string;
  salary: number;
  attendanceStatus: 'Present' | 'Absent' | 'On Leave';
  performanceScore: number; // 0-100
}

export interface CartItem {
  product: Product;
  quantity: number;
  discount: number; // percentage
  discountAmount?: number;
  variantId?: string;
  variantName?: string;
  variantUnit?: string;
  variantSku?: string;
  variantBarcode?: string;
  unitPrice?: number;
  unitCostPrice?: number;
}

export interface SalesTransaction {
  id: string;
  shopId?: string;
  invoiceNumber: string;
  date: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  customerId?: string;
  cashierName: string;
  items: {
    productId: string;
    productName: string;
    variantId?: string;
    variantName?: string;
    variantUnit?: string;
    variantSku?: string;
    variantBarcode?: string;
    quantity: number;
    sellingPrice: number;
    costPrice?: number;
    discount: number;
    discountAmount?: number;
  }[];
  subtotal: number;
  tax: number;
  discountAmount: number;
  total: number;
  cashReceived?: number;
  changeDue?: number;
  invoiceQrData?: string;
  paymentMethod: 'Cash' | 'Credit Card' | 'Debit Card' | 'QR Code' | 'Bank Transfer' | 'Mobile Wallet' | 'Credit Account';
  paymentStatus?: PaymentStatus;
  wholesaleMeta?: WholesaleInvoiceMeta;
  status?: 'Completed' | 'Refunded';
  refundedAt?: string;
  refundReason?: string;
}

export interface PurchaseOrder {
  id: string;
  shopId?: string;
  poNumber: string;
  date: string;
  supplierId: string;
  supplierName: string;
  items: {
    productId: string;
    productName: string;
    variantId?: string;
    quantity: number;
    costPrice: number;
  }[];
  total: number;
  status: 'Pending' | 'Ordered' | 'Partially Received' | 'Received' | 'Cancelled';
}

export interface StockLog {
  id: string;
  shopId?: string;
  date: string;
  productId: string;
  productName: string;
  type: 'Stock In' | 'Stock Out' | 'Stock Adjust' | 'Return';
  quantity: number;
  reason: string;
  user: string;
  referenceId?: string;
}

export interface ActivityLog {
  id: string;
  shopId?: string;
  date: string;
  user: string;
  role: Role;
  action: string;
  details: string;
}

export interface StoreSettings {
  taxRate: number;
  storeName: string;
  currency: string;
  invoicePrefix: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  activeShopId?: string;
  productCategories?: string[];
  shopQRData?: string;  // Shop UPI/payment QR code as data URL
  shopProfiles?: Array<{
    id: string;
    name: string;
    logoUrl?: string;
    address?: string;
    phone?: string;
    taxRate?: number;
    invoicePrefix?: string;
    printFormat?: 'a4' | 'thermal';
    invoiceCompanyMeta?: InvoiceCompanyMeta;
  }>;
}

export interface ManualExpense {
  id: string;
  desc: string;
  amount: number;
  date: string;
  category: string;
}

export interface AuthUser {
  name: string;
  role: Role;
  email: string;
  scopedShopId?: string;
  allowedShopIds?: string[];
  fixedShopId?: string;
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupplierPayment {
  id: string;
  shopId?: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId?: string;
  amount: number;
  paymentMethod: string;
  date: string;
  note?: string;
  createdBy?: string;
}

export interface QuotationItem {
  productId: string;
  productName: string;
  quantity: number;
  sellingPrice: number;
  discount: number;
  discountAmount?: number;
}

export interface Quotation {
  id: string;
  shopId?: string;
  quoteNumber: string;
  date: string;
  validUntil?: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  items: QuotationItem[];
  subtotal: number;
  tax: number;
  discountAmount: number;
  total: number;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Expired' | 'Converted';
  notes?: string;
  createdBy?: string;
  convertedToTxId?: string;
}

export interface CashShift {
  id: string;
  shopId?: string;
  cashierName: string;
  openedAt: string;
  closedAt?: string;
  openingFloat: number;
  closingCash?: number;
  expectedCash?: number;
  cashDifference?: number;
  status: 'Open' | 'Closed';
  notes?: string;
}

export interface CustomerCreditPayment {
  id: string;
  shopId?: string;
  customerId: string;
  customerName: string;
  amount: number;
  date: string;
  paymentMethod: string;
  note?: string;
  createdBy?: string;
}

export interface InvoicePrintLog {
  id: string;
  shopId?: string;
  transactionId: string;
  invoiceNumber: string;
  copyType: InvoiceCopyType;
  printSequence: number;
  printedBy: string;
  printedAt: string;
  reason?: string;
}

export interface InvoicePrintAuditRow extends InvoicePrintLog {
  transactionStatus: 'Completed' | 'Refunded' | string;
  paymentMethod: string;
  transactionDate: string | null;
  customerName: string;
  totalAmount: number;
}

export interface InvoicePrintAuditResponse {
  filters: {
    fromDate?: string;
    toDate?: string;
    invoiceNumber?: string;
    printedBy?: string;
    status?: string;
    copyType?: InvoiceCopyType;
    page: number;
    pageSize: number;
  };
  summary: {
    totalRows: number;
    uniqueInvoices: number;
    uniquePrintedByCount: number;
  };
  uniquePrintedBy: string[];
  rows: InvoicePrintAuditRow[];
}
