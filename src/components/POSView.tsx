import { invoiceFooter } from '../utils/invoiceFooter';
import { notify } from '../utils/notifications';
import { invoiceTotals, roundMoney } from '../utils/invoiceTotals';
import React, { useState, useEffect } from 'react';
import {
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Sparkles,
  Ticket,
  UserCheck,
  CreditCard,
  QrCode,
  DollarSign,
  Printer,
  X,
  PlusSquare,
  BadgeAlert,
  ScanLine,
  BookUser,
  Eye,
  FileDown,
  Mail,
  MessageCircle,
  Filter,
} from 'lucide-react';
import { Product, ProductVariant, Customer, Employee, CartItem, SalesTransaction, StoreSettings, InvoiceCopyType, InvoicePrintAuditRow, InvoicePrintAuditResponse } from '../types';
import { QRFeatureView } from './QRFeatureView';

interface POSViewProps {
  products: Product[];
  customers: Customer[];
  employees: Employee[];
  cashierName: string;
  currentRole: 'Super Admin' | 'Store Manager' | 'Cashier' | 'Inventory Staff';
  taxConfig?: StoreSettings;
  onRefreshDb: () => void;
  authToken: string;
}

export default function POSView({
  products,
  customers,
  employees,
  cashierName,
  currentRole,
  taxConfig = { taxRate: 18, storeName: 'Lanka Smart Hardware', currency: 'LKR', invoicePrefix: 'SL-INV' },
  onRefreshDb,
  authToken,
}: POSViewProps) {
  const INVOICE_COPY_TYPE_OPTIONS: InvoiceCopyType[] = [
    'Duplicate Copy',
    'Office Copy',
    'Accounts Copy',
    'Delivery Copy',
    'Store Copy',
    'Reprinted Invoice',
  ];

  const escapeHtml = (input: string) =>
    String(input ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');


  const currencySymbol = 'Rs.';
  const formatMoney = (amount: number) => `${currencySymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const activeShopProfile = (taxConfig.shopProfiles || []).find((shop) => shop.id === taxConfig.activeShopId) || taxConfig.shopProfiles?.[0];
  const activeShopName = activeShopProfile?.name || taxConfig.storeName;
  const shopAddress = (activeShopProfile ? activeShopProfile.address : taxConfig.address) || '';
  const shopPhone = (activeShopProfile ? activeShopProfile.phone : taxConfig.phone) || '';
  const invoiceCompanyMeta = {
    companyLegalName: activeShopProfile?.invoiceCompanyMeta?.companyLegalName || activeShopName,
    companyTagline: activeShopProfile?.invoiceCompanyMeta?.companyTagline || 'Hardware Wholesale & Retail',
    businessRegistrationNo: activeShopProfile?.invoiceCompanyMeta?.businessRegistrationNo || '',
    vatRegistrationNo: activeShopProfile?.invoiceCompanyMeta?.vatRegistrationNo || '',
    tinNo: activeShopProfile?.invoiceCompanyMeta?.tinNo || '',
    supportPhone: activeShopProfile?.invoiceCompanyMeta?.supportPhone || '',
    supportEmail: activeShopProfile?.invoiceCompanyMeta?.supportEmail || '',
    websiteUrl: activeShopProfile?.invoiceCompanyMeta?.websiteUrl || '',
    socialLinks: activeShopProfile?.invoiceCompanyMeta?.socialLinks || '',
  };
  const shopLogoUrl = activeShopProfile?.logoUrl || taxConfig.logoUrl || '';
  const isAdminSeller = currentRole === 'Super Admin' || currentRole === 'Store Manager';
  const printFormat = activeShopProfile?.printFormat || 'a4';
  const normalizedShopName = String(activeShopName || '').toLowerCase();
  const isWholesaleShop = String(activeShopProfile?.id || '') === 'shop-2'
    || normalizedShopName.includes('wholesale')
    || normalizedShopName.includes('ars pvt');
  const effectivePrintFormat: 'a4' | 'thermal' = isWholesaleShop ? 'a4' : (printFormat === 'thermal' ? 'thermal' : 'a4');
  const printableShopLogoUrl = shopLogoUrl
    ? (() => {
        try {
          return new URL(shopLogoUrl, window.location.origin).href;
        } catch {
          return shopLogoUrl;
        }
      })()
    : '';
  const printableShopLogoMarkup = printableShopLogoUrl
    ? `<img src="${escapeHtml(printableShopLogoUrl)}" alt="Store logo" style="display:block;max-width:120px;max-height:56px;object-fit:contain;margin:0 0 8px;" />`
    : '';
  const thermalShopLogoMarkup = printableShopLogoUrl
    ? `<img src="${escapeHtml(printableShopLogoUrl)}" alt="Store logo" style="display:block;max-width:72px;max-height:36px;object-fit:contain;margin:0 auto 6px;" />`
    : '';
  const authFetch = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${authToken}`);
    if (taxConfig.activeShopId) {
      headers.set('X-Shop-Id', taxConfig.activeShopId);
    }
    if (!headers.has('Content-Type') && init?.body) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...init, headers });
  };
  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMobileView, setActiveMobileView] = useState<'catalog' | 'cart'>('catalog');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedVariantByProduct, setSelectedVariantByProduct] = useState<Record<string, string>>({});

  // Customer & Cart states
  const [selectedCustomer, setSelectedCustomer] = useState<Customer>(
    customers.find((c) => c.id !== 'cust-walkin') || {
      id: '',
      name: '',
      phone: '-',
      email: '-',
      address: '-',
      loyaltyBalance: 0,
      purchaseCount: 0,
    }
  );
  const [billingCustomerName, setBillingCustomerName] = useState<string>(customers.find((c) => c.id !== 'cust-walkin')?.name || '');
  const [customerSearch, setCustomerSearch] = useState('');
  const [billingCustomerPhone, setBillingCustomerPhone] = useState<string>('');
  const [billingCustomerAddress, setBillingCustomerAddress] = useState<string>('');
  const [selectedSalesRepId, setSelectedSalesRepId] = useState('');
  const activeSalesReps = employees.filter(rep => rep.shopId === taxConfig.activeShopId && rep.name.trim());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cashDiscount, setCashDiscount] = useState<number>(0); // manual absolute currency amount off
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Credit Card' | 'Debit Card' | 'QR Code' | 'Bank Transfer' | 'Mobile Wallet' | 'Credit Account'>('Cash');
  const [cashReceived, setCashReceived] = useState<string>('');
  const [wholesaleMetaDraft, setWholesaleMetaDraft] = useState({
    transportCharges: '',
    deliveryCharges: '',
    warrantyInformation: '',
    dispatchMethod: '',
    vehicleNumber: '',
    deliveryNoteNumber: '',
    batchNumber: '',
    supplierReference: '',
    deliveryStatus: '',
  });
  const [barcodeBuffer, setBarcodeBuffer] = useState('');
  const [barcodeNotification, setBarcodeNotification] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [lastScannedItem, setLastScannedItem] = useState<{ label: string; code: string } | null>(null);
  const [showQRFeature, setShowQRFeature] = useState(false);

  // AI Cross sell state
  const [aiCrossSells, setAiCrossSells] = useState<any[]>([]);
  const [isLoadingCross, setIsLoadingCross] = useState(false);

  // Completed transaction receipt modal
  const [receiptModel, setReceiptModel] = useState<SalesTransaction | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCopyType, setSelectedCopyType] = useState<InvoiceCopyType>('Duplicate Copy');
  const [isLoggingPrint, setIsLoggingPrint] = useState(false);
  const [invoicePrintHistory, setInvoicePrintHistory] = useState<Array<{ copyType: InvoiceCopyType; printSequence: number; printedBy: string; printedAt: string }>>([]);
  const [isLoadingPrintHistory, setIsLoadingPrintHistory] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isLoadingPrintAudit, setIsLoadingPrintAudit] = useState(false);
  const [printAuditRows, setPrintAuditRows] = useState<InvoicePrintAuditRow[]>([]);
  const [printAuditSummary, setPrintAuditSummary] = useState<{ totalRows: number; uniqueInvoices: number; uniquePrintedByCount: number }>({
    totalRows: 0,
    uniqueInvoices: 0,
    uniquePrintedByCount: 0,
  });
  const [auditUserOptions, setAuditUserOptions] = useState<string[]>([]);
  const [shareEmailTo, setShareEmailTo] = useState('');
  const [shareWhatsAppTo, setShareWhatsAppTo] = useState('');
  const [isSharingEmail, setIsSharingEmail] = useState(false);
  const [isSharingWhatsApp, setIsSharingWhatsApp] = useState(false);
  const [isExportingAuditCsv, setIsExportingAuditCsv] = useState(false);
  const [printAuditFilters, setPrintAuditFilters] = useState({
    fromDate: '',
    toDate: '',
    copyType: '' as '' | InvoiceCopyType,
    status: '' as '' | 'Completed' | 'Refunded',
    printedBy: '',
    invoiceNumber: '',
  });

  useEffect(() => {
    const normalize = (value?: string) => {
      const text = String(value || '').trim();
      return text === '-' ? '' : text;
    };
    setBillingCustomerName(normalize(selectedCustomer.name));
    setBillingCustomerPhone(normalize(selectedCustomer.phone));
    setBillingCustomerAddress(normalize(selectedCustomer.address));
  }, [selectedCustomer.id]);

  const availableWholesaleCustomers = customers.filter((c) => c.id !== 'cust-walkin' && c.shopId === taxConfig.activeShopId && (c.name + ' ' + c.phone + ' ' + c.address).toLowerCase().includes(customerSearch.trim().toLowerCase()));

  const categories = [
    'All',
    ...Array.from(
      new Set(
        products
          .map((product) => product.category.trim())
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right)),
  ];

  // Filter products based on search or Category tab selection
  const filteredProducts = products.filter((product) => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const variantBlob = (product.variants || [])
      .map((variant) => {
        const attrs = Object.entries(variant.attributes || {}).map(([key, value]) => `${key}:${value}`).join(' ');
        return [variant.name, variant.sku, variant.barcode, attrs].join(' ');
      })
      .join(' ')
      .toLowerCase();
    const matchesSearch =
      product.name.toLowerCase().includes(normalizedSearch) ||
      product.sku.toLowerCase().includes(normalizedSearch) ||
      product.barcode.includes(searchTerm) ||
      (!!product.internalCode && isAdminSeller && product.internalCode.toLowerCase().includes(normalizedSearch)) ||
      variantBlob.includes(normalizedSearch);
    const matchesCategory = selectedCategory === 'All' || product.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Fetch AI cross sells when the cart contents change
  useEffect(() => {
    if (cart.length === 0) {
      setAiCrossSells([]);
      return;
    }

    const fetchCrossSells = async () => {
      setIsLoadingCross(true);
      try {
        const itemIds = cart.map((i) => i.product.id);
        const res = await authFetch('/api/ai/predict-complementary', {
          method: 'POST',
          body: JSON.stringify({ currentCartIds: itemIds }),
        });
        const data = await res.json();
        setAiCrossSells(data.suggestions || []);
      } catch (err) {
        console.error('Failed to generate complementary products suggestions:', err);
      } finally {
        setIsLoadingCross(false);
      }
    };

    // Debounce a little bit
    const delay = setTimeout(() => {
      fetchCrossSells();
    }, 450);

    return () => clearTimeout(delay);
  }, [cart]);

  useEffect(() => {
    let lastKeyAt = 0;
    let buffer = '';

    const resetNotification = (msg: string, type: 'ok' | 'err') => {
      setBarcodeNotification({ msg, type });
      window.setTimeout(() => setBarcodeNotification(null), 1800);
    };

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isTypingField = tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable;
      if (isTypingField) {
        return;
      }

      const now = Date.now();
      const gap = now - lastKeyAt;
      if (gap > 50) {
        buffer = '';
      }
      lastKeyAt = now;

      if (event.key === 'Enter') {
        if (buffer.length >= 4) {
          const scannedCode = buffer;
          setBarcodeBuffer(scannedCode);
          const match = resolveScanMatch(scannedCode);
          if (match) {
            addToCart(match.product, match.variant);
            const label = match.variant ? `${match.product.name} (${match.variant.name})` : match.product.name;
            resetNotification(`Scanned: ${label}`, 'ok');
            setLastScannedItem({ label, code: scannedCode });
            window.setTimeout(() => {
              setLastScannedItem((current) => (current?.code === scannedCode ? null : current));
            }, 4500);
          } else {
            resetNotification(`Barcode not found: ${scannedCode}`, 'err');
          }
        }
        buffer = '';
        return;
      }

      if (event.key.length === 1) {
        buffer += event.key;
        setBarcodeBuffer(buffer);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [products, cart, selectedVariantByProduct]);

  const getCartKey = (item: CartItem) => `${item.product.id}::${item.variantId || 'base'}`;

  const getSelectedVariant = (product: Product): ProductVariant | undefined => {
    if (!Array.isArray(product.variants) || product.variants.length === 0) {
      return undefined;
    }
    const selectedId = selectedVariantByProduct[product.id];
    return product.variants.find((variant) => variant.id === selectedId) || product.variants[0];
  };

  const resolveScanMatch = (rawCode: string): { product: Product; variant?: ProductVariant } | null => {
    const scannedCode = String(rawCode || '').trim();
    if (!scannedCode) {
      return null;
    }
    const normalizedScannedCode = scannedCode.toLowerCase();

    for (const product of products) {
      if (
        product.barcode === scannedCode
        || product.sku.toLowerCase() === normalizedScannedCode
        || (!!product.internalCode && product.internalCode.toLowerCase() === normalizedScannedCode)
      ) {
        return { product, variant: getSelectedVariant(product) };
      }

      for (const variant of (product.variants || [])) {
        if (variant.barcode === scannedCode || variant.sku.toLowerCase() === normalizedScannedCode) {
          return { product, variant };
        }
      }
    }

    return null;
  };

  // Handle adding a product (or variant) to register cart
  const addToCart = (product: Product, variant?: ProductVariant) => {
    const resolvedVariant = variant || getSelectedVariant(product);
    const productStock = Number(product.quantity || 0);
    const variantStock = resolvedVariant ? Number(resolvedVariant.quantity || 0) : productStock;
    if (variantStock <= 0) {
      return;
    }

    const existing = cart.find((item) => item.product.id === product.id && (item.variantId || '') === (resolvedVariant?.id || ''));
    const key = `${product.id}::${resolvedVariant?.id || 'base'}`;
    if (existing) {
      updateCartQty(key, existing.quantity + 1);
      return;
    }

    setCart([
      ...cart,
      {
        product,
        quantity: 1,
        discount: 0,
        variantId: resolvedVariant?.id,
        variantName: resolvedVariant?.name,
        variantUnit: resolvedVariant?.unit,
        variantSku: resolvedVariant?.sku,
        variantBarcode: resolvedVariant?.barcode,
        unitPrice: resolvedVariant?.sellingPrice,
        unitCostPrice: resolvedVariant?.costPrice,
      },
    ]);
  };

  // Modify cart item quantity
  const updateCartQty = (itemKey: string, numericNewQty: number) => {
    const nextQty = Math.floor(Number(numericNewQty) || 0);
    if (nextQty <= 0) {
      removeFromCart(itemKey);
      return;
    }
    const updated = cart.map((item) => {
      if (getCartKey(item) === itemKey) {
        return { ...item, quantity: nextQty };
      }
      return item;
    });
    setCart(updated);
  };

  // Modify individual item discount percentage
  const updateItemDiscount = (itemKey: string, discountPct: number) => {
    const parsed = Math.min(100, Math.max(0, discountPct));
    const updated = cart.map((item) => {
      if (getCartKey(item) === itemKey) {
        return { ...item, discount: parsed };
      }
      return item;
    });
    setCart(updated);
  };

  const updateItemDiscountAmount = (itemKey: string, amount: number) => {
    const updated = cart.map((item) => {
      if (getCartKey(item) === itemKey) {
        return { ...item, discountAmount: Math.max(0, amount || 0) };
      }
      return item;
    });
    setCart(updated);
  };

  // Remove a product from register cart
  const removeFromCart = (itemKey: string) => {
    setCart(cart.filter((item) => getCartKey(item) !== itemKey));
  };

  const getLinePricing = (item: CartItem) => {
    const unitPrice = Number(item.unitPrice ?? item.product.sellingPrice) || 0;
    const gross = unitPrice * item.quantity;
    const percentDiscount = Math.min(100, Math.max(0, item.discount || 0));
    const percentAdjusted = gross * (1 - percentDiscount / 100);
    const rupeeDiscount = Math.min(percentAdjusted, Math.max(0, item.discountAmount || 0));
    const lineTotal = Math.max(0, percentAdjusted - rupeeDiscount);
    const lineDiscountTotal = gross - lineTotal;
    return {
      gross,
      percentDiscount,
      rupeeDiscount,
      lineTotal,
      lineDiscountTotal,
    };
  };

  const grossSubtotal = cart.reduce((acc, item) => acc + getLinePricing(item).gross, 0);
  const itemDiscountTotal = cart.reduce((acc, item) => acc + getLinePricing(item).lineDiscountTotal, 0);
  const subtotal = cart.reduce((acc, item) => acc + roundMoney(getLinePricing(item).lineTotal), 0);

  const { tax, total } = invoiceTotals(subtotal, taxConfig.taxRate, cashDiscount);
  const numericCashReceived = Number(cashReceived) || 0;
  const changeDue = paymentMethod === 'Cash' ? Math.max(0, Math.round((numericCashReceived - total) * 100) / 100) : 0;
  const cashShortage = paymentMethod === 'Cash' && numericCashReceived < total;
  const creditLimit = Number(selectedCustomer.creditLimit || 0);
  const currentCreditBalance = Number(selectedCustomer.creditBalance || 0);
  const projectedCreditBalance = currentCreditBalance + total;
  const creditExceeded = paymentMethod === 'Credit Account' && projectedCreditBalance > creditLimit;
  const creditAccountAllowed = selectedCustomer.id !== 'cust-walkin' && creditLimit > 0 && !creditExceeded;

  const resolvePaymentStatus = (tx: SalesTransaction) => {
    if (tx.status === 'Refunded') return 'CANCELLED';
    if (tx.paymentMethod === 'Credit Account') return 'CREDIT SALE';
    const paidAmount = Number(tx.cashReceived ?? tx.total);
    if (paidAmount <= 0) return 'UNPAID';
    if (paidAmount < Number(tx.total || 0)) return 'PARTIALLY PAID';
    return 'PAID';
  };

  const receiptCustomerRecord = receiptModel ? customers.find((customer) => customer.id === receiptModel.customerId) : undefined;
  const receiptOutstandingBalance = Number(receiptCustomerRecord?.creditBalance || 0);
  const receiptCreditLimit = Number(receiptCustomerRecord?.creditLimit || 0);
  const receiptAvailableCredit = Math.max(0, receiptCreditLimit - receiptOutstandingBalance);
  const receiptCurrentPayment = receiptModel
    ? (receiptModel.paymentMethod === 'Credit Account' ? 0 : Number(receiptModel.cashReceived ?? receiptModel.total))
    : 0;
  const receiptRemainingBalance = receiptModel
    ? Math.max(0, receiptOutstandingBalance + Number(receiptModel.total || 0) - receiptCurrentPayment)
    : 0;
  const receiptPaymentStatus = receiptModel ? resolvePaymentStatus(receiptModel) : 'PAID';
  const receiptPaymentStatusClass = receiptPaymentStatus === 'PAID'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : receiptPaymentStatus === 'PARTIALLY PAID'
      ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
      : receiptPaymentStatus === 'UNPAID'
        ? 'bg-rose-100 text-rose-800 border-rose-300'
        : receiptPaymentStatus === 'CREDIT SALE'
          ? 'bg-blue-100 text-blue-800 border-blue-300'
          : 'bg-slate-200 text-slate-700 border-slate-300';

  const inferUnitLabel = (productName: string) => {
    const name = String(productName || '').toLowerCase();
    if (name.includes('bag')) return 'Bag';
    if (name.includes('pipe') || name.includes('bulb') || name.includes('hammer')) return 'Piece';
    if (name.includes('kg')) return 'Kg';
    return 'Unit';
  };

  const logInvoicePrint = async (tx: SalesTransaction, copyType?: InvoiceCopyType) => {
    const response = await authFetch(`/api/transactions/${tx.id}/print`, {
      method: 'POST',
      body: JSON.stringify({ copyType }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to log invoice print');
    }
    return data as {
      printLog: { copyType: InvoiceCopyType; printSequence: number; printedBy: string; printedAt: string };
      printSummary: { watermarkText: string; secondaryWatermarkText?: string; totalPrints: number; isReprint: boolean };
    };
  };

  const loadInvoicePrintHistory = async (tx: SalesTransaction) => {
    setIsLoadingPrintHistory(true);
    try {
      const response = await authFetch(`/api/transactions/${tx.id}/print-logs`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load print history');
      }
      const logs = Array.isArray(data.logs) ? data.logs : [];
      setInvoicePrintHistory(logs);
    } catch {
      setInvoicePrintHistory([]);
    } finally {
      setIsLoadingPrintHistory(false);
    }
  };

  const downloadInvoicePdf = async (
    tx: SalesTransaction,
    printMeta?: {
      copyType: InvoiceCopyType;
      printSequence: number;
      watermarkText: string;
      secondaryWatermarkText?: string;
      printedBy?: string;
      printedAt?: string;
    }
  ) => {
    const query = new URLSearchParams({
      copyType: printMeta?.copyType || 'Original Copy',
      printSequence: String(printMeta?.printSequence || 1),
      watermark: printMeta?.watermarkText || 'ORIGINAL COPY',
      secondaryWatermark: printMeta?.secondaryWatermarkText || '',
      printedBy: printMeta?.printedBy || '',
      printedAt: printMeta?.printedAt || '',
    });
    const response = await authFetch(`/api/transactions/${tx.id}/pdf?${query.toString()}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Failed to generate PDF' }));
      throw new Error(payload.error || 'Failed to generate PDF');
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const fileName = 'invoice.pdf';
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  };

  const sendInvoiceEmail = async (tx: SalesTransaction, copyType: InvoiceCopyType, printSequence: number) => {
    const response = await authFetch(`/api/transactions/${tx.id}/share/email`, {
      method: 'POST',
      body: JSON.stringify({
        to: shareEmailTo,
        copyType,
        printSequence,
      }),
    });
    const data = await response.json().catch(() => ({ error: 'Failed to share via email' }));
    if (!response.ok) {
      throw new Error(data.error || 'Failed to share via email');
    }
    return data;
  };

  const sendInvoiceWhatsApp = async (tx: SalesTransaction, copyType: InvoiceCopyType, printSequence: number) => {
    const response = await authFetch(`/api/transactions/${tx.id}/share/whatsapp`, {
      method: 'POST',
      body: JSON.stringify({
        to: shareWhatsAppTo,
        copyType,
        printSequence,
      }),
    });
    const data = await response.json().catch(() => ({ error: 'Failed to share via WhatsApp' }));
    if (!response.ok) {
      throw new Error(data.error || 'Failed to share via WhatsApp');
    }
    return data;
  };

  const exportInvoicePrintAuditCsv = async (filters?: typeof printAuditFilters) => {
    const activeFilters = filters || printAuditFilters;
    const query = new URLSearchParams();
    if (activeFilters.fromDate) query.set('fromDate', activeFilters.fromDate);
    if (activeFilters.toDate) query.set('toDate', activeFilters.toDate);
    if (activeFilters.copyType) query.set('copyType', activeFilters.copyType);
    if (activeFilters.status) query.set('status', activeFilters.status);
    if (activeFilters.printedBy) query.set('printedBy', activeFilters.printedBy);
    if (activeFilters.invoiceNumber) query.set('invoiceNumber', activeFilters.invoiceNumber.trim());

    const response = await authFetch(`/api/invoice-print-audit/export.csv?${query.toString()}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: 'Failed to export CSV' }));
      throw new Error(data.error || 'Failed to export CSV');
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'invoice-print-audit.csv';
    link.click();
    URL.revokeObjectURL(downloadUrl);
  };

  const loadInvoicePrintAudit = async (filters?: typeof printAuditFilters) => {
    const activeFilters = filters || printAuditFilters;
    setIsLoadingPrintAudit(true);
    try {
      const query = new URLSearchParams();
      if (activeFilters.fromDate) query.set('fromDate', activeFilters.fromDate);
      if (activeFilters.toDate) query.set('toDate', activeFilters.toDate);
      if (activeFilters.copyType) query.set('copyType', activeFilters.copyType);
      if (activeFilters.status) query.set('status', activeFilters.status);
      if (activeFilters.printedBy) query.set('printedBy', activeFilters.printedBy);
      if (activeFilters.invoiceNumber) query.set('invoiceNumber', activeFilters.invoiceNumber.trim());
      query.set('page', '1');
      query.set('pageSize', '20');

      const response = await authFetch(`/api/invoice-print-audit?${query.toString()}`);
      const data = await response.json() as InvoicePrintAuditResponse;
      if (!response.ok) {
        throw new Error((data as any).error || 'Failed to load invoice print audit report');
      }
      setPrintAuditRows(Array.isArray(data.rows) ? data.rows : []);
      setPrintAuditSummary(data.summary || { totalRows: 0, uniqueInvoices: 0, uniquePrintedByCount: 0 });
      setAuditUserOptions(Array.isArray(data.uniquePrintedBy) ? data.uniquePrintedBy : []);
    } catch {
      setPrintAuditRows([]);
      setPrintAuditSummary({ totalRows: 0, uniqueInvoices: 0, uniquePrintedByCount: 0 });
      setAuditUserOptions([]);
    } finally {
      setIsLoadingPrintAudit(false);
    }
  };

  useEffect(() => {
    if (!receiptModel) {
      setInvoicePrintHistory([]);
      setPrintAuditRows([]);
      setShareEmailTo('');
      setShareWhatsAppTo('');
      return;
    }
    const selectedCustomerRecord = customers.find((customer) => customer.id === receiptModel.customerId);
    setShareEmailTo(selectedCustomerRecord?.email && selectedCustomerRecord.email !== '-' ? selectedCustomerRecord.email : '');
    setShareWhatsAppTo((receiptModel.customerPhone && receiptModel.customerPhone !== '-') ? receiptModel.customerPhone : '');
    loadInvoicePrintHistory(receiptModel);
    loadInvoicePrintAudit();
  }, [receiptModel?.id]);

  const createPrintWindow = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=900');
    if (!printWindow) {
      notify.warning('Popup blocked. Please allow popups and try printing again.');
      return null;
    }

    printWindow.document.open();
    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Preparing Receipt</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; color: #0f172a; background: #f8fafc; }
            .status { text-align: center; }
            .status h1 { margin: 0 0 8px; font-size: 20px; }
            .status p { margin: 0; color: #64748b; }
          </style>
        </head>
        <body>
          <div class="status">
            <h1>Preparing receipt</h1>
            <p>Your invoice is being generated for printing.</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    return printWindow;
  };

  const printReceiptInvoice = (
    tx: SalesTransaction,
    existingWindow?: Window | null,
    printMeta?: {
      copyType: InvoiceCopyType;
      watermarkText: string;
      secondaryWatermarkText?: string;
      printSequence: number;
      isReprint: boolean;
      printedBy?: string;
      printedAt?: string;
    }
  ) => {
    const printWindow = existingWindow || createPrintWindow();
    if (!printWindow) {
      return;
    }
    const invoiceQrData = tx.invoiceQrData || '';
    const copyLabel = printMeta?.copyType || 'Original Copy';
    const watermarkLabel = printMeta?.watermarkText || copyLabel.toUpperCase();

    if (effectivePrintFormat === 'thermal') {
      const thermalRows = tx.items
        .map((itm) => {
          const discountPct = Number(itm.discount || 0);
          const lineUnit = Number(itm.sellingPrice || 0);
          const lineQty = Number(itm.quantity || 0);
          const gross = lineUnit * lineQty;
          const percentAdjusted = gross * (1 - discountPct / 100);
          const lineDiscountAmount = Math.min(percentAdjusted, Number(itm.discountAmount || 0));
          const lineTotal = Math.max(0, percentAdjusted - lineDiscountAmount);
          return `
            <div class="item-row">
              <div class="item-name">${escapeHtml(itm.productName)}</div>
              <div class="item-meta">${lineQty} x ${escapeHtml(formatMoney(lineUnit))} ${discountPct > 0 ? `@-${discountPct.toFixed(0)}%` : ''} ${lineDiscountAmount > 0 ? `@-${escapeHtml(formatMoney(lineDiscountAmount))}` : ''}</div>
              <div class="item-line-total">${escapeHtml(formatMoney(lineTotal))}</div>
            </div>
          `;
        })
        .join('');

      const itemDiscountTotal = tx.items.reduce((acc, itm) => {
        const gross = Number(itm.sellingPrice || 0) * Number(itm.quantity || 0);
        const percentAdjusted = gross * (1 - Number(itm.discount || 0) / 100);
        const lineDiscountAmount = Math.min(percentAdjusted, Number(itm.discountAmount || 0));
        return acc + (gross - Math.max(0, percentAdjusted - lineDiscountAmount));
      }, 0);

      const thermalHtml = `
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Receipt ${escapeHtml(tx.invoiceNumber)}</title>
            <style>
              @page { size: 80mm 220mm; margin: 2mm; }
              html, body { width: 80mm; margin: 0; padding: 0; }
              body {
                font-family: 'Courier New', monospace;
                color: #111;
                font-size: 11px;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
                background: #fff;
              }
              .receipt {
                width: 76mm;
                margin: 0 auto;
                padding: 4mm 2mm 3mm;
                box-sizing: border-box;
              }
              .center { text-align: center; }
              .head {
                border-bottom: 1px dashed #444;
                padding-bottom: 8px;
                margin-bottom: 8px;
              }
              .shop {
                font-size: 15px;
                font-weight: 800;
                line-height: 1.1;
                letter-spacing: 0.3px;
              }
              .meta { margin: 2px 0; line-height: 1.35; }
              .meta-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 2px 8px;
                margin-top: 6px;
                font-size: 10px;
              }
              .meta-grid div { white-space: normal; overflow: hidden; text-overflow: ellipsis; line-height: 1.35; }
              .customer-line {
                margin-top: 5px;
                font-size: 10px;
                line-height: 1.35;
                word-break: break-word;
              }
              .line { border-bottom: 1px dashed #444; margin: 8px 0; }
              .item-row {
                padding: 6px 0;
                border-bottom: 1px dotted #777;
              }
              .item-row:last-child { border-bottom: none; }
              .item-name { font-weight: 700; line-height: 1.25; }
              .item-meta {
                color: #333;
                font-size: 10px;
                margin-top: 2px;
                display: flex;
                justify-content: space-between;
                gap: 8px;
              }
              .item-line-total { text-align: right; font-weight: 800; margin-top: 3px; }
              .sum-row {
                display: flex;
                justify-content: space-between;
                margin: 4px 0;
                gap: 10px;
              }
              .grand {
                font-size: 14px;
                font-weight: 900;
                border-top: 1px dashed #444;
                margin-top: 6px;
                padding-top: 6px;
              }
              .muted { color: #333; }
              .badge {
                display: inline-block;
                padding: 2px 6px;
                border: 1px solid #333;
                border-radius: 999px;
                font-size: 9px;
                margin-top: 4px;
              }
              .sign-wrap {
                margin-top: 8px;
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
                align-items: end;
              }
              .sig-box {
                border-top: 1px solid #666;
                padding-top: 5px;
                text-align: center;
                font-size: 9px;
                color: #334155;
              }
              .sig-line {
                font-size: 11px;
                letter-spacing: 0.06em;
                margin-bottom: 2px;
              }
              .stamp-box {
                border: 1.5px dashed #ef4444;
                border-radius: 8px;
                color: #ef4444;
                text-align: center;
                font-size: 8px;
                font-weight: 800;
                padding: 5px 4px;
                line-height: 1.2;
                transform: rotate(-4deg);
              }
              .wm {
                text-align: center;
                margin: 6px 0;
                font-size: 10px;
                font-weight: 800;
                letter-spacing: 0.08em;
                color: #1d4ed8;
              }
            </style>
          </head>
          <body>
            <section class="receipt">
              <div class="wm">${escapeHtml(watermarkLabel)}</div>
              ${thermalShopLogoMarkup}
              <div class="head center">
                <div class="shop">${escapeHtml(activeShopName)}</div>
                <div class="meta">${escapeHtml(shopAddress)}</div>
                <div class="meta">${escapeHtml(shopPhone)}</div>
                <div class="badge">${escapeHtml(tx.paymentMethod)} • ${escapeHtml(copyLabel)}</div>
              </div>

              <div class="meta-grid">
                <div><strong>Invoice:</strong> ${escapeHtml(tx.invoiceNumber)}</div>
                <div><strong>Date:</strong> ${escapeHtml(new Date(tx.date).toLocaleString())}</div>
                <div><strong>Sales Representative:</strong> ${escapeHtml(tx.salesRepName || 'Not recorded')}</div>
              </div>
              <div class="customer-line">
                <div><strong>Customer:</strong> ${escapeHtml(tx.customerName)}</div>
                ${tx.customerPhone ? `<div><strong>Phone:</strong> ${escapeHtml(tx.customerPhone)}</div>` : ''}
                ${tx.customerAddress ? `<div><strong>Address:</strong> ${escapeHtml(tx.customerAddress)}</div>` : ''}
              </div>
              <div class="line"></div>

              ${thermalRows}
              <div class="line"></div>

              ${itemDiscountTotal > 0 ? `<div class="sum-row"><span>Item Discounts</span><strong>-${escapeHtml(formatMoney(itemDiscountTotal))}</strong></div>` : ''}
              <div class="sum-row"><span>Subtotal</span><strong>${escapeHtml(formatMoney(tx.subtotal))}</strong></div>
              ${tx.discountAmount > 0 ? `<div class="sum-row"><span>Discount</span><strong>-${escapeHtml(formatMoney(tx.discountAmount))}</strong></div>` : ''}
              <div class="sum-row"><span>Tax</span><strong>${escapeHtml(formatMoney(tx.tax))}</strong></div>
              <div class="sum-row grand"><span>Total</span><strong>${escapeHtml(formatMoney(tx.total))}</strong></div>
              ${tx.paymentMethod === 'Cash' ? `<div class="sum-row"><span>Cash Received</span><strong>${escapeHtml(formatMoney(tx.cashReceived ?? tx.total))}</strong></div><div class="sum-row"><span>Change Due</span><strong>${escapeHtml(formatMoney(tx.changeDue ?? 0))}</strong></div>` : ''}

              <div class="sign-wrap">
                <div class="sig-box">
                  <div class="sig-line">________________</div>
                  <div>Sales Representative</div>
                  <div>${escapeHtml(tx.salesRepName || 'Not recorded')}</div>
                </div>
                <div class="stamp-box">
                  <div>SHOP</div>
                  <div>RUBBER STAMP</div>
                  <div>${escapeHtml(activeShopName)}</div>
                </div>
              </div>

              <div class="center muted" style="margin-top: 8px;">${invoiceFooter.goods}<br>${invoiceFooter.thanks}<br><small>${invoiceFooter.credit}</small></div>
            </section>
            <script>
              setTimeout(() => {
                window.print();
                setTimeout(() => window.close(), 250);
              }, 180);
            <\/script>
          </body>
        </html>
      `;

      printWindow.document.open();
      printWindow.document.write(thermalHtml);
      printWindow.document.close();
      printWindow.focus();
      return;
    }

      if (isWholesaleShop) {
        const issueDate = new Date(tx.date);
        const dueDate = new Date(issueDate);
        dueDate.setDate(dueDate.getDate() + 30);
        const formatDate = (date: Date) => date.toLocaleDateString('en-GB');
        const customerRecord = customers.find((customer) => customer.id === tx.customerId);
        const previousBalance = Number(customerRecord?.creditBalance || 0);
        const creditLimit = Number(customerRecord?.creditLimit || 0);
        const currentPayment = tx.paymentMethod === 'Credit Account' ? 0 : Number(tx.cashReceived ?? tx.total);
        const remainingBalance = Math.max(0, previousBalance + Number(tx.total) - currentPayment);
        const availableCreditLimit = Math.max(0, creditLimit - previousBalance);
        const wholesaleMeta = tx.wholesaleMeta || {};
        const statusLabel = tx.paymentStatus || resolvePaymentStatus(tx);
        const statusClass = statusLabel === 'PAID'
          ? 'status-paid'
          : statusLabel === 'PARTIALLY PAID'
            ? 'status-partial'
            : statusLabel === 'UNPAID'
              ? 'status-unpaid'
              : statusLabel === 'CREDIT SALE'
                ? 'status-credit'
                : 'status-cancelled';
        const secondaryWatermark = copyLabel === 'Reprinted Invoice' ? 'DUPLICATE COPY' : '';
        const watermarkOpacity = 0.12;

        const wholesaleRowsHtml = tx.items
          .map((itm) => {
            const productRef = products.find((product) => product.id === itm.productId);
            const variantRef = productRef?.variants?.find((variant) => variant.id === itm.variantId);
            const discountPct = Number(itm.discount || 0);
            const lineUnit = Number(itm.sellingPrice || 0);
            const lineQty = Number(itm.quantity || 0);
            const gross = lineUnit * lineQty;
            const percentAdjusted = gross * (1 - discountPct / 100);
            const lineDiscountAmount = Math.min(percentAdjusted, Number(itm.discountAmount || 0));
            const lineTotal = Math.max(0, percentAdjusted - lineDiscountAmount);
            const variantLabel = itm.variantName || variantRef?.name || '-';
            const unitLabel = itm.variantUnit || variantRef?.unit || inferUnitLabel(itm.productName);
            const brandLabel = productRef?.brand || '-';
            const itemCode = itm.variantSku || variantRef?.sku || itm.productId || '-';
            const discountLabel = discountPct > 0
              ? `${discountPct.toFixed(0)}%`
              : (lineDiscountAmount > 0 ? formatMoney(lineDiscountAmount) : '-');
            return `
              <tr>
                <td>${escapeHtml(itemCode)}</td>
                <td>${escapeHtml(itm.productName)}</td>
                <td>${escapeHtml(brandLabel)}</td>
                <td>${escapeHtml(variantLabel)}</td>
                <td>${escapeHtml(unitLabel)}</td>
                <td class="right">${lineQty}</td>
                <td class="right">${escapeHtml(formatMoney(lineUnit))}</td>
                <td class="right">${escapeHtml(discountLabel)}</td>
                <td class="right">${escapeHtml(formatMoney(lineTotal))}</td>
              </tr>
            `;
          })
          .join('');

        const wholesaleHtml = `
          <!doctype html>
          <html>
            <head>
              <meta charset="utf-8" />
              <title>Wholesale Invoice ${escapeHtml(tx.invoiceNumber)}</title>
              <style>
                @page { size: A4; margin: 8mm; }
                * { box-sizing: border-box; }
                body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; background: #ffffff; }
                .sheet { border: 1px solid #cbd5e1; border-radius: 10px; position: relative; overflow: hidden; }
                .header { padding: 14px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
                .header-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; align-items: start; }
                .company h1 { margin: 0; font-size: 26px; letter-spacing: 0.02em; }
                .company p { margin: 2px 0; font-size: 12px; color: #334155; }
                .legal { margin-top: 6px; padding: 8px; border: 1px dashed #cbd5e1; border-radius: 8px; font-size: 11px; }
                .meta { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background: #fff; }
                .meta .row { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 4px; }
                .badge { display: inline-block; margin-top: 6px; padding: 6px 11px; border-radius: 999px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 800; }
                .status-paid { background: #dcfce7; color: #166534; }
                .status-partial { background: #fef9c3; color: #854d0e; }
                .status-unpaid { background: #fee2e2; color: #991b1b; }
                .status-credit { background: #dbeafe; color: #1d4ed8; }
                .status-cancelled { background: #e5e7eb; color: #374151; }
                .body { padding: 12px 16px 16px; }
                .section-title { margin: 12px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #334155; font-weight: 800; }
                .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 9px; background: #fff; }
                .line { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0; font-size: 12px; }
                table { width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; }
                thead th { background: #eff6ff; color: #334155; padding: 7px 6px; border-bottom: 1px solid #cbd5e1; font-size: 10px; text-transform: uppercase; }
                tbody td { padding: 6px; border-bottom: 1px solid #eef2f7; font-size: 11px; }
                tbody tr:last-child td { border-bottom: none; }
                .right { text-align: right; }
                .footer { margin-top: 12px; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 8px; font-size: 11px; color: #475569; }
                .watermark-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
                .wm { transform: rotate(-28deg); font-size: 62px; letter-spacing: 0.18em; font-weight: 800; color: rgba(15, 23, 42, ${watermarkOpacity}); text-transform: uppercase; white-space: nowrap; }
                .wm.secondary { margin-top: 80px; font-size: 42px; color: rgba(30, 58, 138, ${watermarkOpacity}); }
                .reprint-note { margin-top: 4px; font-size: 10px; color: #334155; }
                .qr-wrap { text-align: right; margin-top: 8px; }
                .qr-wrap img { width: 76px; height: 76px; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 6px; }
                @media (max-width: 900px) {
                  .header-grid, .grid-2 { grid-template-columns: 1fr; }
                  .qr-wrap { text-align: left; }
                }
              </style>
            </head>
            <body>
              <section class="sheet">
                <div class="watermark-wrap">
                  <div>
                    <div class="wm">${escapeHtml(watermarkLabel)}</div>
                    ${secondaryWatermark ? `<div class="wm secondary">${escapeHtml(secondaryWatermark)}</div>` : ''}
                  </div>
                </div>
                <div class="header">
                  <div class="header-grid">
                    <div class="company">
                      ${printableShopLogoMarkup}
                      <h1>${escapeHtml(invoiceCompanyMeta.companyLegalName)}</h1>
                      <p>${escapeHtml(invoiceCompanyMeta.companyTagline)}</p>
                      <p>${[shopAddress, shopPhone].filter(Boolean).map(escapeHtml).join(' | ')}</p>
                      <div class="legal">
                        <div>BR No: <strong>${escapeHtml(invoiceCompanyMeta.businessRegistrationNo || '-')}</strong></div>
                        <div>VAT No: <strong>${escapeHtml(invoiceCompanyMeta.vatRegistrationNo || '-')}</strong></div>
                        <div>TIN No: <strong>${escapeHtml(invoiceCompanyMeta.tinNo || '-')}</strong></div>
                      </div>
                    </div>
                    <div class="meta">
                      <div class="row"><span>Invoice No</span><strong>${escapeHtml(tx.invoiceNumber)}</strong></div>
                      <div class="row"><span>Invoice Date</span><strong>${escapeHtml(formatDate(issueDate))}</strong></div>
                      <div class="row"><span>Due Date</span><strong>${escapeHtml(formatDate(dueDate))}</strong></div>
                      <div class="row"><span>Sales Rep</span><strong>${escapeHtml(tx.salesRepName || 'Not recorded')}</strong></div>
                      <span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span>
                      <div class="reprint-note">${escapeHtml(copyLabel)}${printMeta?.isReprint ? ` | Reprint: ${escapeHtml(new Date(printMeta?.printedAt || new Date().toISOString()).toLocaleString())}` : ''}</div>
                    </div>
                  </div>
                </div>

                <div class="body">
                  <div class="grid-2">
                    <div class="box">
                      <div class="section-title" style="margin-top:0;">Customer Details</div>
                      <div class="line"><span>Name</span><strong>${escapeHtml(tx.customerName || '-')}</strong></div>
                      <div class="line"><span>Customer ID</span><strong>${escapeHtml(tx.customerId || '-')}</strong></div>
                      <div class="line"><span>Phone</span><strong>${escapeHtml(tx.customerPhone || '-')}</strong></div>
                      <div class="line"><span>Address</span><strong>${escapeHtml(tx.customerAddress || '-')}</strong></div>
                    </div>
                    <div class="box">
                      <div class="section-title" style="margin-top:0;">Customer Credit Information</div>
                      <div class="line"><span>Outstanding Balance</span><strong>${escapeHtml(formatMoney(previousBalance))}</strong></div>
                      <div class="line"><span>Current Invoice Amount</span><strong>${escapeHtml(formatMoney(Number(tx.total || 0)))}</strong></div>
                      <div class="line"><span>Available Credit Limit</span><strong>${escapeHtml(formatMoney(availableCreditLimit))}</strong></div>
                      <div class="line"><span>Credit Limit</span><strong>${escapeHtml(formatMoney(creditLimit))}</strong></div>
                      <div class="line"><span>Current Payment</span><strong>${escapeHtml(formatMoney(currentPayment))}</strong></div>
                      <div class="line"><span>Remaining Balance</span><strong>${escapeHtml(formatMoney(remainingBalance))}</strong></div>
                    </div>
                  </div>

                  <div class="section-title">Product Table</div>
                  <table>
                    <thead>
                      <tr>
                        <th>Item Code</th>
                        <th>Product Name</th>
                        <th>Brand</th>
                        <th>Variant</th>
                        <th>Unit</th>
                        <th class="right">Quantity</th>
                        <th class="right">Unit Price</th>
                        <th class="right">Discount</th>
                        <th class="right">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody>${wholesaleRowsHtml}</tbody>
                  </table>

                  <div class="grid-2" style="margin-top: 10px;">
                    <div class="box">
                      <div class="section-title" style="margin-top:0;">Hardware Business Information</div>
                      <div class="line"><span>Transport Charges</span><strong>${escapeHtml(formatMoney(Number(wholesaleMeta.transportCharges || 0)))}</strong></div>
                      <div class="line"><span>Delivery Charges</span><strong>${escapeHtml(formatMoney(Number(wholesaleMeta.deliveryCharges || 0)))}</strong></div>
                      <div class="line"><span>Warranty Information</span><strong>${escapeHtml(wholesaleMeta.warrantyInformation || '-')}</strong></div>
                      <div class="line"><span>Dispatch Method</span><strong>${escapeHtml(wholesaleMeta.dispatchMethod || '-')}</strong></div>
                      <div class="line"><span>Vehicle Number</span><strong>${escapeHtml(wholesaleMeta.vehicleNumber || '-')}</strong></div>
                      <div class="line"><span>Delivery Note Number</span><strong>${escapeHtml(wholesaleMeta.deliveryNoteNumber || '-')}</strong></div>
                      <div class="line"><span>Batch Number</span><strong>${escapeHtml(wholesaleMeta.batchNumber || '-')}</strong></div>
                      <div class="line"><span>Supplier Reference</span><strong>${escapeHtml(wholesaleMeta.supplierReference || '-')}</strong></div>
                      <div class="line"><span>Delivery Status</span><strong>${escapeHtml(wholesaleMeta.deliveryStatus || '-')}</strong></div>
                    </div>
                    <div class="box">
                      <div class="section-title" style="margin-top:0;">Invoice Summary</div>
                      <div class="line"><span>Subtotal</span><strong>${escapeHtml(formatMoney(tx.subtotal))}</strong></div>
                      <div class="line"><span>Discount</span><strong>${escapeHtml(formatMoney(tx.discountAmount || 0))}</strong></div>
                      <div class="line"><span>Tax</span><strong>${escapeHtml(formatMoney(tx.tax))}</strong></div>
                      <div class="line" style="font-size:14px;font-weight:800;border-top:1px solid #cbd5e1;padding-top:6px;"><span>Grand Total</span><strong>${escapeHtml(formatMoney(tx.total))}</strong></div>
                      ${invoiceQrData ? `<div class="qr-wrap"><img src="${escapeHtml(invoiceQrData)}" alt="Invoice QR" /><div style="font-size:10px;color:#64748b;margin-top:4px;">Invoice QR</div></div>` : ''}
                    </div>
                  </div>

                  <div style="break-inside:avoid;page-break-inside:avoid;border-top:1px solid #cbd5e1;margin-top:18px;padding-top:12px;">
                    <div style="font-size:11px;font-weight:800;text-align:center;letter-spacing:.08em;margin-bottom:24px;">GOODS VERIFICATION & RECEIPT</div>
                    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;text-align:center;font-size:9px;">
                      ${['Prepared By','Checked By','Authorized By','Received By'].map((label) => `<div><div style="border-bottom:1px solid #64748b;height:22px;"></div><div style="padding-top:7px;">${label} / Signature</div></div>`).join('')}
                    </div>
                    <div style="display:flex;justify-content:space-between;gap:16px;font-size:9px;margin-top:20px;">
                      <span>Receiving Date / Time: __________________</span>
                      <span>Customer Stamp (if applicable): __________________</span>
                    </div>
                    <div style="text-align:center;font-size:9px;margin-top:12px;">${invoiceFooter.acknowledgement}</div>
                  </div>
                  <div class="footer">
                    <div>${invoiceFooter.goods}</div>
                    <div><strong>${invoiceFooter.thanks}</strong></div>
                    <div><small>${invoiceFooter.credit}</small></div>
                    <div style="margin-top:4px;">Support: ${escapeHtml(invoiceCompanyMeta.supportPhone || '-')} | ${escapeHtml(invoiceCompanyMeta.supportEmail || '-')}</div>
                    <div>${escapeHtml(invoiceCompanyMeta.websiteUrl || '-')} ${invoiceCompanyMeta.socialLinks ? `| ${escapeHtml(invoiceCompanyMeta.socialLinks)}` : ''}</div>
                  </div>
                </div>
              </section>
              <script>
                setTimeout(() => {
                  window.print();
                  setTimeout(() => window.close(), 250);
                }, 180);
              <\/script>
            </body>
          </html>
        `;

        printWindow.document.open();
        printWindow.document.write(wholesaleHtml);
        printWindow.document.close();
        printWindow.focus();
        return;
      }

    const rowsHtml = tx.items
      .map((itm) => {
        const discountPct = Number(itm.discount || 0);
        const lineUnit = Number(itm.sellingPrice || 0);
        const lineQty = Number(itm.quantity || 0);
        const gross = lineUnit * lineQty;
        const percentAdjusted = gross * (1 - discountPct / 100);
        const lineDiscountAmount = Math.min(percentAdjusted, Number(itm.discountAmount || 0));
        const lineTotal = Math.max(0, percentAdjusted - lineDiscountAmount);
        return `
          <tr>
            <td>${escapeHtml(itm.productName)}${isWholesaleShop ? `<div class="item-code">Product Code: ${escapeHtml(itm.productId)}</div>` : ''}</td>
            <td class="right">${lineQty}</td>
            <td class="right">${escapeHtml(formatMoney(lineUnit))}</td>
            <td class="right">${discountPct > 0 ? `${discountPct.toFixed(0)}%` : '-'}${lineDiscountAmount > 0 ? ` / ${escapeHtml(formatMoney(lineDiscountAmount))}` : ''}</td>
            <td class="right total">${escapeHtml(formatMoney(lineTotal))}</td>
          </tr>
        `;
      })
      .join('');

    const itemDiscountTotal = tx.items.reduce((acc, itm) => {
      const gross = Number(itm.sellingPrice || 0) * Number(itm.quantity || 0);
      const percentAdjusted = gross * (1 - Number(itm.discount || 0) / 100);
      const lineDiscountAmount = Math.min(percentAdjusted, Number(itm.discountAmount || 0));
      return acc + (gross - Math.max(0, percentAdjusted - lineDiscountAmount));
    }, 0);

    const totalUnits = tx.items.reduce((acc, itm) => acc + Number(itm.quantity || 0), 0);
    const wholesaleTermNote = tx.paymentMethod === 'Credit Account'
      ? 'Credit settlement is governed by your wholesale credit agreement.'
      : 'Payment is due as per agreed wholesale purchase terms.';

    const discountBlock = tx.discountAmount > 0
      ? `
        <div class="row discount">
          <span>Manual Discount</span>
          <strong>-${escapeHtml(formatMoney(tx.discountAmount))}</strong>
        </div>
      `
      : '';

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Invoice ${escapeHtml(tx.invoiceNumber)}</title>
          <style>
              @page { size: A4 portrait; margin: 12mm; }
            body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a; margin: 0; background: #ffffff; }
            .bill { border: 1px solid #dbe4f0; border-radius: 18px; overflow: hidden; }
            .hero { padding: 22px 24px 18px; background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 55%, #fff7ed 100%); border-bottom: 1px solid #dbe4f0; }
            .top { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
            .eyebrow { display: inline-block; margin-bottom: 10px; padding: 4px 10px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
            .eyebrow.wholesale { background: #ffedd5; color: #c2410c; }
            .brand h1 { margin: 0; font-size: 26px; letter-spacing: 0.02em; }
            .brand p { margin: 3px 0; color: #475569; font-size: 12px; }
            .meta { min-width: 220px; padding: 14px 16px; background: rgba(255,255,255,0.85); border: 1px solid #dbe4f0; border-radius: 14px; }
            .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; }
            .meta .label { color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; }
            .meta .value { font-weight: 700; margin-top: 3px; font-size: 13px; }
            .content { padding: 18px 24px 22px; }
            .sub { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 0 0 18px; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; }
            .card .k { color: #64748b; font-size: 10px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.08em; }
            .card .v { font-size: 13px; font-weight: 700; }
            .wholesale-panel {
              margin: 0 0 16px;
              border: 1px solid #fed7aa;
              background: linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%);
              border-radius: 12px;
              padding: 12px 14px;
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 10px;
            }
            .wholesale-panel .k { color: #9a3412; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
            .wholesale-panel .v { color: #7c2d12; font-size: 13px; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; overflow: hidden; border: 1px solid #e2e8f0; border-radius: 12px; }
            thead th { text-align: left; font-size: 11px; color: #475569; background: #eff6ff; border-bottom: 1px solid #dbe4f0; padding: 10px 12px; text-transform: uppercase; letter-spacing: 0.06em; }
            tbody td { border-bottom: 1px solid #eef2f7; padding: 12px; font-size: 12px; vertical-align: top; }
            tbody tr:nth-child(even) { background: #fcfdff; }
            tbody tr:last-child td { border-bottom: none; }
            .item-code { margin-top: 3px; color: #64748b; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; }
            .right { text-align: right; }
            .total { font-weight: 700; }
            .summary-wrap { display: flex; justify-content: space-between; gap: 18px; margin-top: 18px; align-items: flex-start; }
            .notes { flex: 1; padding: 14px 16px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 14px; color: #7c2d12; }
            .notes h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
            .notes p { margin: 0; font-size: 12px; line-height: 1.6; }
            .summary { width: 320px; border: 1px solid #dbe4f0; border-radius: 14px; padding: 14px 16px; background: #ffffff; }
            .row { display: flex; justify-content: space-between; font-size: 12px; padding: 5px 0; }
            .discount { color: #059669; }
            .grand { border-top: 1px solid #dbe4f0; margin-top: 8px; padding-top: 10px; font-size: 16px; font-weight: 800; color: #1e3a8a; }
              .sign-row { display: grid; grid-template-columns: 1fr 140px; gap: 12px; margin-top: 14px; align-items: end; }
              .signature-box { border-top: 1px solid #94a3b8; padding-top: 8px; text-align: center; color: #475569; font-size: 10px; }
              .signature-line { font-family: 'Brush Script MT', 'Segoe Script', cursive; font-size: 18px; color: #0f172a; margin-bottom: 3px; }
              .stamp-box {
                width: 140px;
                height: 92px;
                border: 2px dashed #ef4444;
                border-radius: 16px;
                color: #ef4444;
                text-align: center;
                padding: 10px 8px;
                box-sizing: border-box;
                transform: rotate(-8deg);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                gap: 6px;
                font-weight: 800;
              }
              .stamp-title { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
              .stamp-shop { font-size: 13px; line-height: 1.1; }
              .stamp-note { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; }
            .foot { margin-top: 18px; color: #64748b; font-size: 11px; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 12px; }
            .brand-note { margin-top: 8px; color: #475569; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <section class="bill">
            <div class="hero">
              <header class="top">
                <div class="brand">
                  <span class="eyebrow ${isWholesaleShop ? 'wholesale' : ''}">${isWholesaleShop ? 'Wholesale Tax Invoice' : 'Customer Invoice'}</span>
                  ${printableShopLogoMarkup}
                  <h1>${escapeHtml(activeShopName)}</h1>
                  <p>${escapeHtml(shopAddress)}</p>
                  ${shopPhone ? '<p>Phone: ' + escapeHtml(shopPhone) + '</p>' : ''}
                </div>
                <div class="meta">
                  <div class="meta-grid">
                    <div>
                      <div class="label">Invoice No</div>
                      <div class="value">${escapeHtml(tx.invoiceNumber)}</div>
                    </div>
                    <div>
                      <div class="label">Issued At</div>
                      <div class="value">${escapeHtml(new Date(tx.date).toLocaleString())}</div>
                    </div>
                    <div>
                      <div class="label">Customer</div>
                      <div class="value">${escapeHtml(tx.customerName)}</div>
                    </div>
                    <div>
                      <div class="label">Phone</div>
                      <div class="value">${escapeHtml(tx.customerPhone || '-')}</div>
                    </div>
                    <div style="grid-column: span 2;">
                      <div class="label">Address</div>
                      <div class="value">${escapeHtml(tx.customerAddress || '-')}</div>
                    </div>
                    <div>
                      <div class="label">Payment</div>
                      <div class="value">${escapeHtml(tx.paymentMethod)}</div>
                    </div>
                  </div>
                </div>
              </header>
            </div>

            <div class="content">
              <div class="sub">
                <div class="card"><div class="k">Sales Representative</div><div class="v">${escapeHtml(tx.salesRepName || 'Not recorded')}</div></div>
                <div class="card"><div class="k">Line Items</div><div class="v">${escapeHtml(String(tx.items.length))}</div></div>
                <div class="card"><div class="k">Total Units</div><div class="v">${escapeHtml(String(totalUnits))}</div></div>
                <div class="card"><div class="k">Tax Rate</div><div class="v">${escapeHtml(`${taxConfig.taxRate.toFixed(1)}%`)}</div></div>
                <div class="card"><div class="k">Currency</div><div class="v">LKR / Rs.</div></div>
              </div>

              ${isWholesaleShop ? `
                <div class="wholesale-panel">
                  <div>
                    <div class="k">Buyer Phone</div>
                    <div class="v">${escapeHtml(tx.customerPhone || '-')}</div>
                  </div>
                  <div>
                    <div class="k">Buyer Address</div>
                    <div class="v">${escapeHtml(tx.customerAddress || '-')}</div>
                  </div>
                  <div>
                    <div class="k">Trade Terms</div>
                    <div class="v">${escapeHtml(wholesaleTermNote)}</div>
                  </div>
                </div>
              ` : ''}

              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th class="right">Qty</th>
                    <th class="right">Unit</th>
                    <th class="right">Discount</th>
                    <th class="right">Line Total</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>

              <div class="summary-wrap">
                <div class="notes">
                  <h3>${isWholesaleShop ? 'Wholesale Notes' : 'Billing Notes'}</h3>
                  <p>${isWholesaleShop ? `This invoice is generated for wholesale supply. ${escapeHtml(wholesaleTermNote)} Goods once delivered are subject to agreed return and shortage policies.` : 'Thank you for your business. Please keep this invoice for warranty claims, returns, and accounting reference.'}</p>
                </div>
                <div class="summary">
                  ${itemDiscountTotal > 0 ? `<div class="row discount"><span>Item Discounts</span><strong>-${escapeHtml(formatMoney(itemDiscountTotal))}</strong></div>` : ''}
                  <div class="row"><span>Subtotal</span><strong>${escapeHtml(formatMoney(tx.subtotal))}</strong></div>
                  ${discountBlock}
                  <div class="row"><span>Tax</span><strong>${escapeHtml(formatMoney(tx.tax))}</strong></div>
                  <div class="row grand"><span>Total</span><strong>${escapeHtml(formatMoney(tx.total))}</strong></div>
                  ${tx.paymentMethod === 'Cash' ? `<div class="row"><span>Cash Received</span><strong>${escapeHtml(formatMoney(tx.cashReceived ?? tx.total))}</strong></div><div class="row"><span>Change Due</span><strong>${escapeHtml(formatMoney(tx.changeDue ?? 0))}</strong></div>` : ''}
                  <div class="sign-row">
                    <div class="signature-box">
                      <div class="signature-line">__________________</div>
                      <div>Authorized Signature</div>
                      <div>${escapeHtml(activeShopName)}</div>
                    </div>
                    <div class="stamp-box">
                      <div class="stamp-title">Shop Stamp</div>
                      <div class="stamp-shop">${escapeHtml(activeShopName)}</div>
                      <div class="stamp-note">PAID / AUTHORIZED</div>
                    </div>
                  </div>
                </div>
              </div>

              <footer class="foot">
                ${isWholesaleShop ? 'Wholesale supply invoice generated on A4 format. Please validate delivered quantities and terms at receipt.' : 'Returns accepted within 14 days with valid receipt.'} Printed by ${escapeHtml(activeShopName)}.<br>${invoiceFooter.goods} ${invoiceFooter.thanks}<br><small>${invoiceFooter.credit}</small>
              </footer>

              <div style="display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 12px;">
                <div style="border-top: 1px solid #64748b; padding-top: 6px; text-align: center; font-size: 10px; color: #475569;">
                  <div style="font-family: 'Brush Script MT', 'Segoe Script', cursive; font-size: 18px; color: #111827; line-height: 1; margin-bottom: 2px;">__________________</div>
                  <div>Authorized Signature</div>
                  <div>${escapeHtml(activeShopName)}</div>
                </div>
                <div style="border: 2px dashed #ef4444; border-radius: 14px; color: #ef4444; text-align: center; padding: 10px 8px; font-weight: 800; transform: rotate(-4deg);">
                  <div style="font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;">Shop Stamp</div>
                  <div style="font-size: 12px; line-height: 1.1; margin: 4px 0;">${escapeHtml(activeShopName)}</div>
                  <div style="font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase;">PAID / AUTHORIZED</div>
                </div>
              </div>
            </div>
          </section>
          <script>
            setTimeout(() => {
              window.print();
              setTimeout(() => window.close(), 250);
            }, 180);
          <\/script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  };

  // Process core checkout
  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (!selectedCustomer.id || !customers.some((customer) => customer.id === selectedCustomer.id && customer.id !== 'cust-walkin' && customer.shopId === taxConfig.activeShopId)) {
      notify.warning('Select a registered wholesale customer shop before creating the invoice. Add new shops in Customers.');
      return;
    }
    if (!activeSalesReps.some(rep => rep.id === selectedSalesRepId)) {
      notify.warning('Select the Sales Representative responsible for this invoice.');
      return;
    }
    if (paymentMethod === 'Cash' && numericCashReceived < total) {
      notify.warning(`Cash received must be at least ${formatMoney(total)}.`);
      return;
    }
    const printWindow = createPrintWindow();
    setIsSubmitting(true);

    try {
      const response = await authFetch('/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          cartItems: cart,
          customerId: selectedCustomer.id,
          customerName: (billingCustomerName || '').trim() || selectedCustomer.name,
          customerPhone: (billingCustomerPhone || '').trim() || undefined,
          customerAddress: (billingCustomerAddress || '').trim() || undefined,
          salesRepId: selectedSalesRepId,
          paymentMethod: paymentMethod,
          paymentStatus: paymentMethod === 'Credit Account'
            ? 'CREDIT SALE'
            : ((Number(cashReceived || 0) <= 0 && paymentMethod === 'Cash')
              ? 'UNPAID'
              : ((paymentMethod === 'Cash' && Number(cashReceived || 0) < total) ? 'PARTIALLY PAID' : 'PAID')),
          wholesaleMeta: isWholesaleShop
            ? {
                transportCharges: Number(wholesaleMetaDraft.transportCharges || 0),
                deliveryCharges: Number(wholesaleMetaDraft.deliveryCharges || 0),
                warrantyInformation: wholesaleMetaDraft.warrantyInformation.trim() || undefined,
                dispatchMethod: wholesaleMetaDraft.dispatchMethod.trim() || undefined,
                vehicleNumber: wholesaleMetaDraft.vehicleNumber.trim() || undefined,
                deliveryNoteNumber: wholesaleMetaDraft.deliveryNoteNumber.trim() || undefined,
                batchNumber: wholesaleMetaDraft.batchNumber.trim() || undefined,
                supplierReference: wholesaleMetaDraft.supplierReference.trim() || undefined,
                deliveryStatus: wholesaleMetaDraft.deliveryStatus.trim() || undefined,
              }
            : undefined,
          discountAmount: cashDiscount,
          cashReceived: paymentMethod === 'Cash' ? numericCashReceived : undefined,
        }),
      });

      if (response.ok) {
        const completedTx = await response.json();
        let invoiceQrData = '';
        try {
          const qrRes = await authFetch('/api/qr/generate-invoice', {
            method: 'POST',
            body: JSON.stringify({
              invoiceNumber: completedTx.invoiceNumber,
              total: Number(completedTx.total || 0),
              shopName: activeShopName,
            }),
          });
          if (qrRes.ok) {
            const qrPayload = await qrRes.json();
            invoiceQrData = qrPayload.qrData || '';
          }
        } catch {
          // Keep checkout resilient even if QR generation fails.
        }

        const txWithQr: SalesTransaction = { ...completedTx, invoiceQrData };
        setReceiptModel(txWithQr);
        setSelectedCopyType('Duplicate Copy');
        try {
          const printAudit = await logInvoicePrint(txWithQr, 'Original Copy');
          await loadInvoicePrintHistory(txWithQr);
          printReceiptInvoice(txWithQr, printWindow, {
            copyType: printAudit.printLog.copyType,
            watermarkText: printAudit.printSummary.watermarkText,
            secondaryWatermarkText: printAudit.printSummary.secondaryWatermarkText,
            printSequence: printAudit.printLog.printSequence,
            isReprint: printAudit.printSummary.isReprint,
            printedBy: printAudit.printLog.printedBy,
            printedAt: printAudit.printLog.printedAt,
          });
        } catch {
          printReceiptInvoice(txWithQr, printWindow);
          notify.warning('Sale saved, but print audit log failed. Printed without tracked copy label.');
        }
        // Require an explicit representative for each new invoice; another rep may handle the next sale.
        setSelectedSalesRepId('');
        // Clear active cart states
        setCart([]);
        setCashDiscount(0);
        setCashReceived('');
        onRefreshDb(); // Reload stock amounts parent state
      } else {
        if (printWindow) {
          printWindow.close();
        }
        const data = await response.json();
        notify.error('POS Checkout error: ' + data.error);
      }
    } catch (err) {
      if (printWindow) {
        printWindow.close();
      }
      notify.error('Network failure processing transaction');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick action: quick add complementary suggestion item
  const handleAddSuggested = (productId: string) => {
    const match = products.find((p) => p.id === productId);
    if (match) {
      addToCart(match, match.variants?.[0]);
    }
  };

  return (
    <div className="flex flex-col space-y-4 min-h-[calc(100vh-140px)] select-none motion-safe:animate-fade-in">
      {/* Mobile view selector (visible only on lg:hidden) */}
      <div className="lg:hidden flex border border-slate-200 bg-white rounded-xl p-1 shadow-2xs shrink-0">
        <button
          type="button"
          onClick={() => setActiveMobileView('catalog')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 ${
            activeMobileView === 'catalog'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Search className="w-4 h-4" />
          Products Catalog ({filteredProducts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveMobileView('cart')}
          className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 ${
            activeMobileView === 'cart'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          Active Cart ({cart.reduce((sum, item) => sum + item.quantity, 0)})
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* LEFT: Products, Searches, Filters (7 Cols) */}
        <div className={`lg:col-span-7 flex flex-col space-y-4 ${activeMobileView === 'catalog' ? 'flex' : 'hidden lg:flex'}`}>
        {/* Search header bar */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
            <input
              id="pos-search-input"
              type="text"
              placeholder="Search Name, SKU, or Barcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 text-slate-800 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-sans"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowQRFeature(true)}
            id="pos-qr-scanner-btn"
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 flex items-center gap-2 transition"
            title="Scan product QR code or internal code"
          >
            <QrCode className="w-4 h-4" />
            QR Scan
          </button>

          {barcodeNotification ? (
            <div className={`w-full sm:w-auto text-[11px] px-3 py-2 rounded-lg border flex items-center gap-2 ${barcodeNotification.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
              <ScanLine className="w-3.5 h-3.5" />
              <span className="font-medium">{barcodeNotification.msg}</span>
              {barcodeBuffer ? <span className="font-mono opacity-70">[{barcodeBuffer}]</span> : null}
            </div>
          ) : null}

          <div className="text-xs font-mono text-slate-500">
            {filteredProducts.length} Items Indexed
          </div>
        </div>

        {/* Categories Tabs */}
        <div id="category-filter-scroller" className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
          {categories.map((cat) => (
            <button
              key={cat}
              id={`cat-filter-${cat.replace(/\s+/g, '-').toLowerCase()}`}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-sans font-medium whitespace-nowrap transition ${
                selectedCategory === cat
                  ? 'bg-indigo-600 text-white border border-indigo-600 shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Dynamic Products Grid */}
        <div id="pos-product-grid" className="grid grid-cols-2 sm:grid-cols-3 gap-3 overflow-y-auto max-h-[580px] pr-1">
          {filteredProducts.map((p) => {
            const selectedVariant = getSelectedVariant(p);
            const activeStock = Number(selectedVariant?.quantity ?? p.quantity);
            const activeReorderLevel = Number(selectedVariant?.reorderLevel ?? p.reorderLevel);
            const activePrice = Number(selectedVariant?.sellingPrice ?? p.sellingPrice);
            const isLowStock = activeStock <= activeReorderLevel;
            const isOut = activeStock <= 0;

            return (
              <div
                key={p.id}
                id={`pos-product-${p.id}`}
                onClick={() => !isOut && addToCart(p, selectedVariant)}
                className={`bg-white rounded-xl border p-3 flex flex-col justify-between cursor-pointer group transition-all duration-150 relative ${
                  isOut
                    ? 'border-slate-200 bg-slate-50 opacity-55 cursor-not-allowed'
                    : isLowStock
                    ? 'border-rose-100 hover:border-indigo-500 hover:shadow-md'
                    : 'border-slate-100 hover:border-indigo-500 hover:shadow-md'
                }`}
              >
                {/* Visual low stock warning tag */}
                {isLowStock ? (
                  <span className="absolute top-2 right-2 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                  </span>
                ) : null}

                <div>
                  <span className="text-[9px] font-mono font-medium text-slate-400 uppercase">
                    {p.category}
                  </span>
                  <h5 className="font-sans font-semibold text-slate-900 text-xs mt-1 leading-snug group-hover:text-indigo-600 transition line-clamp-2">
                    {p.name}
                  </h5>
                  <p className="font-mono text-[9px] text-slate-400 mt-1">
                    {p.brand} | SKU: {p.sku}
                    {isAdminSeller && p.internalCode && (
                      <span className="ml-2 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded font-bold flex items-center gap-1 inline-flex">
                        <Eye className="w-3 h-3" />
                        {p.internalCode}
                      </span>
                    )}
                  </p>
                  {Array.isArray(p.variants) && p.variants.length > 0 && (
                    <div className="mt-2">
                      <select
                        value={selectedVariant?.id || p.variants[0]?.id || ''}
                        onChange={(event) => {
                          event.stopPropagation();
                          setSelectedVariantByProduct((current) => ({ ...current, [p.id]: event.target.value }));
                        }}
                        onClick={(event) => event.stopPropagation()}
                        className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-700"
                      >
                        {p.variants.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.name} ({variant.unit})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-2 border-t border-slate-50 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-950 font-mono">
                    {formatMoney(activePrice)}
                  </span>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                      isOut
                        ? 'bg-rose-100 text-rose-700'
                        : isLowStock
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {isOut ? 'Out of Stock' : `Qty: ${activeStock}`}
                  </span>
                </div>
              </div>
            );
          })}

          {filteredProducts.length === 0 && (
            <div className="col-span-full py-16 text-center bg-white rounded-xl border border-dashed border-slate-200 text-slate-400">
              <BadgeAlert className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-xs font-semibold mt-2">No matching products found</p>
              <p className="text-[10px] text-slate-500 mt-1">Refine your search parameters or check your filters</p>
            </div>
          )}
        </div>

        {/* AI Cross Selling Widget (Only shows up when items are in cart) */}
        {cart.length > 0 && (
          <div id="ai-smart-suggest-section" className="bg-slate-900 text-slate-100 rounded-xl p-4 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-indigo-500/10 to-transparent rounded-full pointer-events-none"></div>

            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
              <h4 className="text-xs font-sans font-bold text-slate-100 uppercase tracking-wider">
                Partner AI Companion Sales Matches
              </h4>
            </div>

            {isLoadingCross ? (
              <div className="text-center py-3 text-slate-400 text-xs flex items-center justify-center gap-2 font-mono">
                <div className="h-3 w-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
                Analyzing customer builder cycle trends...
              </div>
            ) : aiCrossSells.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {aiCrossSells.map((sug: any) => (
                  <div
                    key={sug.productId}
                    onClick={() => handleAddSuggested(sug.productId)}
                    className="p-2.5 bg-slate-950/70 hover:bg-slate-950 rounded-lg border border-slate-800 shadow-xs hover:border-indigo-400/40 cursor-pointer text-left transition group"
                  >
                    <p className="font-sans font-semibold text-slate-200 text-[11px] truncate group-hover:text-indigo-400">
                      {sug.name}
                    </p>
                    <p className="text-[9px] text-slate-500 font-mono mt-0.5 line-clamp-2">
                      {sug.reason}
                    </p>
                    <div className="mt-2 flex items-center justify-between text-[10px]">
                      <span className="font-mono text-indigo-400 font-bold">{formatMoney(Number(sug.sellingPrice || 0))}</span>
                      <span className="text-slate-400 uppercase font-bold tracking-tight text-[8px] flex items-center gap-0.5">
                        <PlusSquare className="w-3 h-3 text-indigo-400" /> Quick Add
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 font-sans">
                Cart contains specialized builder elements. Cross-selling predictions standby.
              </p>
            )}
          </div>
        )}
      </div>

      {/* RIGHT: Register Cart panel & Checkout Checkout (5 Cols) */}
      <div className={`lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-lg p-3 sm:p-4 flex flex-col min-h-[550px] lg:h-[calc(100dvh-150px)] lg:min-h-[560px] lg:overflow-hidden ${activeMobileView === 'cart' ? 'flex' : 'hidden lg:flex'}`}>
        <div className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
          {/* Active Operator Banner */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-3 text-xs font-sans">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">Terminal Register 01</p>
              <p className="font-medium text-slate-800">Operator: <span className="text-indigo-600 font-semibold">{cashierName}</span></p>
            </div>
            <div className="p-1 px-2.5 bg-slate-50 rounded-md border border-slate-150 text-slate-600 text-[11px] font-mono">
              Mode: Check-out
            </div>
          </div>

          {lastScannedItem && (
            <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] text-indigo-800 flex items-center justify-between gap-2">
              <span className="font-semibold truncate">Scanned: {lastScannedItem.label}</span>
              <span className="font-mono text-indigo-600 shrink-0">[{lastScannedItem.code}]</span>
            </div>
          )}

          {/* Registered wholesale buyer lookup. Never bill an unknown walk-in account. */}
          <div className="mb-3 grid grid-cols-1 gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3 font-sans text-xs">
            <div className="flex items-center justify-between gap-2">
              <div><p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Bill to · Registered shop</p>
                <p className="mt-1 text-[11px] text-slate-500">Select a saved wholesale customer; contact details fill automatically.</p>
              </div>
            </div>
            <label htmlFor="pos-customer-search" className="block text-xs font-semibold text-slate-700">
              Find shop by name, phone or address
              <input id="pos-customer-search" type="search" autoComplete="off" value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search registered wholesale shops..."
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-amber-400" />
            </label>
            <label htmlFor="pos-customer-select" className="block text-xs font-semibold text-slate-700">
              Select customer shop *
              <select id="pos-customer-select" required value={selectedCustomer.id}
                onChange={(e) => {
                  const cust = customers.find((c) => c.id === e.target.value && c.shopId === taxConfig.activeShopId);
                  if (cust) setSelectedCustomer(cust);
                }}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-amber-400">
                <option value="" disabled>Choose a registered shop...</option>
                {availableWholesaleCustomers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.phone && c.phone !== '-' ? ` · ${c.phone}` : ''}</option>
                ))}
                {selectedCustomer.id && !availableWholesaleCustomers.some((c) => c.id === selectedCustomer.id) && (
                  <option value={selectedCustomer.id}>{selectedCustomer.name} · selected</option>
                )}
              </select>
            </label>
            {customers.filter((c) => c.id !== 'cust-walkin' && c.shopId === taxConfig.activeShopId).length === 0 && (
              <p role="status" className="rounded-lg bg-white px-3 py-2 text-amber-800">No wholesale shops registered yet. Open Customers in the sidebar to add your first buyer.</p>
            )}
            <details className="rounded-lg border border-amber-100 bg-white/80 px-3 py-2" id="pos-customer-details">
              <summary className="cursor-pointer select-none text-[11px] font-semibold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
                Customer contact details (view)
              </summary>
              <div className="mt-2 grid grid-cols-1 gap-2">
              <div>
                <label className="block text-[10px] uppercase font-mono tracking-wider text-slate-500 mb-1">Customer shop name</label>
                <input
                  id="pos-billing-customer-name"
                  type="text"
                  value={billingCustomerName}
                  onChange={(e) => setBillingCustomerName(e.target.value)}
                  placeholder="Registered shop name"
                  readOnly
                  className="w-full bg-white border border-slate-200 p-2 rounded-lg focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase font-mono tracking-wider text-slate-500 mb-1">Phone Number</label>
                  <input
                    id="pos-billing-customer-phone"
                    type="text"
                    value={billingCustomerPhone}
                    onChange={(e) => setBillingCustomerPhone(e.target.value)}
                    placeholder="Shop contact number"
                    readOnly
                    className="w-full bg-white border border-slate-250 p-1.5 rounded focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-mono tracking-wider text-slate-500 mb-1">Business address</label>
                  <input
                    id="pos-billing-customer-address"
                    type="text"
                    value={billingCustomerAddress}
                    onChange={(e) => setBillingCustomerAddress(e.target.value)}
                    placeholder="Shop / delivery address"
                    readOnly
                    className="w-full bg-white border border-slate-250 p-1.5 rounded focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            </details>

            <label htmlFor="pos-sales-representative" className="block text-[11px] font-semibold text-slate-800">
              Sales Representative <span className="text-rose-600">*</span>
              <select id="pos-sales-representative" required aria-label="Select Sales Representative"
                value={selectedSalesRepId} onChange={(event) => setSelectedSalesRepId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500">
                <option value="">Select Sales Representative</option>
                {activeSalesReps.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
              </select>
              {activeSalesReps.length === 0 &&
                <span className="mt-1 block text-[11px] text-rose-700">Register Sales Representatives in Staff before billing.</span>}
            </label>

            {selectedCustomer.id !== 'cust-walkin' && (
              <details className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700">
                <summary className="cursor-pointer font-semibold text-slate-600">Customer credit and purchase history</summary>
                <div className="mt-2 space-y-2 bg-slate-100 p-2 rounded text-[11px] text-slate-700">
                <div className="flex justify-between items-center">
                  <span>Loyalty Balance: <strong className="font-mono text-indigo-600">{selectedCustomer.loyaltyBalance} pts</strong></span>
                  <span>Prior Transactions: <strong>{selectedCustomer.purchaseCount}</strong></span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1.5">
                  <span className="flex items-center gap-1 text-slate-600">
                    <BookUser className="w-3.5 h-3.5 text-amber-500" /> Credit Limit: <strong className="font-mono">{formatMoney(creditLimit)}</strong>
                  </span>
                  <span className={`font-mono font-semibold ${currentCreditBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    Balance: {formatMoney(currentCreditBalance)}
                  </span>
                </div>
                </div>
              </details>
            )}

            {paymentMethod === 'Credit Account' && (
              <div className={`rounded-lg border px-3 py-2 text-[11px] ${creditAccountAllowed ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                {selectedCustomer.id === 'cust-walkin'
                  ? 'Credit account requires a saved customer profile.'
                  : creditLimit <= 0
                  ? 'This customer has no credit limit configured.'
                  : creditExceeded
                  ? `Credit limit exceeded. Projected balance ${formatMoney(projectedCreditBalance)} is above limit ${formatMoney(creditLimit)}.`
                  : `This sale will post to customer credit. Projected balance: ${formatMoney(projectedCreditBalance)} of ${formatMoney(creditLimit)}.`}
              </div>
            )}
          </div>

          {/* Cart Header */}
          <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-50 pb-2.5 font-sans mb-3">
            <span>Product</span>
            <div className="flex items-center gap-12">
              <span>Qty</span>
              <span>Total</span>
            </div>
          </div>

          {/* Cart Scroll list */}
          <div id="pos-cart-scroller" className="space-y-2.5 pr-1">
            {cart.map((item) => {
              const lineKey = getCartKey(item);
              const basePrice = Number(item.unitPrice ?? item.product.sellingPrice);
              const pricing = getLinePricing(item);

              return (
                <div key={lineKey} className="flex items-center justify-between text-xs font-sans">
                  {/* description */}
                  <div className="min-w-0 flex-1 pr-4">
                    <p className="font-semibold text-slate-800 truncate" title={item.product.name}>
                      {item.product.name}
                    </p>
                    {item.variantName && (
                      <p className="text-[10px] text-indigo-600 font-semibold mt-0.5">
                        {item.variantName}{item.variantUnit ? ` (${item.variantUnit})` : ''}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono mt-0.5">
                      <span>{formatMoney(basePrice)} ea</span>
                      {pricing.percentDiscount > 0 && <span className="text-emerald-600">(-{pricing.percentDiscount}%)</span>}
                      {pricing.rupeeDiscount > 0 && <span className="text-emerald-600">(-{formatMoney(pricing.rupeeDiscount)})</span>}
                    </div>

                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <Ticket className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="text-[9px] text-slate-400 uppercase">Disc%:</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={item.discount}
                        onChange={(e) => updateItemDiscount(lineKey, Number(e.target.value))}
                        className="w-11 px-1 py-0.5 border border-slate-200 bg-white rounded text-[9px] text-slate-700 focus:outline-none"
                      />
                      <span className="text-[9px] text-slate-400 uppercase">Disc Rs:</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.discountAmount || 0}
                        onChange={(e) => updateItemDiscountAmount(lineKey, Number(e.target.value))}
                        className="w-16 px-1 py-0.5 border border-slate-200 bg-white rounded text-[9px] text-slate-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* selectors and quantities */}
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-md p-1">
                      <button
                        type="button"
                        onClick={() => updateCartQty(lineKey, item.quantity - 1)}
                        className="p-0.5 text-slate-500 hover:text-slate-800"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity}
                        onChange={(e) => updateCartQty(lineKey, Number(e.target.value))}
                        onFocus={(e) => e.currentTarget.select()}
                        className="h-7 w-14 rounded border border-slate-200 bg-white px-1 text-center font-mono text-xs font-bold text-slate-800 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => updateCartQty(lineKey, item.quantity + 1)}
                        className="p-0.5 text-slate-500 hover:text-slate-800"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="text-right w-18 font-mono font-bold text-slate-900">
                      {formatMoney(pricing.lineTotal)}
                      <button
                        onClick={() => removeFromCart(lineKey)}
                        className="block text-slate-400 hover:text-rose-500 mt-1 ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {cart.length === 0 && (
              <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center border border-dashed border-slate-100 rounded-xl">
                <ShoppingCart className="w-8 h-8 text-slate-200" />
                <p className="text-xs font-semibold mt-1">Cash Register is Empty</p>
                <p className="text-[10px] text-slate-500 mt-1">Click on products on the left to add items</p>
              </div>
            )}
          </div>
        </div>

        {/* Ledger Bottom checkout math */}
        <div className="shrink-0 border-t border-slate-200 bg-white pt-3 space-y-2 mt-2 lg:max-h-[48%] lg:overflow-y-auto">
          <div className="space-y-1.5 text-xs text-slate-600 font-sans">
            <div className="flex justify-between">
              <span>Items Total</span>
              <span className="font-mono">{formatMoney(grossSubtotal)}</span>
            </div>

            {itemDiscountTotal > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Item Discounts</span>
                <span className="font-mono">-{formatMoney(itemDiscountTotal)}</span>
              </div>
            )}

            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-mono">{formatMoney(subtotal)}</span>
            </div>

            {/* General Checkout Discount */}
            <div className="flex justify-between items-center py-0.5">
              <span className="flex items-center gap-1 text-slate-500 text-[11px]">
                <Ticket className="w-3.5 h-3.5 text-indigo-500" /> Manual Cart Discount ({currencySymbol})
              </span>
              <input
                id="pos-cart-discount-input"
                type="number"
                min="0"
                value={cashDiscount}
                onChange={(e) => setCashDiscount(Number(e.target.value) || 0)}
                className="w-18 border border-slate-200 p-1 text-right text-xs bg-white text-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded font-mono"
              />
            </div>

            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Sales Tax ({taxConfig.taxRate.toFixed(1)}% standard)</span>
              <span className="font-mono">{currencySymbol}{tax.toFixed(2)}</span>
            </div>

            <div className="flex justify-between text-base font-bold text-slate-950 border-t border-slate-100 pt-2 font-sans">
              <span>Total Bill</span>
              <span id="pos-total-price" className="font-mono text-indigo-600">{currencySymbol}{total.toFixed(2)}</span>
            </div>

            {paymentMethod === 'Cash' && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Cash Received ({currencySymbol})</span>
                  <span className="font-mono">Change Due: {formatMoney(changeDue)}</span>
                </div>
                <input
                  id="pos-cash-received-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  placeholder={total.toFixed(2)}
                  className={`w-full border p-2 rounded-lg text-sm font-mono outline-none focus:ring-1 ${cashShortage ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-200 bg-rose-50' : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500 bg-white'}`}
                />
                {cashShortage && (
                  <p className="text-[11px] text-rose-600 font-medium">Cash received is less than the bill total.</p>
                )}
              </div>
            )}
          </div>

          {/* Payment Method Selector Grid */}
          <div className="grid grid-cols-2 gap-1.5 pt-1 sm:grid-cols-4">
            {[
              { id: 'Cash', label: 'Cash', icon: DollarSign },
              { id: 'Credit Card', label: 'Card', icon: CreditCard },
              { id: 'QR Code', label: 'QR Pay', icon: QrCode },
              { id: 'Credit Account', label: 'On Credit', icon: BookUser },
            ].map((pm) => {
              const Icon = pm.icon;
              const isSel = paymentMethod === pm.id;
              return (
                <button
                  key={pm.id}
                  id={`paymethod-${pm.id.replace(/\s+/g, '-').toLowerCase()}`}
                  onClick={() => {
                    setPaymentMethod(pm.id as any);
                    if (pm.id === 'Cash' && (!cashReceived || Number(cashReceived) === 0)) {
                      setCashReceived(total.toFixed(2));
                    }
                  }}
                  className={`py-1.5 rounded-lg text-xs font-sans font-medium flex items-center justify-center gap-1 border transition-all ${
                    isSel
                      ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs'
                      : 'bg-white text-slate-600 border-slate-250 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {pm.label}
                </button>
              );
            })}
          </div>

          {isWholesaleShop && (
            <details className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <summary className="cursor-pointer text-[11px] font-semibold text-amber-800">
                Delivery, transport and warranty details (optional)
              </summary>
              <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={wholesaleMetaDraft.transportCharges}
                  onChange={(e) => setWholesaleMetaDraft((prev) => ({ ...prev, transportCharges: e.target.value }))}
                  placeholder="Transport Charges"
                  className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-[11px]"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={wholesaleMetaDraft.deliveryCharges}
                  onChange={(e) => setWholesaleMetaDraft((prev) => ({ ...prev, deliveryCharges: e.target.value }))}
                  placeholder="Delivery Charges"
                  className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-[11px]"
                />
                <input
                  type="text"
                  value={wholesaleMetaDraft.warrantyInformation}
                  onChange={(e) => setWholesaleMetaDraft((prev) => ({ ...prev, warrantyInformation: e.target.value }))}
                  placeholder="Warranty Information"
                  className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-[11px]"
                />
                <input
                  type="text"
                  value={wholesaleMetaDraft.dispatchMethod}
                  onChange={(e) => setWholesaleMetaDraft((prev) => ({ ...prev, dispatchMethod: e.target.value }))}
                  placeholder="Dispatch Method"
                  className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-[11px]"
                />
                <input
                  type="text"
                  value={wholesaleMetaDraft.vehicleNumber}
                  onChange={(e) => setWholesaleMetaDraft((prev) => ({ ...prev, vehicleNumber: e.target.value }))}
                  placeholder="Vehicle Number"
                  className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-[11px]"
                />
                <input
                  type="text"
                  value={wholesaleMetaDraft.deliveryNoteNumber}
                  onChange={(e) => setWholesaleMetaDraft((prev) => ({ ...prev, deliveryNoteNumber: e.target.value }))}
                  placeholder="Delivery Note Number"
                  className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-[11px]"
                />
                <input
                  type="text"
                  value={wholesaleMetaDraft.batchNumber}
                  onChange={(e) => setWholesaleMetaDraft((prev) => ({ ...prev, batchNumber: e.target.value }))}
                  placeholder="Batch Number"
                  className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-[11px]"
                />
                <input
                  type="text"
                  value={wholesaleMetaDraft.supplierReference}
                  onChange={(e) => setWholesaleMetaDraft((prev) => ({ ...prev, supplierReference: e.target.value }))}
                  placeholder="Supplier Reference"
                  className="w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-[11px]"
                />
                <input
                  type="text"
                  value={wholesaleMetaDraft.deliveryStatus}
                  onChange={(e) => setWholesaleMetaDraft((prev) => ({ ...prev, deliveryStatus: e.target.value }))}
                  placeholder="Delivery Status"
                  className="col-span-2 w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-[11px]"
                />
              </div>
              </div>
            </details>
          )}

          {/* Checkout Submit Trigger */}
          <button
            id="pos-pay-trigger"
            disabled={cart.length === 0 || isSubmitting || (paymentMethod === 'Credit Account' && !creditAccountAllowed) || (paymentMethod === 'Cash' && cashShortage)}
            onClick={handleCheckout}
            className={`w-full py-3 rounded-xl text-sm font-sans font-bold transition flex items-center justify-center gap-2 shadow-sm ${
              cart.length === 0 || (paymentMethod === 'Credit Account' && !creditAccountAllowed) || (paymentMethod === 'Cash' && cashShortage)
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                : 'bg-slate-900 border border-slate-900 text-slate-100 hover:bg-slate-950'
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="h-4 w-4 border-2 border-slate-400 border-t-white rounded-full animate-spin"></div>
                Recording Receipt...
              </>
            ) : (
              <>
                Complete Checkout & Receipt ({currencySymbol}{total.toFixed(2)})
              </>
            )}
          </button>
        </div>
      </div>

      {/* RECEIPT DIALOG MODAL ON CHECKOUT SUCCESS */}
        {receiptModel && (
          <div id="receipt-modal-backdrop" className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl border border-slate-100 font-sans relative flex flex-col justify-between max-h-[95vh]">
              {/* Dismiss button */}
              <button
                onClick={() => setReceiptModel(null)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="overflow-y-auto">
                {/* Enterprise Invoice Preview */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 p-4 border-b border-slate-200">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        {shopLogoUrl && (
                          <img src={shopLogoUrl} alt="Store logo" className="h-12 w-auto max-w-[220px] object-contain mb-2" />
                        )}
                        <h3 className="font-heading font-black text-slate-900 text-sm uppercase tracking-wider">{invoiceCompanyMeta.companyLegalName}</h3>
                        <p className="text-[10px] text-slate-500">{invoiceCompanyMeta.companyTagline}</p>
                        <p className="text-[10px] text-slate-500 mt-1">{shopAddress}</p>
                        {shopPhone && <p className="text-[10px] text-slate-500">Phone: {shopPhone}</p>}
                        <p className="text-[10px] text-slate-500">BR: {invoiceCompanyMeta.businessRegistrationNo || '-'} | VAT: {invoiceCompanyMeta.vatRegistrationNo || '-'} | TIN: {invoiceCompanyMeta.tinNo || '-'}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-[10px] font-mono grid grid-cols-2 gap-y-1 text-slate-600">
                          <span>INVOICE #</span>
                          <span className="text-right font-bold text-slate-900">{receiptModel.invoiceNumber}</span>
                          <span>DATE</span>
                          <span className="text-right">{new Date(receiptModel.date).toLocaleDateString()} {new Date(receiptModel.date).toLocaleTimeString()}</span>
                          <span>SALES REPRESENTATIVE</span>
                          <span className="text-right truncate">{receiptModel.salesRepName || 'Not recorded'}</span>
                          <span>PAYMENT</span>
                          <span className="text-right font-semibold text-indigo-600">{receiptModel.paymentMethod}</span>
                        </div>
                        <div className="mt-2">
                          <span className={`inline-flex px-2.5 py-1 rounded-full border text-[10px] font-semibold tracking-wide ${receiptPaymentStatusClass}`}>
                            {receiptPaymentStatus}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] pb-3 border-b border-dashed border-slate-200">
                      <div>
                        <p><span className="text-slate-500">Customer:</span> <strong className="text-slate-900">{receiptModel.customerName}</strong></p>
                        <p><span className="text-slate-500">Phone:</span> {receiptModel.customerPhone || '-'}</p>
                      </div>
                      <div>
                        <p><span className="text-slate-500">Address:</span> {receiptModel.customerAddress || '-'}</p>
                        <p><span className="text-slate-500">Customer ID:</span> {receiptModel.customerId || '-'}</p>
                      </div>
                    </div>

                    {isWholesaleShop && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-3 border-b border-dashed border-slate-200">
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px]">
                          <p className="font-semibold uppercase tracking-wide text-amber-700 mb-1">Customer Credit Information</p>
                          <p className="flex justify-between"><span>Outstanding Balance</span><strong>{formatMoney(receiptOutstandingBalance)}</strong></p>
                          <p className="flex justify-between"><span>Current Invoice Amount</span><strong>{formatMoney(receiptModel.total)}</strong></p>
                          <p className="flex justify-between"><span>Available Credit Limit</span><strong>{formatMoney(receiptAvailableCredit)}</strong></p>
                          <p className="flex justify-between"><span>Credit Limit</span><strong>{formatMoney(receiptCreditLimit)}</strong></p>
                          <p className="flex justify-between"><span>Current Payment</span><strong>{formatMoney(receiptCurrentPayment)}</strong></p>
                          <p className="flex justify-between"><span>Remaining Balance</span><strong>{formatMoney(receiptRemainingBalance)}</strong></p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px]">
                          <p className="font-semibold uppercase tracking-wide text-slate-700 mb-1">Hardware Business Information</p>
                          <p className="flex justify-between"><span>Transport Charges</span><strong>{formatMoney(Number(receiptModel.wholesaleMeta?.transportCharges || 0))}</strong></p>
                          <p className="flex justify-between"><span>Delivery Charges</span><strong>{formatMoney(Number(receiptModel.wholesaleMeta?.deliveryCharges || 0))}</strong></p>
                          <p className="flex justify-between"><span>Warranty Information</span><strong>{receiptModel.wholesaleMeta?.warrantyInformation || '-'}</strong></p>
                          <p className="flex justify-between"><span>Dispatch Method</span><strong>{receiptModel.wholesaleMeta?.dispatchMethod || '-'}</strong></p>
                          <p className="flex justify-between"><span>Vehicle Number</span><strong>{receiptModel.wholesaleMeta?.vehicleNumber || '-'}</strong></p>
                          <p className="flex justify-between"><span>Delivery Note Number</span><strong>{receiptModel.wholesaleMeta?.deliveryNoteNumber || '-'}</strong></p>
                          <p className="flex justify-between"><span>Batch Number</span><strong>{receiptModel.wholesaleMeta?.batchNumber || '-'}</strong></p>
                          <p className="flex justify-between"><span>Supplier Reference</span><strong>{receiptModel.wholesaleMeta?.supplierReference || '-'}</strong></p>
                          <p className="flex justify-between"><span>Delivery Status</span><strong>{receiptModel.wholesaleMeta?.deliveryStatus || '-'}</strong></p>
                        </div>
                      </div>
                    )}

                    <div className="py-3.5 text-xs text-slate-800 border-b border-dashed border-slate-200 space-y-2">
                      <div className={`grid ${isWholesaleShop ? 'grid-cols-9' : 'grid-cols-3'} font-semibold text-[10px] text-slate-500 uppercase`}>
                        {isWholesaleShop ? (
                          <>
                            <span>Item Code</span>
                            <span className="col-span-2">Product Name</span>
                            <span>Brand</span>
                            <span>Variant</span>
                            <span>Unit</span>
                            <span className="text-right">Qty</span>
                            <span className="text-right">Discount</span>
                            <span className="text-right">Amount</span>
                          </>
                        ) : (
                          <>
                            <span className="col-span-2">Item Description</span>
                            <span className="text-right">Total</span>
                          </>
                        )}
                      </div>

                      {receiptModel.items.map((itm, i) => {
                        const gross = itm.sellingPrice * itm.quantity;
                        const percentAdjusted = gross * (1 - itm.discount / 100);
                        const rupeeDiscount = Math.min(percentAdjusted, itm.discountAmount || 0);
                        const lineFinal = Math.max(0, percentAdjusted - rupeeDiscount);
                        const productRef = products.find((p) => p.id === itm.productId);
                        const variantRef = productRef?.variants?.find((variant) => variant.id === itm.variantId);
                        return isWholesaleShop ? (
                          <div key={i} className="grid grid-cols-9 text-[11px] leading-tight">
                            <span className="font-mono text-slate-600 truncate">{itm.variantSku || itm.productId || '-'}</span>
                            <span className="col-span-2 text-slate-900 truncate">{itm.productName}</span>
                            <span className="truncate">{productRef?.brand || '-'}</span>
                            <span className="truncate">{itm.variantName || variantRef?.name || '-'}</span>
                            <span>{itm.variantUnit || variantRef?.unit || inferUnitLabel(itm.productName)}</span>
                            <span className="text-right font-mono">{itm.quantity}</span>
                            <span className="text-right">{itm.discount > 0 ? `${itm.discount}%` : (itm.discountAmount ? `${currencySymbol}${itm.discountAmount.toFixed(2)}` : '-')}</span>
                            <span className="text-right font-mono font-medium">{currencySymbol}{lineFinal.toFixed(2)}</span>
                          </div>
                        ) : (
                          <div key={i} className="grid grid-cols-3 text-[11px] leading-tight">
                            <span className="col-span-2 text-slate-900">
                              {itm.productName} <br />
                              <span className="text-[10px] text-slate-500 font-mono">
                                {itm.quantity} x {currencySymbol}{itm.sellingPrice.toFixed(2)}
                                {itm.discount > 0 && ` (Disc: -${itm.discount}%)`}
                                {itm.discountAmount && itm.discountAmount > 0 && ` (Disc Rs: -${itm.discountAmount.toFixed(2)})`}
                              </span>
                            </span>
                            <span className="text-right font-mono align-bottom font-medium">{currencySymbol}{lineFinal.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Financial overview */}
                <div className="py-3.5 space-y-1.5 text-xs font-sans text-slate-800">
                  {receiptModel.items.reduce((acc, itm) => {
                    const gross = itm.sellingPrice * itm.quantity;
                    const percentAdjusted = gross * (1 - itm.discount / 100);
                    const rupeeDiscount = Math.min(percentAdjusted, itm.discountAmount || 0);
                    return acc + (gross - Math.max(0, percentAdjusted - rupeeDiscount));
                  }, 0) > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>Item Discounts</span>
                      <span className="font-mono">-{currencySymbol}{receiptModel.items.reduce((acc, itm) => {
                        const gross = itm.sellingPrice * itm.quantity;
                        const percentAdjusted = gross * (1 - itm.discount / 100);
                        const rupeeDiscount = Math.min(percentAdjusted, itm.discountAmount || 0);
                        return acc + (gross - Math.max(0, percentAdjusted - rupeeDiscount));
                      }, 0).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">Subtotal</span>
                    <span className="font-mono">{currencySymbol}{receiptModel.subtotal.toFixed(2)}</span>
                  </div>

                  {receiptModel.discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>Manual Order Discount</span>
                      <span className="font-mono">-{currencySymbol}{receiptModel.discountAmount.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>Tax ({taxConfig.taxRate.toFixed(1)}% Sales)</span>
                    <span className="font-mono">{currencySymbol}{receiptModel.tax.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-sm font-bold text-slate-950 border-t border-slate-100 pt-2">
                    <span>Total Amount</span>
                    <span className="font-mono text-indigo-600">{currencySymbol}{receiptModel.total.toFixed(2)}</span>
                  </div>

                  {receiptModel.paymentMethod === 'Cash' && (
                    <>
                      <div className="flex justify-between text-[11px] text-slate-600 pt-1">
                        <span>Customer Gave</span>
                        <span className="font-mono font-semibold">{currencySymbol}{Number(receiptModel.cashReceived ?? receiptModel.total).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-[12px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
                        <span>Balance Amount (Change)</span>
                        <span className="font-mono">{currencySymbol}{Number(receiptModel.changeDue ?? 0).toFixed(2)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Goods receipt proof is shown in preview and on the printed A4 invoice. */}
                <div className="mt-5 border-t border-slate-300 pt-3">
                  <h4 className="text-center text-[10px] font-extrabold tracking-wider text-slate-700">GOODS VERIFICATION &amp; RECEIPT</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 text-center">
                    {['Prepared By', 'Checked By', 'Authorized By', 'Received By'].map((label) => (
                      <div key={label} className="min-w-0">
                        <div className="border-b border-slate-400 h-5" />
                        <p className="text-[9px] text-slate-600 mt-1">{label} / Signature</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 text-[9px] text-slate-600 mt-4">
                    <span>Receiving Date / Time: __________________</span>
                    <span>Customer Stamp: __________________</span>
                  </div>
                  <p className="text-center text-[9px] text-slate-600 mt-3">{invoiceFooter.acknowledgement}</p>
                </div>
                {/* Footer notes */}
                <div className="text-center pt-4 border-t border-dashed border-slate-200 text-[10px] text-slate-500">
                  <p>{invoiceFooter.goods}</p>
                  <p className="font-semibold">{invoiceFooter.thanks}</p>
                  <p className="mt-1">{invoiceFooter.credit}</p>
                  <p className="mt-1">Support: {invoiceCompanyMeta.supportPhone || '-'} | {invoiceCompanyMeta.supportEmail || '-'}</p>
                  <p>{invoiceCompanyMeta.websiteUrl || '-'}{invoiceCompanyMeta.socialLinks ? ` | ${invoiceCompanyMeta.socialLinks}` : ''}</p>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Invoice Copy History</h4>
                  {isLoadingPrintHistory ? (
                    <p className="mt-2 text-[11px] text-slate-500">Loading print history...</p>
                  ) : invoicePrintHistory.length === 0 ? (
                    <p className="mt-2 text-[11px] text-slate-500">No print history available yet.</p>
                  ) : (
                    <div className="mt-2 space-y-1.5 text-[11px]">
                      {invoicePrintHistory.slice(0, 6).map((log) => (
                        <div key={`${log.printSequence}-${log.printedAt}`} className="grid grid-cols-[auto_1fr_auto] gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-600">
                          <span className="font-mono text-indigo-600">#{log.printSequence}</span>
                          <span className="truncate">{log.copyType} • {log.printedBy}</span>
                          <span className="font-mono">{new Date(log.printedAt).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5" /> Invoice Print Audit Report
                    </h4>
                    <button
                      type="button"
                      onClick={() => loadInvoicePrintAudit()}
                      className="text-[10px] px-2 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                    >
                      Refresh
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
                    <input
                      type="date"
                      value={printAuditFilters.fromDate}
                      onChange={(event) => setPrintAuditFilters((prev) => ({ ...prev, fromDate: event.target.value }))}
                      className="rounded border border-indigo-100 bg-white px-2 py-1.5"
                      title="From date"
                    />
                    <input
                      type="date"
                      value={printAuditFilters.toDate}
                      onChange={(event) => setPrintAuditFilters((prev) => ({ ...prev, toDate: event.target.value }))}
                      className="rounded border border-indigo-100 bg-white px-2 py-1.5"
                      title="To date"
                    />
                    <select
                      value={printAuditFilters.copyType}
                      onChange={(event) => setPrintAuditFilters((prev) => ({ ...prev, copyType: event.target.value as '' | InvoiceCopyType }))}
                      className="rounded border border-indigo-100 bg-white px-2 py-1.5"
                    >
                      <option value="">All Copy Types</option>
                      <option value="Original Copy">Original Copy</option>
                      {INVOICE_COPY_TYPE_OPTIONS.map((copyType) => (
                        <option key={`audit-${copyType}`} value={copyType}>{copyType}</option>
                      ))}
                    </select>
                    <select
                      value={printAuditFilters.status}
                      onChange={(event) => setPrintAuditFilters((prev) => ({ ...prev, status: event.target.value as '' | 'Completed' | 'Refunded' }))}
                      className="rounded border border-indigo-100 bg-white px-2 py-1.5"
                    >
                      <option value="">All Statuses</option>
                      <option value="Completed">Completed</option>
                      <option value="Refunded">Refunded</option>
                    </select>
                    <select
                      value={printAuditFilters.printedBy}
                      onChange={(event) => setPrintAuditFilters((prev) => ({ ...prev, printedBy: event.target.value }))}
                      className="rounded border border-indigo-100 bg-white px-2 py-1.5"
                    >
                      <option value="">All Users</option>
                      {auditUserOptions.map((userName) => (
                        <option key={`audit-user-${userName}`} value={userName}>{userName}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Invoice no"
                      value={printAuditFilters.invoiceNumber}
                      onChange={(event) => setPrintAuditFilters((prev) => ({ ...prev, invoiceNumber: event.target.value }))}
                      className="rounded border border-indigo-100 bg-white px-2 py-1.5"
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => loadInvoicePrintAudit(printAuditFilters)}
                      className="text-[10px] px-2.5 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                      Apply Filters
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          setIsExportingAuditCsv(true);
                          await exportInvoicePrintAuditCsv(printAuditFilters);
                        } catch (error: any) {
                          notify.warning(error?.message || 'Unable to export audit CSV');
                        } finally {
                          setIsExportingAuditCsv(false);
                        }
                      }}
                      className="text-[10px] px-2.5 py-1.5 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                      disabled={isExportingAuditCsv}
                    >
                      {isExportingAuditCsv ? 'Exporting CSV...' : 'Export CSV'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const resetFilters = {
                          fromDate: '',
                          toDate: '',
                          copyType: '' as '' | InvoiceCopyType,
                          status: '' as '' | 'Completed' | 'Refunded',
                          printedBy: '',
                          invoiceNumber: '',
                        };
                        setPrintAuditFilters(resetFilters);
                        loadInvoicePrintAudit(resetFilters);
                      }}
                      className="text-[10px] px-2.5 py-1.5 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                    >
                      Reset
                    </button>
                    <span className="text-[10px] text-indigo-700">Rows: {printAuditSummary.totalRows}</span>
                    <span className="text-[10px] text-indigo-700">Invoices: {printAuditSummary.uniqueInvoices}</span>
                    <span className="text-[10px] text-indigo-700">Users: {printAuditSummary.uniquePrintedByCount}</span>
                  </div>

                  <div className="mt-2 rounded border border-indigo-100 bg-white max-h-52 overflow-auto">
                    {isLoadingPrintAudit ? (
                      <p className="p-2 text-[11px] text-slate-500">Loading audit report...</p>
                    ) : printAuditRows.length === 0 ? (
                      <p className="p-2 text-[11px] text-slate-500">No audit entries match the selected filters.</p>
                    ) : (
                      <table className="w-full text-[10px]">
                        <thead className="bg-indigo-50 text-indigo-700 uppercase tracking-wide">
                          <tr>
                            <th className="text-left px-2 py-1">Time</th>
                            <th className="text-left px-2 py-1">Invoice</th>
                            <th className="text-left px-2 py-1">Copy</th>
                            <th className="text-left px-2 py-1">User</th>
                            <th className="text-left px-2 py-1">Status</th>
                            <th className="text-right px-2 py-1">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {printAuditRows.map((row) => (
                            <tr key={row.id} className="border-t border-indigo-50 text-slate-700">
                              <td className="px-2 py-1">{new Date(row.printedAt).toLocaleString()}</td>
                              <td className="px-2 py-1 font-mono">{row.invoiceNumber}</td>
                              <td className="px-2 py-1">{row.copyType} #{row.printSequence}</td>
                              <td className="px-2 py-1">{row.printedBy}</td>
                              <td className="px-2 py-1">{row.transactionStatus}</td>
                              <td className="px-2 py-1 text-right font-mono">{formatMoney(Number(row.totalAmount || 0))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>

              {/* Action options */}
              <div className="mt-6 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
                  <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Invoice Copy Type</label>
                  <select
                    value={selectedCopyType}
                    onChange={(event) => setSelectedCopyType(event.target.value as InvoiceCopyType)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-indigo-500"
                  >
                    {INVOICE_COPY_TYPE_OPTIONS.map((copyType) => (
                      <option key={copyType} value={copyType}>{copyType}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="email"
                    value={shareEmailTo}
                    onChange={(event) => setShareEmailTo(event.target.value)}
                    placeholder="Recipient email"
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-indigo-500"
                  />
                  <input
                    type="text"
                    value={shareWhatsAppTo}
                    onChange={(event) => setShareWhatsAppTo(event.target.value)}
                    placeholder="WhatsApp number (E.164)"
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    disabled={isLoggingPrint || isDownloadingPdf || isSharingEmail || isSharingWhatsApp}
                    onClick={async () => {
                      try {
                        setIsLoggingPrint(true);
                        const printAudit = await logInvoicePrint(receiptModel, selectedCopyType);
                        await loadInvoicePrintHistory(receiptModel);
                        await loadInvoicePrintAudit();
                        printReceiptInvoice(receiptModel, undefined, {
                          copyType: printAudit.printLog.copyType,
                          watermarkText: printAudit.printSummary.watermarkText,
                          secondaryWatermarkText: printAudit.printSummary.secondaryWatermarkText,
                          printSequence: printAudit.printLog.printSequence,
                          isReprint: printAudit.printSummary.isReprint,
                          printedBy: printAudit.printLog.printedBy,
                          printedAt: printAudit.printLog.printedAt,
                        });
                      } catch (error: any) {
                        notify.warning(error?.message || 'Unable to print invoice copy');
                      } finally {
                        setIsLoggingPrint(false);
                      }
                    }}
                    className="py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center justify-center gap-1.5 border border-slate-200 disabled:opacity-60"
                  >
                    <Printer className="w-3.5 h-3.5" /> {isLoggingPrint ? 'Logging Print...' : 'Print Invoice Copy'}
                  </button>

                  <button
                    disabled={isLoggingPrint || isDownloadingPdf || isSharingEmail || isSharingWhatsApp}
                    onClick={async () => {
                      try {
                        setIsDownloadingPdf(true);
                        const printAudit = await logInvoicePrint(receiptModel, selectedCopyType);
                        await loadInvoicePrintHistory(receiptModel);
                        await loadInvoicePrintAudit();
                        await downloadInvoicePdf(receiptModel, {
                          copyType: printAudit.printLog.copyType,
                          printSequence: printAudit.printLog.printSequence,
                          watermarkText: printAudit.printSummary.watermarkText,
                          secondaryWatermarkText: printAudit.printSummary.secondaryWatermarkText,
                          printedBy: printAudit.printLog.printedBy,
                          printedAt: printAudit.printLog.printedAt,
                        });
                      } catch (error: any) {
                        notify.warning(error?.message || 'Unable to download invoice PDF');
                      } finally {
                        setIsDownloadingPdf(false);
                      }
                    }}
                    className="py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    <FileDown className="w-3.5 h-3.5" /> {isDownloadingPdf ? 'Generating PDF...' : 'Download PDF Copy'}
                  </button>

                  <button
                    disabled={isLoggingPrint || isDownloadingPdf || isSharingEmail || isSharingWhatsApp || !shareWhatsAppTo.trim()}
                    onClick={async () => {
                      try {
                        setIsSharingWhatsApp(true);
                        const printAudit = await logInvoicePrint(receiptModel, selectedCopyType);
                        await loadInvoicePrintHistory(receiptModel);
                        await loadInvoicePrintAudit();
                        await sendInvoiceWhatsApp(receiptModel, printAudit.printLog.copyType, printAudit.printLog.printSequence);
                        notify.warning('Invoice PDF shared successfully via WhatsApp API.');
                      } catch (error: any) {
                        notify.warning(error?.message || 'Unable to share invoice PDF via WhatsApp');
                      } finally {
                        setIsSharingWhatsApp(false);
                      }
                    }}
                    className="py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg flex items-center justify-center gap-1.5 border border-emerald-200 disabled:opacity-60"
                  >
                    <MessageCircle className="w-3.5 h-3.5" /> {isSharingWhatsApp ? 'Sending PDF...' : 'Share PDF on WhatsApp'}
                  </button>

                  <button
                    disabled={isLoggingPrint || isDownloadingPdf || isSharingEmail || isSharingWhatsApp || !shareEmailTo.trim()}
                    onClick={async () => {
                      try {
                        setIsSharingEmail(true);
                        const printAudit = await logInvoicePrint(receiptModel, selectedCopyType);
                        await loadInvoicePrintHistory(receiptModel);
                        await loadInvoicePrintAudit();
                        await sendInvoiceEmail(receiptModel, printAudit.printLog.copyType, printAudit.printLog.printSequence);
                        notify.warning('Invoice emailed successfully.');
                      } catch (error: any) {
                        notify.warning(error?.message || 'Unable to email invoice');
                      } finally {
                        setIsSharingEmail(false);
                      }
                    }}
                    className="py-2 text-xs font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg flex items-center justify-center gap-1.5 border border-sky-200 disabled:opacity-60"
                  >
                    <Mail className="w-3.5 h-3.5" /> {isSharingEmail ? 'Sending Email...' : 'Share by Email'}
                  </button>

                  <button
                    onClick={() => setReceiptModel(null)}
                    className="sm:col-span-2 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-black rounded-lg transition"
                  >
                    Close Receipt
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* QR Feature Modal */}
        {showQRFeature && (
          <QRFeatureView
            onClose={() => setShowQRFeature(false)}
            onProductFound={(product) => addToCart(product, getSelectedVariant(product))}
            products={products}
            userRole={currentRole}
            authToken={authToken}
          />
        )}
      </div>
    </div>
  );
}
