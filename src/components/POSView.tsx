import { ReportExportMenu } from './ReportExportMenu';
import { reportTime } from '../utils/reporting';
import type { BusinessReport } from '../utils/businessReport';
import { arsPrintLogoUrl, isArsPrintBrand, arsDisplayName } from '../utils/arsPrintLogo';
import { invoiceFooter } from '../utils/invoiceFooter';
import { notify } from '../utils/notifications';
import { sanitizeImageSrc } from '../utils/sanitizeImageSrc';
import { invoiceTotals, roundMoney } from '../utils/invoiceTotals';
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Ticket,
  UserCheck,
  CreditCard,
  QrCode,
  DollarSign,
  Printer,
  X,
  BadgeAlert,
  ScanLine,
  BookUser,
  Eye,
  FileDown,
  Mail,
  MessageCircle,
  Filter,
  Package,
} from 'lucide-react';
import { Product, ProductVariant, Customer, Employee, CartItem, SalesTransaction, StoreSettings, InvoiceCopyType, InvoicePrintAuditRow, InvoicePrintAuditResponse } from '../types';
import { QRFeatureView } from './QRFeatureView';

function BillingProductPhoto({ product, compact = false }: { product: Product; compact?: boolean }) {
  const src = sanitizeImageSrc(product.imageUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return <div className={(compact ? 'h-10 w-10' : 'h-16 w-16 sm:h-[72px] sm:w-[72px]') + ' relative shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center'}>
    {src && failedSrc !== src ? <img src={src} alt={product.name} loading="lazy" decoding="async" onError={()=>setFailedSrc(src)} className="h-full w-full object-contain p-0.5"/> : <div className="flex flex-col items-center text-slate-400"><Package aria-hidden="true" className="h-5 w-5"/>{!compact && <span className="mt-0.5 text-[9px]">No photo</span>}</div>}
  </div>;
}

function A4InvoicePreview({ id, request }: {
  id: string;
  request: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    const load = async () => {
      try {
        const response = await request('/api/transactions/' + encodeURIComponent(id) + '/pdf', { signal: controller.signal });
        if (!response.ok || !response.headers.get('Content-Type')?.includes('application/pdf')) throw new Error();
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, request]);
  return url
    ? <iframe title="A4 customer invoice" src={url + '#view=FitH'} className="w-full h-[65vh] rounded border border-slate-200" />
    : <p role="status">{failed ? 'Preview unavailable. Use Download PDF below to open this invoice.' : 'Loading invoice…'}</p>;
}

interface POSViewProps {
  products: Product[];
  customers: Customer[];
  employees: Employee[];
  cashierName: string;
  draftOwner: string;
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
  draftOwner,
  currentRole,
  taxConfig = { taxRate: 18, storeName: 'ARS Distributors', currency: 'LKR', invoicePrefix: 'SL-INV' },
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
  const activeShopName = (activeShopProfile?.name || taxConfig.storeName).replace(/^ARS (?:Hardware|Distribution|Distributor)$/i, 'ARS Distributors');
  const shopAddress = (activeShopProfile ? activeShopProfile.address : taxConfig.address) || '';
  const shopPhone = (activeShopProfile ? activeShopProfile.phone : taxConfig.phone) || '';
  const invoiceCompanyMeta = {
    companyLegalName: arsDisplayName(activeShopProfile?.invoiceCompanyMeta?.companyLegalName || activeShopName),
    companyTagline: activeShopProfile?.invoiceCompanyMeta?.companyTagline || 'Imports & Wholesale Distribution',
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
    || normalizedShopName.includes('ars pvt') || isArsPrintBrand(activeShopName);
  const effectivePrintFormat: 'a4' | 'thermal' = isWholesaleShop ? 'a4' : (printFormat === 'thermal' ? 'thermal' : 'a4');
  const printableShopLogoUrl = isArsPrintBrand(activeShopName) ? arsPrintLogoUrl : shopLogoUrl
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
  const authFetch = useCallback((url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${authToken}`);
    if (taxConfig.activeShopId) {
      headers.set('X-Shop-Id', taxConfig.activeShopId);
    }
    if (!headers.has('Content-Type') && init?.body) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...init, headers });
  }, [authToken, taxConfig.activeShopId]);
  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedInvoice, setExpandedInvoice] = useState(true);
  const [showInvoiceProducts, setShowInvoiceProducts] = useState(false);
  const [activeMobileView, setActiveMobileView] = useState<'catalog' | 'cart'>('cart');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedVariantByProduct, setSelectedVariantByProduct] = useState<Record<string, string>>({});
  const [unitPickerProductId, setUnitPickerProductId] = useState<string | null>(null);
  const [unitPickerUnitId, setUnitPickerUnitId] = useState('');
  const [unitPickerQty, setUnitPickerQty] = useState('1');
  const [priceEditKey, setPriceEditKey] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [priceReason, setPriceReason] = useState('');
  const [pickerCustomPrice, setPickerCustomPrice] = useState('');
  const [pickerPriceReason, setPickerPriceReason] = useState('');

  // Drafts are tab-local and scoped to the authenticated operator and shop.
  const draftKey = taxConfig.activeShopId && draftOwner ? `ars:invoice-draft:v1:${encodeURIComponent(draftOwner)}:${encodeURIComponent(taxConfig.activeShopId)}` : '';
  const [restoredDraft] = useState(() => {
    try {
      const raw = draftKey && sessionStorage.getItem(draftKey);
      const value = raw ? JSON.parse(raw) : null;
      return value && Array.isArray(value.cart) ? value : null;
    } catch { return null; }
  });
  const [checkoutUncertain, setCheckoutUncertain] = useState<boolean>(Boolean(restoredDraft?.pending));
  const [pendingCheckoutBody,setPendingCheckoutBody]=useState<string|null>(typeof restoredDraft?.requestBody==='string'?restoredDraft.requestBody:null);
  const checkoutLock=React.useRef(false);
  const [draftSaved, setDraftSaved] = useState(false);
  // Customer & Cart states
  // Never silently assign an invoice to the first customer in the database.
  const [selectedCustomer, setSelectedCustomer] = useState<Customer>(() => restoredDraft?.customer || {
    id: '', name: '', phone: '', email: '', address: '',
    loyaltyBalance: 0, purchaseCount: 0,
  });
  const [billingCustomerName, setBillingCustomerName] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [billingCustomerPhone, setBillingCustomerPhone] = useState<string>('');
  const [billingCustomerAddress, setBillingCustomerAddress] = useState<string>('');
  const [selectedSalesRepId, setSelectedSalesRepId] = useState<string>(restoredDraft?.repId || '');
  const activeSalesReps = employees.filter(rep => rep.shopId === taxConfig.activeShopId && rep.name.trim());
  const [cart, setCart] = useState<CartItem[]>(restoredDraft?.cart || []);
  const [editingDescriptionKey, setEditingDescriptionKey] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>(restoredDraft?.discountMode === 'percent' ? 'percent' : 'amount');
  const [discountInput, setDiscountInput] = useState<string>(restoredDraft?.discountInput || '0');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Credit Card' | 'Debit Card' | 'QR Code' | 'Bank Transfer' | 'Mobile Wallet' | 'Credit Account'>('Credit Account');
  const managerFinancialPosting=['Super Admin','Store Manager'].includes(currentRole);
  const [creditDueDate,setCreditDueDate]=useState<string>(typeof restoredDraft?.creditDueDate==='string'?restoredDraft.creditDueDate:'');
  const [creditEvidence,setCreditEvidence]=useState<string>(typeof restoredDraft?.creditEvidence==='string'?restoredDraft.creditEvidence:'');
  const creditToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const activeCreditTerms=managerFinancialPosting&&paymentMethod==='Credit Account';
  const invalidCreditTerms=activeCreditTerms&&Boolean(creditDueDate||creditEvidence.trim())&&(!creditDueDate||creditDueDate<creditToday||!creditEvidence.trim()||creditEvidence.trim().length>500);
  const [invoiceAccounts,setInvoiceAccounts]=useState<{id:string;name:string;kind:string;active:boolean;balance:number}[]>([]);
  const [invoiceAccountId,setInvoiceAccountId]=useState('');
  const [invoiceAccountsLoading,setInvoiceAccountsLoading]=useState(false);
  const [invoiceAccountsError,setInvoiceAccountsError]=useState('');
  const needsInvoiceAccount=managerFinancialPosting&&['Cash','Bank Transfer'].includes(paymentMethod);
  const matchingInvoiceAccounts=invoiceAccounts.filter(a=>a.active&&a.kind===(paymentMethod==='Cash'?'Office Cash':'Bank'));
  const selectedInvoiceAccount=matchingInvoiceAccounts.find(a=>a.id===invoiceAccountId);
  useEffect(()=>{
    setInvoiceAccountId('');setInvoiceAccounts([]);setInvoiceAccountsError('');
    if(!needsInvoiceAccount){setInvoiceAccountsLoading(false);return;}
    const controller=new AbortController();setInvoiceAccountsLoading(true);
    authFetch('/api/financial-accounts',{signal:controller.signal,cache:'no-store'}).then(async r=>{
      const data=await r.json();if(!r.ok||!Array.isArray(data))throw Error(data.error||'Unable to load financial accounts.');
      if(!controller.signal.aborted)setInvoiceAccounts(data);
    }).catch(e=>{if(!controller.signal.aborted)setInvoiceAccountsError(e.message);}).finally(()=>{if(!controller.signal.aborted)setInvoiceAccountsLoading(false);});
    return ()=>controller.abort();
  },[needsInvoiceAccount,paymentMethod,authFetch]);
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
    ...restoredDraft?.wholesaleMeta,
  });
  const persistDraft = (pending = checkoutUncertain, requestBody = pendingCheckoutBody) => {
    if (!draftKey) return false;
    try {
      if (cart.length === 0 && !requestBody) sessionStorage.removeItem(draftKey);
      else sessionStorage.setItem(draftKey, JSON.stringify({
        cart, customer: selectedCustomer, repId: selectedSalesRepId,
        discountMode, discountInput, creditDueDate, creditEvidence, wholesaleMeta: wholesaleMetaDraft, pending, requestBody:pending?requestBody:null,
      }));
      return true;
    } catch { return false; }
  };
  useEffect(() => {
    setDraftSaved(persistDraft());
  }, [draftKey, cart, selectedCustomer, selectedSalesRepId, discountMode, discountInput, wholesaleMetaDraft, creditDueDate,creditEvidence,checkoutUncertain,pendingCheckoutBody]);
  const [barcodeBuffer, setBarcodeBuffer] = useState('');
  const [barcodeNotification, setBarcodeNotification] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [lastScannedItem, setLastScannedItem] = useState<{ label: string; code: string } | null>(null);
  const [showQRFeature, setShowQRFeature] = useState(false);

  // Completed transaction receipt modal
  const [receiptModel, setReceiptModel] = useState<SalesTransaction | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  // A portal escapes the animated workspace's containing block and stacking context.
  useEffect(() => {
    if (!isReviewOpen) return;
    const body = document.body;
    const root = document.getElementById('root');
    const main = root?.querySelector('main');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyOverflow = body.style.overflow;
    const mainOverflow = main?.style.overflow;
    const previousInert = root?.inert;
    body.style.overflow = 'hidden';
    if (main) main.style.overflow = 'hidden';
    if (root) root.inert = true;
    document.getElementById('pos-review-dialog')?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = document.getElementById('pos-review-dialog');
      if (!dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
      if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      body.style.overflow = bodyOverflow;
      if (main) main.style.overflow = mainOverflow || '';
      if (root) root.inert = previousInert ?? false;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isReviewOpen]);
  useEffect(() => {
    if (!isReviewOpen || isSubmitting) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsReviewOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isReviewOpen, isSubmitting]);
  const [setupDialog, setSetupDialog] = useState<'customer' | 'representative' | null>(null);
  const [draftCustomerId, setDraftCustomerId] = useState('');
  const [draftRepId, setDraftRepId] = useState('');
  useEffect(() => {
    const startNewInvoice=()=>{
      if(isSubmitting || checkoutUncertain){notify.warning('Resolve the current checkout before starting a new invoice.');return;}
      if(cart.length && !window.confirm('Discard the current unpaid invoice draft and start a new invoice?'))return;
      try{if(draftKey)sessionStorage.removeItem(draftKey);}catch{notify.error('Unable to clear the saved draft.');return;}
      setCart([]);setSelectedCustomer({id:'',name:'',phone:'',email:'',address:'',loyaltyBalance:0,purchaseCount:0});
      setSelectedSalesRepId('');setBillingCustomerName('');setBillingCustomerPhone('');setBillingCustomerAddress('');
      setDiscountMode('amount');setDiscountInput('0');setPaymentMethod('Credit Account');setCreditDueDate('');setCreditEvidence('');
      setWholesaleMetaDraft({transportCharges:'',deliveryCharges:'',warrantyInformation:'',dispatchMethod:'',vehicleNumber:'',deliveryNoteNumber:'',batchNumber:'',supplierReference:'',deliveryStatus:''});
      setIsReviewOpen(false);setReceiptModel(null);setEditingDescriptionKey(null);setDescriptionDraft('');
      setDraftCustomerId('');setDraftRepId('');setCustomerSearch('');setSetupDialog('customer');
      notify.success('New invoice started.');
    };
    window.addEventListener('ars:new-invoice',startNewInvoice);
    return ()=>window.removeEventListener('ars:new-invoice',startNewInvoice);
  },[isSubmitting,checkoutUncertain,cart.length,draftKey]);
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

  const availableWholesaleCustomers = customers.filter((c) => c.id !== 'cust-walkin' && c.shopId === taxConfig.activeShopId && [c.name, c.id, c.phone, c.email, c.address].some((value) => String(value || '').toLowerCase().includes(customerSearch.trim().toLowerCase())));

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
            openUnitPicker(match.product, match.variant);
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

  const getCartKey = (item: CartItem) => `${item.product.id}::${item.sellingUnitId ? 'unit:'+item.sellingUnitId : item.variantId || 'base'}`;

  const getDefaultSellingUnit = (product: Product) => product.sharedStockUnits?.units.find(unit => unit.baseUnits === 1);
  const fitsSharedStock = (product: Product, lines: CartItem[]) => {
    let required = 0;
    for (const line of lines.filter(entry=>entry.product.id===product.id)) {
      const unit = product.sharedStockUnits?.units.find(entry=>entry.id===line.sellingUnitId);
      if (!unit || !Number.isSafeInteger(line.quantity) || line.quantity<=0 || !Number.isSafeInteger(unit.baseUnits) || unit.baseUnits<=0) return false;
      required += line.quantity * unit.baseUnits;
      if (!Number.isSafeInteger(required) || required > product.quantity) return false;
    }
    return true;
  };

  // All quantities are checked against the latest catalog, including stock already in the draft.
  const availableToAdd = (product: Product, variant?: ProductVariant, lines: CartItem[] = cart, sellingUnitId?: string) => {
    if (product.sharedStockUnits) {
      const unit = sellingUnitId ? product.sharedStockUnits.units.find(u=>u.id===sellingUnitId) : getDefaultSellingUnit(product);
      if (!unit || product.variants?.length) return 0;
      let used = 0;
      for (const line of lines.filter(entry => entry.product.id === product.id)) {
        const selected = product.sharedStockUnits.units.find(u => u.id === line.sellingUnitId);
        if (!selected) return 0;
        used += line.quantity * selected.baseUnits;
      }
      return Math.max(0, Math.floor((product.quantity - used) / unit.baseUnits));
    }
    const stock = Number(variant?.quantity ?? product.quantity);
    const used = lines.filter(entry => entry.product.id === product.id && (entry.variantId || '') === (variant?.id || '')).reduce((sum, entry) => sum + entry.quantity, 0);
    return Math.max(0, Math.floor(stock - used));
  };

  const stockIssue = (lines: CartItem[]): string | undefined => {
    for (const line of lines) {
      const product = products.find(p => p.id === line.product.id);
      if (!product) return line.product.name + ': product is no longer available.';
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) return product.name + ': invalid quantity.';
      if (product.sharedStockUnits) {
        if (!fitsSharedStock(product, lines)) return product.name + ': insufficient shared stock (Box/Piece). Reduce the quantity.';
      } else {
        const variant = product.variants?.find(v => v.id === line.variantId);
        if ((line.variantId && !variant) || (product.variants?.length && !variant)) return product.name + ': selling unit is no longer available.';
        const stock = Number(variant?.quantity ?? product.quantity);
        const required = lines.filter(entry => entry.product.id === product.id && (entry.variantId || '') === (line.variantId || '')).reduce((sum, entry) => sum + entry.quantity, 0);
        if (!Number.isFinite(stock) || required > stock) return product.name + ': only ' + stock + ' available; ' + required + ' requested.';
      }
    }
  };
  const currentStockIssue = stockIssue(cart);
  const maxLineQuantity = (line: CartItem) => {
    const product = products.find(p => p.id === line.product.id);
    if (!product) return 0;
    const others = cart.filter(entry => getCartKey(entry) !== getCartKey(line));
    if (product.sharedStockUnits) {
      const unit = product.sharedStockUnits.units.find(u => u.id === line.sellingUnitId);
      if (!unit) return 0;
      let used = 0;
      for (const other of others.filter(entry => entry.product.id === product.id)) {
        const selected = product.sharedStockUnits.units.find(u => u.id === other.sellingUnitId);
        if (!selected) return 0;
        used += other.quantity * selected.baseUnits;
      }
      return Math.max(0, Math.floor((product.quantity - used) / unit.baseUnits));
    }
    const variant = product.variants?.find(v => v.id === line.variantId);
    if ((line.variantId && !variant) || (product.variants?.length && !variant)) return 0;
    return availableToAdd(product, variant, others);
  };

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
  const addToCart = (product: Product, variant?: ProductVariant, sellingUnitId?: string, requestedQty = 1, customPrice?: number, reason?: string) => {
    if (customPrice !== undefined && (!isAdminSeller || !Number.isFinite(customPrice) || customPrice <= 0 || customPrice > 1_000_000_000 || roundMoney(customPrice)!==customPrice || !reason?.trim() || reason.trim().length>250)) { notify.warning('Enter a valid custom price and reason.'); return false; }
    const latest = products.find(p => p.id === product.id);
    if (!latest) { notify.warning(product.name + ': product unavailable.'); return; }
    product = latest;
    const requestedVariantId = variant?.id;
    variant = requestedVariantId ? product.variants?.find(v => v.id === requestedVariantId) : getSelectedVariant(product);
    if (requestedVariantId && !variant) { notify.warning(product.name + ': selected variant is no longer available.'); return false; }
    const available = availableToAdd(product, variant, cart, sellingUnitId);
    if (!Number.isSafeInteger(requestedQty) || requestedQty < 1 || requestedQty > available) { notify.warning(product.name + ': only ' + available + ' available to add.'); return false; }
    if (product.sharedStockUnits) {
      const unit = sellingUnitId ? product.sharedStockUnits.units.find(u=>u.id===sellingUnitId) : getDefaultSellingUnit(product);
      if (!unit || product.variants?.length) { notify.warning('Invalid shared selling-unit configuration.'); return false; }
      const existing = cart.find(entry=>entry.product.id===product.id && entry.sellingUnitId===unit.id);
      if (existing && (existing.customUnitPrice ?? unit.sellingPrice)!==(customPrice ?? unit.sellingPrice)) { notify.warning('This unit is already on the invoice at another price. Use the same rate or edit its existing line price and quantity.'); return false; }
      const next: CartItem[] = existing ? cart.map(entry=>entry===existing?{...entry,quantity:entry.quantity+requestedQty}:entry) : [...cart,{
        product, quantity:requestedQty, discount:0, sellingUnitId:unit.id, variantUnit:unit.label,
        unitPrice:unit.sellingPrice, customUnitPrice:customPrice, priceOverrideReason:customPrice!==undefined?reason?.trim():undefined, unitCostPrice:Math.round(product.costPrice*unit.baseUnits*100)/100,
        invoiceDescription:String(product.description || product.longDescription || '').trim().slice(0,250)
      }];
      if (!fitsSharedStock(product,next)) { notify.warning('Insufficient shared stock.'); return; }
      setCart(next);
      return true;
    }
    const resolvedVariant = variant || getSelectedVariant(product);
    const productStock = Number(product.quantity || 0);
    const variantStock = resolvedVariant ? Number(resolvedVariant.quantity || 0) : productStock;
    if (variantStock <= 0) { notify.warning(product.name + ': out of stock.'); return; }

    const existing = cart.find((item) => item.product.id === product.id && (item.variantId || '') === (resolvedVariant?.id || ''));
    const key = `${product.id}::${resolvedVariant?.id || 'base'}`;
    if (existing) {
      const standardRate = resolvedVariant?.sellingPrice ?? product.sellingPrice;
      if ((existing.customUnitPrice ?? existing.unitPrice ?? existing.product.sellingPrice) !== (customPrice ?? standardRate)) {
        notify.warning('This item is already on the invoice at another price. Use the same rate or edit its existing line price and quantity.'); return false;
      }
      updateCartQty(key, existing.quantity + requestedQty);
      return true;
    }

    setCart([
      ...cart,
      {
        product,
        invoiceDescription: String(product.description || product.longDescription || '').trim().slice(0, 250),
        quantity: requestedQty,
        discount: 0,
        variantId: resolvedVariant?.id,
        variantName: resolvedVariant?.name,
        variantUnit: resolvedVariant?.unit,
        variantSku: resolvedVariant?.sku,
        variantBarcode: resolvedVariant?.barcode,
        unitPrice: resolvedVariant?.sellingPrice ?? product.sellingPrice,
        customUnitPrice: customPrice,
        priceOverrideReason: customPrice !== undefined ? reason?.trim() : undefined,
        unitCostPrice: resolvedVariant?.costPrice,
      },
    ]);
    return true;
  };

  // Display each unit independently; a full box can be unavailable while pieces remain.
  const sellingUnitAvailability = (product: Product) => (product.sharedStockUnits?.units || []).map(unit=>({unit,remaining:availableToAdd(product,undefined,cart,unit.id)}));
  const openUnitPicker = (product: Product, variant?: ProductVariant) => {
    if (!product.sharedStockUnits) return addToCart(product, variant);
    const units = product.sharedStockUnits.units;
    const unit = units.find(u=>u.baseUnits===1 && availableToAdd(product, undefined, cart, u.id)>0) || units.find(u=>availableToAdd(product, undefined, cart, u.id)>0);
    if (!unit) { notify.warning(product.name + ': no more stock available to add.'); return false; }
    setUnitPickerProductId(product.id);
    setUnitPickerUnitId(unit.id);
    setUnitPickerQty('1');
    setPickerCustomPrice(''); setPickerPriceReason('');
    return true;
  };
  const pickerProduct = products.find(p=>p.id===unitPickerProductId);
  const pickerUnit = pickerProduct?.sharedStockUnits?.units.find(u=>u.id===unitPickerUnitId);
  const pickerAvailable = pickerProduct && pickerUnit ? availableToAdd(pickerProduct, undefined, cart, pickerUnit.id) : 0;

  const validCustomPrice = (value:string, reason:string) => value.trim()!=='' && Number.isFinite(Number(value)) && Number(value)>0 && Number(value)<=1_000_000_000 && roundMoney(Number(value))===Number(value) && !!reason.trim() && reason.trim().length<=250;
  const priceLine = cart.find(item=>getCartKey(item)===priceEditKey);
  const openPriceEditor = (item:CartItem) => { if(!isAdminSeller) return; setPriceEditKey(getCartKey(item)); setPriceDraft(String(item.customUnitPrice ?? item.unitPrice ?? item.product.sellingPrice)); setPriceReason(item.priceOverrideReason || ''); };
  // A customer-specific description applies to this invoice line only.
  const saveInvoiceLineDescription = () => {
    if (!editingDescriptionKey) return;
    const clean = descriptionDraft.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 250);
    setCart(current => current.map(item =>
      getCartKey(item) === editingDescriptionKey ? { ...item, invoiceDescription: clean } : item));
    setEditingDescriptionKey(null);
    setDescriptionDraft('');
  };

  // Switch between existing independently stocked variants. Shared packaging conversion is a separate inventory migration.
  const changeCartVariant = (itemKey: string, variantId: string) => {
    const item = cart.find(entry => getCartKey(entry) === itemKey);
    const product = products.find(entry => entry.id === item?.product.id);
    const variant = product?.variants?.find(entry => entry.id === variantId);
    if (!item || !product || !variant || item.variantId === variant.id) return;
    const existing = cart.find(entry => entry.product.id === product.id && entry.variantId === variant.id);
    if (existing) { notify.warning('This selling unit is already on the invoice. Adjust its quantity separately.'); return; }
    if (Number(variant.quantity) < item.quantity) { notify.warning('Insufficient stock for the selected selling unit.'); return; }
    setCart(current => current.map(entry => getCartKey(entry) === itemKey ? {
      ...entry, product, variantId: variant.id, variantName: variant.name, variantUnit: variant.unit,
      variantSku: variant.sku, variantBarcode: variant.barcode, unitPrice: variant.sellingPrice, customUnitPrice:undefined, priceOverrideReason:undefined,
      unitCostPrice: variant.costPrice, discount: 0, discountAmount: 0,
    } : entry));
  };

  const changeSharedSellingUnit = (itemKey: string, unitId: string) => {
    const item = cart.find(entry=>getCartKey(entry)===itemKey);
    const product = products.find(entry=>entry.id===item?.product.id);
    const unit = product?.sharedStockUnits?.units.find(entry=>entry.id===unitId);
    if (!item || !product || !unit || item.sellingUnitId===unit.id) return;
    if (cart.some(entry=>entry!==item && entry.product.id===product.id && entry.sellingUnitId===unit.id)) {
      notify.warning('This selling unit is already on the invoice. Adjust its quantity separately.'); return;
    }
    const next = cart.map(entry=>entry===item?{...entry,product,sellingUnitId:unit.id,variantUnit:unit.label,
      unitPrice:unit.sellingPrice,customUnitPrice:undefined,priceOverrideReason:undefined,unitCostPrice:Math.round(product.costPrice*unit.baseUnits*100)/100,discount:0,discountAmount:0}:entry);
    if (!fitsSharedStock(product,next)) { notify.warning('Insufficient shared stock for this unit.'); return; }
    setCart(next);
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
    const product = products.find(entry=>entry.id===cart.find(item=>getCartKey(item)===itemKey)?.product.id);
    const line = cart.find(item=>getCartKey(item)===itemKey);
    if (!line || !product) { notify.warning('Product stock unavailable.'); return; }
    if (nextQty > maxLineQuantity(line) && nextQty >= line.quantity) { notify.warning(product.name + ': maximum available quantity is ' + maxLineQuantity(line) + '.'); return; }
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
    const unitPrice = Number(item.customUnitPrice ?? item.unitPrice ?? item.product.sellingPrice) || 0;
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

  // The API and A4 invoice always receive an actual rupee discount.
  // Percentage is applied to the already item-discounted subtotal, never compounded on tax.
  const requestedDiscount = Number(discountInput);
  const normalizedDiscountInput = Number.isFinite(requestedDiscount) ? Math.max(0, requestedDiscount) : 0;
  const cashDiscount = roundMoney(Math.min(subtotal,
    discountMode === 'percent'
      ? subtotal * Math.min(100, normalizedDiscountInput) / 100
      : normalizedDiscountInput));
  const { tax, total } = invoiceTotals(subtotal, taxConfig.taxRate, cashDiscount);

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
    const packaging = /(?:^|[·–-]\s*)(box|pack|pair|piece|carton|bundle|roll|set)(?:\s+of\s+\d+)?\s*$/.exec(name);
    if(packaging)return packaging[1][0].toUpperCase()+packaging[1].slice(1);
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
    const fileName = tx.invoiceNumber + '.pdf';
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

  const printAuditReport = async (filters?: typeof printAuditFilters): Promise<BusinessReport> => {
    const activeFilters = filters || printAuditFilters;
    const query = new URLSearchParams();
    if (activeFilters.fromDate) query.set('fromDate', activeFilters.fromDate);
    if (activeFilters.toDate) query.set('toDate', activeFilters.toDate);
    if (activeFilters.copyType) query.set('copyType', activeFilters.copyType);
    if (activeFilters.status) query.set('status', activeFilters.status);
    if (activeFilters.printedBy) query.set('printedBy', activeFilters.printedBy);
    if (activeFilters.invoiceNumber) query.set('invoiceNumber', activeFilters.invoiceNumber.trim());

    const response = await authFetch(`/api/invoice-print-audit/export-report?${query.toString()}`);
    if (!response.ok) throw new Error('Unable to export the invoice print audit.');
    return response.json();
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

  const printReceiptInvoice = async (
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
              ${itm.invoiceDescription ? `<div class="item-meta">${escapeHtml(itm.invoiceDescription)}</div>` : ''}
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
    // A4 uses the persisted invoice PDF only. Never fall back to dashboard HTML.
    const query=new URLSearchParams({
      copyType:printMeta?.copyType||'Original Copy',
      printSequence:String(printMeta?.printSequence||1),
      watermark:printMeta?.watermarkText||'ORIGINAL COPY',
      secondaryWatermark:printMeta?.secondaryWatermarkText||'',
      printedBy:printMeta?.printedBy||'',
      printedAt:printMeta?.printedAt||'',
    });
    try {
      const response=await authFetch(`/api/transactions/${tx.id}/pdf?${query.toString()}`);
      if(!response.ok || !response.headers.get('Content-Type')?.includes('application/pdf')) throw new Error('Unable to generate invoice PDF');
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      if(printWindow.closed){URL.revokeObjectURL(url);notify.warning('Invoice saved. Open its PDF from invoice history.');return;}
      printWindow.location.replace(url);
      printWindow.focus();
      const release=window.setInterval(()=>{if(printWindow.closed){URL.revokeObjectURL(url);window.clearInterval(release);}},5000);
    } catch(error) {
      printWindow.close();
      notify.warning('Invoice saved, but PDF could not open. Use Download PDF from invoice history; do not create another sale.');
    }
  };

  // Process core checkout
  const handleCheckout = async () => {
    if (cart.length === 0 || isSubmitting || checkoutUncertain) return;
    const issue = stockIssue(cart);
    if (issue) { notify.warning(issue); setIsReviewOpen(false); return; }
    if (!selectedCustomer.id || !customers.some((customer) => customer.id === selectedCustomer.id && customer.id !== 'cust-walkin' && customer.shopId === taxConfig.activeShopId)) {
      notify.warning('Select a registered wholesale customer shop before creating the invoice. Add new shops in Customers.');
      return;
    }
    if (!activeSalesReps.some(rep => rep.id === selectedSalesRepId)) {
      notify.warning('Select the Sales Representative responsible for this invoice.');
      return;
    }
    if (paymentMethod === 'Credit Account' && !creditAccountAllowed) { notify.warning('Customer credit limit must cover this invoice.'); return; }
    if(invalidCreditTerms){notify.warning('Enter a valid agreed due date and payment agreement reference, or leave both blank.');return;}
    if(needsInvoiceAccount&&(!selectedInvoiceAccount||invoiceAccountsLoading||total<=0)){notify.warning('Select an active receiving account for the paid invoice.');return;}
    if (paymentMethod !== 'Credit Account' && !window.confirm('Confirm full payment of '+formatMoney(total)+' has already been received. Otherwise choose Pay later.')) return;
    const requestBody=JSON.stringify({requestId:crypto.randomUUID(),
          cartItems: cart,
          customerId: selectedCustomer.id,
          customerName: (billingCustomerName || '').trim() || selectedCustomer.name,
          customerPhone: (billingCustomerPhone || '').trim() || undefined,
          customerAddress: (billingCustomerAddress || '').trim() || undefined,
          salesRepId: selectedSalesRepId,
          paymentMethod: paymentMethod,
          destinationAccountId:needsInvoiceAccount?selectedInvoiceAccount?.id:undefined,
          creditTerms:activeCreditTerms&&creditDueDate?{dueDate:creditDueDate,evidence:creditEvidence.trim()}:undefined,
          paymentStatus: paymentMethod === 'Credit Account'
            ? 'CREDIT SALE'
            : 'PAID',
          wholesaleMeta: {
            invoiceDiscountMode: discountMode,
            invoiceDiscountPercent: discountMode === 'percent' ? Math.min(100, normalizedDiscountInput) : undefined,
            ...(isWholesaleShop ? {
                transportCharges: Number(wholesaleMetaDraft.transportCharges || 0),
                deliveryCharges: Number(wholesaleMetaDraft.deliveryCharges || 0),
                warrantyInformation: wholesaleMetaDraft.warrantyInformation.trim() || undefined,
                dispatchMethod: wholesaleMetaDraft.dispatchMethod.trim() || undefined,
                vehicleNumber: wholesaleMetaDraft.vehicleNumber.trim() || undefined,
                deliveryNoteNumber: wholesaleMetaDraft.deliveryNoteNumber.trim() || undefined,
                batchNumber: wholesaleMetaDraft.batchNumber.trim() || undefined,
                supplierReference: wholesaleMetaDraft.supplierReference.trim() || undefined,
                deliveryStatus: wholesaleMetaDraft.deliveryStatus.trim() || undefined,
              } : {}),
          },
          discountAmount: cashDiscount,
          cashReceived: paymentMethod === 'Cash' ? total : undefined,

    });
    if (!persistDraft(true,requestBody)) {
      notify.error('Unable to protect this invoice draft. Check browser storage before checkout.');
      return;
    }
    setPendingCheckoutBody(requestBody);
    await submitCheckout(requestBody);
  };
  const submitCheckout=async(requestBody:string)=>{
    if(checkoutLock.current)return;
    checkoutLock.current=true;
    setCheckoutUncertain(true);
    const printWindow = createPrintWindow();
    setIsSubmitting(true);

    try {
      const response = await authFetch('/api/transactions', {
        method: 'POST',
        body: requestBody,
      });

      if (response.ok) {
        // The sale is committed; never restore it as an unfinished invoice.
        const completedTx = await response.json();
        if(!completedTx?.id||!completedTx?.invoiceNumber)throw Error('Invalid invoice confirmation.');
        try { sessionStorage.removeItem(draftKey); } catch { /* exact replay remains safe */ }
        setPendingCheckoutBody(null);
        setCart([]);
        setCheckoutUncertain(false);
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
        setIsReviewOpen(false);
        setReceiptModel(txWithQr);
        notify.success(`Invoice ${completedTx.invoiceNumber} saved for ${completedTx.customerName}.`);
        setSelectedCopyType('Duplicate Copy');
        try {
          const printAudit = await logInvoicePrint(txWithQr, 'Original Copy');
          await loadInvoicePrintHistory(txWithQr);
          await printReceiptInvoice(txWithQr, printWindow, {
            copyType: printAudit.printLog.copyType,
            watermarkText: printAudit.printSummary.watermarkText,
            secondaryWatermarkText: printAudit.printSummary.secondaryWatermarkText,
            printSequence: printAudit.printLog.printSequence,
            isReprint: printAudit.printSummary.isReprint,
            printedBy: printAudit.printLog.printedBy,
            printedAt: printAudit.printLog.printedAt,
          });
        } catch {
          await printReceiptInvoice(txWithQr, printWindow);
          notify.warning('Sale saved, but print audit log failed. Printed without tracked copy label.');
        }
        // Require an explicit representative for each new invoice; another rep may handle the next sale.
        setSelectedSalesRepId('');
        // Clear active cart states
        setCart([]);
        setDiscountMode('amount');
        setDiscountInput('0');
        setPaymentMethod('Credit Account');setCreditDueDate('');setCreditEvidence('');
        onRefreshDb(); // Reload stock amounts parent state
      } else {
        // Keep the exact request until confirmed or manually reconciled; a retry must never create a new ID.
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
      checkoutLock.current=false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 min-h-0 select-none motion-safe:animate-fade-in">
      {/* Mobile view selector (visible only on lg:hidden) */}
      <div className="lg:hidden flex border border-slate-200 bg-white rounded-xl p-1 shadow-2xs shrink-0">
        <button
          type="button"
          onClick={() => { setExpandedInvoice(false); setActiveMobileView('catalog'); }}
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0 items-start">
        {/* Primary product workspace: 8 of 12 desktop columns */}
        <div className={`lg:col-span-7 min-w-0 flex-col space-y-3 ${expandedInvoice ? 'hidden' : activeMobileView === 'catalog' ? 'flex' : 'hidden lg:flex'}`}>
        {/* Search header bar */}
        <div className="bg-white px-3 py-2 rounded-xl border border-slate-100 flex flex-wrap gap-2 items-center justify-between">
          <div className="relative min-w-[190px] flex-1">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
            <input
              id="pos-search-input"
              type="text"
              placeholder="Find a product, SKU or barcode..."
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
        <div id="pos-product-grid" className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 gap-2 auto-rows-min overflow-y-auto max-h-[min(72dvh,850px)] pr-1">
          {filteredProducts.map((p) => {
            const selectedVariant = getSelectedVariant(p);
            const unitAvailability = sellingUnitAvailability(p);
            const displayUnit = unitAvailability.find(row=>row.unit.id===getDefaultSellingUnit(p)?.id && row.remaining>0) || unitAvailability.find(row=>row.remaining>0) || unitAvailability[0];
            const activeStock = displayUnit ? displayUnit.remaining : availableToAdd(p, selectedVariant);
            const activeReorderLevel = Number(selectedVariant?.reorderLevel ?? p.reorderLevel);
            const activePrice = Number(displayUnit?.unit.sellingPrice ?? selectedVariant?.sellingPrice ?? p.sellingPrice);
            const isLowStock = (p.sharedStockUnits ? unitAvailability.reduce((max,row)=>Math.max(max,row.remaining*row.unit.baseUnits),0) : activeStock) <= activeReorderLevel;
            const isOut = activeStock <= 0;

            return (
              <div
                key={p.id}
                id={`pos-product-${p.id}`}
                onClick={() => openUnitPicker(p, selectedVariant)}
                className={`bg-white rounded-xl border p-2.5 flex flex-col justify-between cursor-pointer group transition-colors duration-150 relative min-w-0 ${
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

                <div className="flex items-start gap-2 min-w-0">
                  <BillingProductPhoto product={p}/>
                  <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase">
                    {p.category}
                  </span>
                  <h5 className="font-sans font-bold text-slate-900 text-xs mt-0.5 leading-snug group-hover:text-indigo-600 transition line-clamp-2">
                    {p.name}
                  </h5>
                  <p className="text-[10px] text-slate-500 mt-1 break-all line-clamp-2">
                    {p.sku}
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
                  {p.sharedStockUnits && <span className="mt-1 block text-[10px] font-semibold text-indigo-600">{p.sharedStockUnits.units.map(u=>u.label).join(' / ')}</span>}
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1 items-center justify-between">
                  <span className="text-sm font-bold text-slate-950 font-mono">
                    {formatMoney(activePrice)}{displayUnit && <span className="ml-1 text-[10px] font-normal">/ {displayUnit.unit.label}</span>}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      isOut
                        ? 'bg-rose-100 text-rose-700'
                        : isLowStock
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {isOut ? 'No stock left to add' : unitAvailability.length ? unitAvailability.map(row=>`${row.unit.label}: ${row.remaining}`).join(' · ') : `Available: ${activeStock}`}
                  </span>
                </div>
              </div>
            );
          })}

          {filteredProducts.length === 0 && (
            <div className="col-span-full py-16 text-center bg-white rounded-xl border border-dashed border-slate-200 text-slate-400">
              <BadgeAlert className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-sm font-semibold mt-2 text-slate-700">{products.length === 0 ? 'No products registered yet' : 'No matching products found'}</p>
              <p className="mt-1 text-xs text-slate-500">{products.length === 0
                ? 'Add the first product in Products before creating an invoice.'
                : 'Try clearing the search or selecting All categories.'}</p>
              {products.length > 0 && (searchTerm || selectedCategory !== 'All') && (
                <button type="button" onClick={() => {setSearchTerm('');setSelectedCategory('All');}}
                  className="mt-3 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                  Clear product filters
                </button>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Compact order summary: 4 of 12 desktop columns */}
      <div className={`${expandedInvoice ? 'lg:col-span-12' : 'lg:col-span-5'} min-w-0 bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex-col min-h-[400px] lg:h-[calc(100dvh-115px)] lg:min-h-[440px] lg:overflow-hidden ${expandedInvoice || activeMobileView === 'cart' ? 'flex' : 'hidden lg:flex'}`}>
        <div className="shrink-0">
          {/* Active Operator Banner */}
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 mb-2 text-xs font-sans">
            <div>
              <p className="text-xs font-bold text-slate-900">Current invoice</p>
              <p className="font-medium text-slate-800">Operator: <span className="text-indigo-600 font-semibold">{cashierName}</span></p>
            </div>
            <div className="p-1 px-2.5 bg-slate-50 rounded-md border border-slate-150 text-slate-600 text-[11px] font-mono">
              <button type="button" aria-pressed={expandedInvoice} onClick={() => { setExpandedInvoice(v => !v); setSelectedCategory('All'); setSearchTerm(''); setShowInvoiceProducts(false); }} className="hidden lg:inline-flex font-semibold text-indigo-700 hover:underline">{expandedInvoice ? 'Quick billing' : 'Professional invoice'}</button>
              <span className="lg:hidden">Invoice</span>
            </div>
          </div>

          {lastScannedItem && (
            <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] text-indigo-800 flex items-center justify-between gap-2">
              <span className="font-semibold truncate">Scanned: {lastScannedItem.label}</span>
              <span className="font-mono text-indigo-600 shrink-0">[{lastScannedItem.code}]</span>
            </div>
          )}

          {/* Required bill assignment is shown in summary, edited in focused dialogs. */}
          <div className="mb-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2" aria-label="Invoice assignment">
            <button type="button" id="pos-open-customer" onClick={() => {setCustomerSearch('');setDraftCustomerId(selectedCustomer.id === 'cust-walkin' ? '' : selectedCustomer.id);setSetupDialog('customer');}}
              className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">1 · Customer shop *</span>
              <span className="mt-0.5 block break-words text-xs font-semibold text-slate-900">{selectedCustomer.id && selectedCustomer.id !== 'cust-walkin' ? selectedCustomer.name : 'Choose customer shop'}</span>
              <span className="mt-0.5 block text-[10px] text-indigo-600">{selectedCustomer.id && selectedCustomer.id !== 'cust-walkin' ? 'Change shop' : 'Tap to select shop'} →</span>
            </button>
            <button type="button" id="pos-open-representative" onClick={() => {setDraftRepId(selectedSalesRepId);setSetupDialog('representative');}}
              className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">2 · Sales Representative *</span>
              <span className="mt-0.5 block break-words text-xs font-semibold text-slate-900">{activeSalesReps.find(rep=>rep.id===selectedSalesRepId)?.name || 'Choose representative'}</span>
              <span className="mt-0.5 block text-[10px] text-indigo-600">{selectedSalesRepId ? 'Change representative' : 'Tap to select rep'} →</span>
            </button>
          </div>
          {expandedInvoice && (
            <div className="relative mb-2 flex gap-2">
              <input id="pos-invoice-product-search" aria-label="Find product for invoice" placeholder="Search product, SKU or barcode..." value={searchTerm}
                onFocus={() => { setSelectedCategory('All'); setShowInvoiceProducts(true); }}
                onChange={event => { setSearchTerm(event.target.value); setShowInvoiceProducts(true); }}
                onKeyDown={event => { if (event.key === 'Escape') setShowInvoiceProducts(false); }}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-amber-500" />
              <button type="button" onClick={() => { setSelectedCategory('All'); setShowInvoiceProducts(v => !v); }} className="rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white">Browse</button>
              <button type="button" onClick={() => { setShowInvoiceProducts(false); setShowQRFeature(true); }} className="rounded-lg border border-slate-200 px-3 text-xs font-semibold"><QrCode className="inline h-4 w-4" /> Scan</button>
              {showInvoiceProducts && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
                  <div className="flex justify-between items-center px-2 py-1 text-xs text-slate-500"><span>{filteredProducts.length} matching products</span><button type="button" onClick={() => setShowInvoiceProducts(false)} aria-label="Close product results"><X className="h-4 w-4" /></button></div>
                  {filteredProducts.slice(0, 30).map(product => {
                    const variant = getSelectedVariant(product);
                    const unitAvailability = sellingUnitAvailability(product);
                    const displayUnit = unitAvailability.find(row=>row.unit.id===getDefaultSellingUnit(product)?.id && row.remaining>0) || unitAvailability.find(row=>row.remaining>0) || unitAvailability[0];
                    const stock = displayUnit ? displayUnit.remaining : availableToAdd(product, variant);
                    return <div key={product.id} className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-2 text-xs">
                      <BillingProductPhoto product={product} compact/><span className="flex-1 min-w-[120px] font-medium">{product.name}<span className="block text-slate-500">{product.sku} · {stock > 0 ? (unitAvailability.length ? unitAvailability.map(row=>`${row.unit.label}: ${row.remaining}`).join(' · ') : 'Available to add: '+stock) : 'No stock left to add'}</span></span>
                      {!!product.variants?.length && <select aria-label={`Variant for ${product.name}`} value={variant?.id || ''} onChange={event => setSelectedVariantByProduct(old => ({...old, [product.id]: event.target.value}))} className="max-w-[160px] rounded border px-1 py-1">{product.variants.map(v => <option key={v.id} value={v.id}>{v.name} ({v.unit})</option>)}</select>}
                      <span>{formatMoney(Number(displayUnit?.unit.sellingPrice ?? variant?.sellingPrice ?? product.sellingPrice))}{displayUnit && ` / ${displayUnit.unit.label}`}</span>
                      <button type="button" disabled={stock <= 0} onClick={() => { if(openUnitPicker(product, variant)) { setSearchTerm(''); setShowInvoiceProducts(false); } }} className="rounded bg-amber-400 px-3 py-1.5 font-semibold text-slate-900 disabled:opacity-40">{stock <= 0 ? "Unavailable" : "Add"}</button>
                    </div>;
                  })}
                  {filteredProducts.length === 0 && <p className="p-3 text-xs text-slate-500">No matching products.</p>}
                  {filteredProducts.length > 30 && <p className="p-2 text-xs text-slate-500">Refine search to see more results.</p>}
                </div>
              )}
            </div>
          )}
        </div>
          {checkoutUncertain && !isSubmitting && <div role="alert" className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            Previous checkout outcome is uncertain. Retry the original protected request, or reconcile it in Sales Reports.
            <div className="mt-1 flex flex-wrap gap-2">
              {pendingCheckoutBody?<button type="button" className="underline font-semibold" onClick={()=>void submitCheckout(pendingCheckoutBody)}>Retry exact invoice</button>:<button type="button" className="underline font-semibold" onClick={() => { if (window.confirm('Confirm you checked Sales Reports and this invoice was NOT saved.')) setCheckoutUncertain(false); }}>Invoice not saved — resume</button>}
              <button type="button" className="underline font-semibold" onClick={() => { if (window.confirm('Discard this draft after confirming the sale was already saved?')) { setPendingCheckoutBody(null); setCart([]); setCheckoutUncertain(false); } }}>Already saved — discard draft</button>
            </div>
          </div>}
          {/* Cart Header */}
          <div className={`shrink-0 grid gap-2 text-xs font-semibold text-slate-600 border-b border-slate-200 pb-2 mb-2 ${expandedInvoice ? "lg:grid-cols-[minmax(0,1fr)_110px_105px_100px_75px_90px_115px]" : "grid-cols-1"}`}>
            <span>Invoice items · {cart.length} lines</span>
            {expandedInvoice && <><span className="hidden lg:block text-center">U/M</span><span className="hidden lg:block text-right">Unit price</span><span className="hidden lg:block text-center">Quantity</span><span className="hidden lg:block text-center">Disc %</span><span className="hidden lg:block text-center">Disc Rs.</span><span className="hidden lg:block text-right">Line total</span></>}
          </div>

          {/* Cart Scroll list */}
          <div id="pos-cart-scroller" className="min-h-0 flex-1 overflow-y-auto space-y-1 pr-1">
            {cart.map((item) => {
              const lineKey = getCartKey(item);
              const basePrice = Number(item.customUnitPrice ?? item.unitPrice ?? item.product.sellingPrice);
              const pricing = getLinePricing(item);

              return (
                <div key={lineKey} className={`grid gap-2 items-center border-b border-slate-100 py-1 text-xs font-sans ${expandedInvoice ? "lg:grid-cols-[minmax(0,1fr)_110px_105px_100px_75px_90px_115px]" : "grid-cols-1"}`}>
                  {/* description */}
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 break-words" title={item.product.name}>
                      {item.product.name}
                    </p>
                    {item.variantName && (
                      <p className="text-[10px] text-indigo-600 font-semibold mt-0.5">
                        {item.variantName}{item.variantUnit ? ` (${item.variantUnit})` : ''}
                      </p>
                    )}
                    <button type="button"
                      aria-label={`Edit invoice description for ${item.product.name}`}
                      onClick={() => {setEditingDescriptionKey(lineKey);setDescriptionDraft(item.invoiceDescription || '');}}
                      className="mt-1 block max-w-full break-words whitespace-normal text-left text-xs font-medium text-indigo-600 hover:underline">
                      {item.invoiceDescription ? `Description: ${item.invoiceDescription}` : '+ Add invoice description'}
                    </button>
                    <div className={`flex items-center gap-1.5 text-xs text-slate-500 font-mono mt-0.5 ${expandedInvoice ? "lg:hidden" : ""}`}>
                      <button type="button" disabled={!isAdminSeller} onClick={()=>openPriceEditor(item)} className="font-semibold text-indigo-700 disabled:text-slate-500">{formatMoney(basePrice)} / unit {isAdminSeller && "· Edit rate"}</button>{item.customUnitPrice!==undefined && <span className="text-amber-700">Custom</span>}
                      {pricing.percentDiscount > 0 && <span className="text-emerald-600">(-{pricing.percentDiscount}%)</span>}
                      {pricing.rupeeDiscount > 0 && <span className="text-emerald-600">(-{formatMoney(pricing.rupeeDiscount)})</span>}
                    </div>

                  </div>

                  <div className="min-w-0"><label className="block text-[10px] text-slate-500 lg:sr-only">U/M</label>{item.product.sharedStockUnits ? <select aria-label={`Shared selling unit for ${item.product.name}`} value={item.sellingUnitId || ''} onChange={e=>changeSharedSellingUnit(lineKey,e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-1 py-1.5 text-xs">{item.product.sharedStockUnits.units.map(u=><option key={u.id} value={u.id}>{u.label} ({u.baseUnits})</option>)}</select> : item.product.variants?.length ? <select aria-label={`Selling unit for ${item.product.name}`} value={item.variantId || ''} onChange={e=>changeCartVariant(lineKey,e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-1 py-1.5 text-xs"><option value="" disabled>Select unit</option>{item.product.variants.map(v=><option key={v.id} value={v.id}>{v.unit || v.name} · {v.name}</option>)}</select> : <span className="text-xs text-slate-600">{item.variantUnit && item.variantUnit !== 'Unit' ? item.variantUnit : inferUnitLabel(item.product.name)} <span className="block text-[10px] text-slate-400" title="Configure shared selling units in Product Catalog to enable Box/Piece conversion">Fixed U/M</span></span>}</div>
                  {expandedInvoice && <div className="hidden lg:block text-right font-mono pt-2"><button type="button" disabled={!isAdminSeller} onClick={()=>openPriceEditor(item)} className="text-indigo-700 disabled:text-slate-700">{formatMoney(basePrice)}{isAdminSeller && <span className="block text-[10px]">Edit rate</span>}</button>{item.customUnitPrice!==undefined && <span className="block text-[10px] text-amber-700">Custom</span>}</div>}
                  {/* selectors and quantities */}
                  <div className={`flex flex-wrap items-center justify-between gap-2 min-w-0 ${expandedInvoice ? "lg:contents" : ""}`}>
                    <div className={`flex items-center justify-center gap-1 bg-slate-50 border border-slate-200 rounded-md p-0.5 ${expandedInvoice ? "lg:bg-white lg:border-0" : ""}`}>
                      <button
                        type="button"
                        aria-label={`Decrease quantity for ${item.product.name}`}
                        onClick={() => updateCartQty(lineKey, item.quantity - 1)}
                        className="p-0.5 text-slate-500 hover:text-slate-800"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        max={maxLineQuantity(item)}
                        aria-label={`Quantity for ${item.product.name}`}
                        value={item.quantity}
                        onChange={(e) => updateCartQty(lineKey, Number(e.target.value))}
                        onFocus={(e) => e.currentTarget.select()}
                        className="h-7 w-12 rounded border border-slate-200 bg-white px-1 text-center font-mono text-xs font-bold text-slate-800 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        aria-label={`Increase quantity for ${item.product.name}`}
                        disabled={item.quantity >= maxLineQuantity(item)}
                        title={item.quantity >= maxLineQuantity(item) ? "Maximum available stock reached" : "Add one unit"}
                        onClick={() => updateCartQty(lineKey, item.quantity + 1)}
                        className="p-0.5 text-slate-500 hover:text-slate-800 disabled:opacity-35 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <label className="flex flex-col gap-0.5 min-w-0"><span className={expandedInvoice ? "lg:sr-only" : "text-[10px] text-slate-500"}>Disc %</span><input
                        type="number"
                        min="0"
                        max="100"
                        aria-label={`Percentage discount for ${item.product.name}`}
                        value={item.discount}
                        onChange={(e) => updateItemDiscount(lineKey, Number(e.target.value))}
                        className="w-full min-w-0 px-1 py-1 border border-slate-200 bg-white rounded text-xs text-slate-700 focus:outline-none"
                      /></label>
                    <label className="flex flex-col gap-0.5 min-w-0"><span className={expandedInvoice ? "lg:sr-only" : "text-[10px] text-slate-500"}>Disc Rs.</span><input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={`Fixed discount for ${item.product.name}`}
                        value={item.discountAmount || 0}
                        onChange={(e) => updateItemDiscountAmount(lineKey, Number(e.target.value))}
                        className="w-full min-w-0 px-1 py-1 border border-slate-200 bg-white rounded text-xs text-slate-700 focus:outline-none"
                      /></label>
                    <div className="text-right min-w-[76px] font-mono font-bold text-slate-900">
                      {formatMoney(pricing.lineTotal)}
                      <button
                        type="button"
                        aria-label={`Remove ${item.product.name} from invoice`}
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
              <div className="py-8 text-center text-slate-400 flex flex-col items-center justify-center border border-dashed border-slate-100 rounded-xl">
                <ShoppingCart className="w-8 h-8 text-slate-200" />
                <p className="text-xs font-semibold mt-1">Cash Register is Empty</p>
                <p className="text-[10px] text-slate-500 mt-1">Search or browse products to add invoice lines</p>
              </div>
            )}
          </div>

        {currentStockIssue && <div role="alert" className="shrink-0 mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><strong>Stock correction required:</strong> {currentStockIssue}</div>}
        <div className="shrink-0 border-t border-slate-200 bg-white pt-2 lg:flex lg:items-center lg:gap-4">
          <div className="flex flex-1 items-center justify-between gap-3 pb-2 lg:pb-0">
            <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Draft invoice · {cart.length} {cart.length === 1 ? "line" : "lines"}</p>
              <strong id="pos-total-price" className="text-xl font-bold text-slate-900">{formatMoney(total)}</strong></div>
            <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-700">{draftSaved && cart.length > 0 ? 'Draft saved locally' : 'Not saved'}</span>
          </div>
          <button type="button" id="pos-review-trigger" disabled={cart.length === 0 || isSubmitting || checkoutUncertain || !!currentStockIssue}
            onClick={() => {
              if (!selectedCustomer.id || selectedCustomer.id === 'cust-walkin' ||
                  !customers.some(c => c.id === selectedCustomer.id && c.shopId === taxConfig.activeShopId)) {
                notify.warning('Select a registered customer shop before reviewing this invoice.'); return;
              }
              if (!activeSalesReps.some(rep => rep.id === selectedSalesRepId)) {
                notify.warning('Select the Sales Representative before reviewing this invoice.'); return;
              }
              const issue = stockIssue(cart);
              if (issue) { notify.warning(issue); return; }
              setIsReviewOpen(true);
            }}
            className="w-full lg:w-auto rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
            Review invoice & payment →
          </button>
        </div>
      </div>

      {pickerProduct && pickerUnit && createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-4">
          <section role="dialog" aria-modal="true" aria-label="Choose selling unit" className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-white shadow-xl">
            <header className="flex items-start justify-between bg-[#182a45] p-4 text-white rounded-t-2xl"><div><p className="text-xs font-semibold text-amber-300">ARS DISTRIBUTORS · SELLING UNITS</p><h3 className="mt-1 text-lg font-bold">{pickerProduct.name}</h3><p className="text-xs text-slate-300">Choose Box, Piece or another configured unit.</p></div><button type="button" aria-label="Close selling unit selection" onClick={()=>setUnitPickerProductId(null)}><X className="h-5 w-5"/></button></header>
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-3"><BillingProductPhoto product={pickerProduct}/><div className="min-w-0"><p className="text-xs text-slate-500">Product code</p><p className="break-all text-sm font-semibold">{pickerProduct.sku}</p><p className="text-xs text-slate-500">Select an available selling unit below.</p></div></div>
              <div className="grid grid-cols-2 gap-2">{pickerProduct.sharedStockUnits?.units.map(u=>{const remaining=availableToAdd(pickerProduct,undefined,cart,u.id);return <button key={u.id} type="button" aria-pressed={u.id===pickerUnit.id} disabled={remaining<1} onClick={()=>{setUnitPickerUnitId(u.id);setUnitPickerQty('1');setPickerCustomPrice('');setPickerPriceReason('');}} className={'rounded-xl border p-3 text-left disabled:opacity-40 '+(u.id===pickerUnit.id?'border-indigo-600 bg-indigo-50':'border-slate-200')}><strong className="block">{u.label}</strong><span className="block text-xs text-slate-500">{u.baseUnits} base units · {remaining} available</span><span className="block font-semibold">{formatMoney(u.sellingPrice)}</span></button>;})}</div>
              <label className="block text-sm font-semibold">Quantity ({pickerUnit.label})<input autoFocus type="number" min="1" max={pickerAvailable} step="1" value={unitPickerQty} onChange={e=>setUnitPickerQty(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3"/></label>
              <div className="flex flex-wrap gap-2" aria-label="Quick quantity">
                {[1, 2, 5, 10].filter(q=>q<=pickerAvailable).map(q=><button key={q} type="button" aria-pressed={Number(unitPickerQty)===q} onClick={()=>setUnitPickerQty(String(q))} className={'rounded-lg border px-3 py-2 text-sm font-semibold '+(Number(unitPickerQty)===q?'border-indigo-600 bg-indigo-50 text-indigo-800':'border-slate-200')}>{q}</button>)}
                {pickerAvailable>0 && <button type="button" onClick={()=>setUnitPickerQty(String(pickerAvailable))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">Max ({pickerAvailable})</button>}
              </div>
              <p className="text-xs text-slate-600">Available to add: {pickerAvailable} {pickerUnit.label}. Stock is shared across all selling units.</p>
              {Number.isSafeInteger(Number(unitPickerQty)) && Number(unitPickerQty)>0 && Number(unitPickerQty)<=pickerAvailable && <div className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-sm"><span>Line subtotal before discounts</span><strong>{formatMoney(Number(unitPickerQty)*(pickerCustomPrice.trim()!=='' && validCustomPrice(pickerCustomPrice,pickerPriceReason)?Number(pickerCustomPrice):pickerUnit.sellingPrice))}</strong></div>}
              {(!Number.isSafeInteger(Number(unitPickerQty)) || Number(unitPickerQty)<1 || Number(unitPickerQty)>pickerAvailable) && <p role="alert" className="text-sm text-rose-700">Enter a whole quantity between 1 and {pickerAvailable}.</p>}
              {isAdminSeller && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2"><div className="flex justify-between text-sm"><strong>Invoice rate</strong><span>Standard: {formatMoney(pickerUnit.sellingPrice)}</span></div><label className="block text-xs font-semibold">Custom rate (optional)<input type="number" min="0.01" step="0.01" value={pickerCustomPrice} onChange={e=>setPickerCustomPrice(e.target.value)} placeholder={String(pickerUnit.sellingPrice)} className="mt-1 w-full rounded-lg border p-2"/></label>{pickerCustomPrice!=='' && <label className="block text-xs font-semibold">Reason for custom rate<input maxLength={250} value={pickerPriceReason} onChange={e=>setPickerPriceReason(e.target.value)} placeholder="Agreed wholesale price" className="mt-1 w-full rounded-lg border p-2"/></label>}<p className="text-xs text-slate-500">Applies only to this invoice.</p></div>}
              <div className="flex justify-between rounded-xl bg-slate-900 p-3 text-white"><span>Line total</span><strong>{formatMoney(Math.max(0,Number(unitPickerQty)||0)*(pickerCustomPrice===''?pickerUnit.sellingPrice:Number(pickerCustomPrice)||0))}</strong></div>
              <button type="button" disabled={!Number.isSafeInteger(Number(unitPickerQty)) || Number(unitPickerQty)<1 || Number(unitPickerQty)>pickerAvailable || (pickerCustomPrice!=="" && !validCustomPrice(pickerCustomPrice,pickerPriceReason))} onClick={()=>{if(addToCart(pickerProduct,undefined,pickerUnit.id,Number(unitPickerQty),pickerCustomPrice===""?undefined:Number(pickerCustomPrice),pickerPriceReason))setUnitPickerProductId(null);}} className="w-full rounded-lg bg-amber-400 p-3 font-bold disabled:opacity-40">Add to invoice</button>
              <p className="text-xs text-slate-500">To sell another unit of the same item, select the product again. Each unit appears on a separate invoice line.</p>
            </div>
          </section>
        </div>, document.body
      )}

      {priceLine && isAdminSeller && createPortal(
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/60 p-4">
          <section role="dialog" aria-modal="true" aria-label="Edit invoice rate" className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden">
            <header className="bg-[#182a45] p-4 text-white"><div className="flex justify-between"><p className="text-xs font-bold text-amber-300">ARS DISTRIBUTORS · INVOICE PRICING</p><button type="button" aria-label="Close" onClick={()=>setPriceEditKey(null)}><X className="h-5 w-5"/></button></div><h3 className="mt-2 text-lg font-bold">Edit selling rate</h3><p className="text-sm text-slate-300">{priceLine.product.name} · {priceLine.variantUnit || 'Unit'}</p></header>
            <div className="space-y-3 p-4"><p className="text-sm">Standard rate: <strong>{formatMoney(priceLine.unitPrice ?? priceLine.product.sellingPrice)}</strong></p><label className="block text-sm font-semibold">Agreed price per unit<input autoFocus type="number" min="0.01" step="0.01" value={priceDraft} onChange={e=>setPriceDraft(e.target.value)} className="mt-1 w-full rounded-lg border p-3"/></label><label className="block text-sm font-semibold">Reason<input value={priceReason} maxLength={250} onChange={e=>setPriceReason(e.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="Customer negotiated price"/></label><div className="rounded-xl bg-slate-100 p-3 text-sm flex justify-between"><span>Line subtotal before discounts</span><strong>{formatMoney((Number(priceDraft)||0)*priceLine.quantity)}</strong></div><p className="text-xs text-slate-500">Catalog price remains unchanged. Changes are recorded in the invoice audit.</p><button type="button" disabled={!validCustomPrice(priceDraft,priceReason)} onClick={()=>{setCart(old=>old.map(line=>getCartKey(line)===priceEditKey?{...line,customUnitPrice:Number(priceDraft),priceOverrideReason:priceReason.trim()}:line));setPriceEditKey(null);}} className="w-full rounded-lg bg-amber-400 p-3 font-bold disabled:opacity-40">Apply custom rate</button><button type="button" onClick={()=>{setCart(old=>old.map(line=>getCartKey(line)===priceEditKey?{...line,customUnitPrice:undefined,priceOverrideReason:undefined}:line));setPriceEditKey(null);}} className="w-full rounded-lg border p-2 text-sm">Restore standard rate</button></div>
          </section>
        </div>,document.body
      )}
      {editingDescriptionKey && (
        <div id="pos-description-backdrop" className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-3 sm:p-5">
          <section role="dialog" aria-modal="true" aria-labelledby="pos-description-title"
            className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">This invoice only</p>
                <h2 id="pos-description-title" className="text-base font-bold text-slate-900">Edit product description</h2>
                <p className="mt-1 text-xs text-slate-500">{cart.find(item => getCartKey(item) === editingDescriptionKey)?.product.name || 'Product'}</p>
              </div>
              <button type="button" aria-label="Cancel description changes"
                onClick={() => setEditingDescriptionKey(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5"/>
              </button>
            </header>
            <div className="px-4 py-4">
              <label htmlFor="pos-description-input" className="mb-2 block text-xs font-semibold text-slate-700">
                Description shown below the item name on the A4 invoice
              </label>
              <textarea id="pos-description-input" rows={3} maxLength={250} value={descriptionDraft}
                onChange={event => setDescriptionDraft(event.target.value)}
                placeholder="Example: 50mm, 4m length, heavy duty"
                className="w-full resize-none rounded-xl border border-slate-300 p-3 text-sm text-slate-900 outline-none focus:border-indigo-500"/>
              <p className="mt-2 text-[11px] text-slate-500">
                {descriptionDraft.length}/250 characters. Editing this invoice never changes the product catalog.
              </p>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" onClick={() => setEditingDescriptionKey(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700">Cancel</button>
              <button type="button" id="pos-description-save" onClick={saveInvoiceLineDescription}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">Apply to invoice</button>
            </footer>
          </section>
        </div>
      )}

      {setupDialog && (
        <div id="pos-setup-backdrop" className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/60 p-3 sm:p-5">
          <section role="dialog" aria-modal="true" aria-labelledby="pos-setup-title"
            className="flex max-h-[min(88dvh,700px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:px-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">Invoice setup</p>
                <h2 id="pos-setup-title" className="text-base font-bold text-slate-900">
                  {setupDialog === 'customer' ? 'Select customer shop' : 'Select Sales Representative'}
                </h2>
              </div>
              <button type="button" aria-label="Close invoice setup" onClick={() => setSetupDialog(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5"/></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {setupDialog === 'customer' ? (
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-slate-700" htmlFor="pos-customer-search">
                    Search shop by name, customer ID, phone, email or address
                  </label>
                  <input id="pos-customer-search" type="search" autoComplete="off" value={customerSearch}
                    onChange={event => setCustomerSearch(event.target.value)}
                    placeholder="Search registered customer shops..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-indigo-500"/>
                  <label className="block text-xs font-semibold text-slate-700" htmlFor="pos-customer-select">Registered customer shop *</label>
                  <select id="pos-customer-select" required value={draftCustomerId}
                    onChange={event => {
                      const customer=customers.find(c=>c.id===event.target.value && c.shopId===taxConfig.activeShopId && c.id!=='cust-walkin');
                      if(customer) setDraftCustomerId(customer.id);
                    }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-indigo-500">
                    <option value="">Choose a shop...</option>
                    {availableWholesaleCustomers.map(customer=>(
                      <option key={customer.id} value={customer.id}>{customer.name}{customer.phone && customer.phone !== '-' ? ` · ${customer.phone}` : ''}</option>
                    ))}
                    {draftCustomerId &&
                      !availableWholesaleCustomers.some(c=>c.id===draftCustomerId) && (
                        <option value={draftCustomerId}>{customers.find(c=>c.id===draftCustomerId)?.name || 'Selected shop'} · selected</option>
                      )}
                  </select>
                  {customers.filter(c=>c.id!=='cust-walkin'&&c.shopId===taxConfig.activeShopId).length===0 && (
                    <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                      No registered customer shops. Add a shop in Customers before creating an invoice.
                    </p>
                  )}
                  {draftCustomerId && customers.some(c => c.id === draftCustomerId && c.shopId === taxConfig.activeShopId) && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      <p className="font-semibold text-slate-900">{customers.find(c=>c.id===draftCustomerId)?.name}</p>
                      <p className="mt-1">{customers.find(c=>c.id===draftCustomerId)?.phone || 'No phone saved'} · {customers.find(c=>c.id===draftCustomerId)?.address || 'No address saved'}</p>
                      <p className="mt-2 text-slate-500">The invoice will use the registered customer details when you confirm.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <label htmlFor="pos-sales-representative" className="block text-xs font-semibold text-slate-700">
                    Representative responsible for this invoice *
                  </label>
                  <select id="pos-sales-representative" required aria-label="Select Sales Representative"
                    value={draftRepId} onChange={event=>setDraftRepId(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-indigo-500">
                    <option value="">Choose representative...</option>
                    {activeSalesReps.map(rep=><option key={rep.id} value={rep.id}>{rep.name}</option>)}
                  </select>
                  {activeSalesReps.length===0 && (
                    <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                      No representatives registered. Add one in Staff before billing.
                    </p>
                  )}
                </div>
              )}
            </div>
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
              <button type="button" onClick={()=>setSetupDialog(null)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700">Close</button>
              <button type="button" id="pos-setup-confirm"
                disabled={setupDialog === 'customer'
                  ? !customers.some(c=>c.id===draftCustomerId && c.shopId===taxConfig.activeShopId && c.id!=='cust-walkin')
                  : !activeSalesReps.some(rep=>rep.id===draftRepId)}
                onClick={()=>{
                  if(setupDialog === 'customer'){
                    const buyer=customers.find(c=>c.id===draftCustomerId && c.shopId===taxConfig.activeShopId && c.id!=='cust-walkin');
                    if(!buyer)return;
                    if(buyer.id!==selectedCustomer.id){setCreditDueDate('');setCreditEvidence('');}
                    setSelectedCustomer(buyer);
                  } else {
                    if(!activeSalesReps.some(rep=>rep.id===draftRepId))return;
                    setSelectedSalesRepId(draftRepId);
                  }
                  setSetupDialog(null);
                }}
                className="rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                Confirm selection
              </button>
            </footer>
          </section>
        </div>
      )}

      {isReviewOpen && createPortal(
        <div id="pos-review-backdrop" className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden bg-slate-950/60 p-3 sm:p-5">
          <section id="pos-review-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="pos-review-title"
            className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-2 sm:px-5">
              <div><p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">Final review · no invoice saved yet</p>
                <h2 id="pos-review-title" className="text-lg font-bold text-slate-900">Review & issue invoice</h2>
                <p className="mt-0.5 text-xs text-slate-600">{selectedCustomer.name} · {activeSalesReps.find(rep => rep.id === selectedSalesRepId)?.name || 'Representative not selected'}</p></div>
              <button type="button" aria-label="Close payment review" disabled={isSubmitting} onClick={() => setIsReviewOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5"/></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:overflow-hidden overscroll-contain">
              <div className="min-w-0 p-3 sm:p-4 lg:overflow-y-auto overscroll-contain lg:border-r lg:border-slate-200">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Invoice items ({cart.length} lines)</p>
                <div className="grid grid-cols-[minmax(0,1fr)_48px_36px_85px_95px] gap-2 border-b border-slate-200 pb-2 text-[10px] font-semibold text-slate-500"><span>Product / description</span><span>U/M</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span></div>
                <div className="divide-y divide-slate-100">
                  {cart.map(item => {
                    const line = getLinePricing(item);
                    return <div key={getCartKey(item)} className="grid grid-cols-[minmax(0,1fr)_48px_36px_85px_95px] items-start gap-2 py-2 text-xs text-slate-700">
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-semibold">{item.product.name}</span>
                        {item.invoiceDescription && <span className="mt-0.5 block break-words text-[11px] text-slate-500">{item.invoiceDescription}</span>}
                      </span>
                      <span className="break-words">{item.product.sharedStockUnits?.units.find(u=>u.id===item.sellingUnitId)?.label || (item.variantUnit && item.variantUnit!=='Unit' ? item.variantUnit : inferUnitLabel(item.product.name))}</span><span className="text-right tabular-nums">{item.quantity}</span><span className="text-right tabular-nums">{formatMoney(Number(item.customUnitPrice ?? item.unitPrice ?? item.product.sellingPrice))}</span><strong className="text-right tabular-nums">{formatMoney(line.lineTotal)}</strong>
                    </div>;
                  })}
                </div>
              </div>
              <div className="mt-3">          {isWholesaleShop && (
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

</div>
              </div>
        {/* Payment and invoice totals */}
        <div className="min-w-0 space-y-2 bg-slate-50/60 p-3 sm:p-4 lg:overflow-y-auto overscroll-contain">
          <h3 className="text-sm font-bold text-slate-900">Invoice & payment arrangement</h3>
                    {/* Payment Method Selector Grid */}
          <div className="grid grid-cols-2 gap-1.5 pt-1 sm:grid-cols-4">
            {[
              { id: 'Credit Account', label: 'Pay later', icon: BookUser },
              { id: 'Cash', label: 'Paid cash', icon: DollarSign },
              { id: 'Credit Card', label: 'Card', icon: CreditCard },
              { id: 'QR Code', label: 'QR Pay', icon: QrCode },
              { id: 'Bank Transfer', label: 'Bank transfer', icon: DollarSign },
            ].filter(pm=>!managerFinancialPosting||['Credit Account','Cash','Bank Transfer'].includes(pm.id)).map((pm) => {
              const Icon = pm.icon;
              const isSel = paymentMethod === pm.id;
              return (
                <button
                  key={pm.id}
                  id={`paymethod-${pm.id.replace(/\s+/g, '-').toLowerCase()}`}
                  onClick={() => {
                    setPaymentMethod(pm.id as any);

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


          {needsInvoiceAccount&&<div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 text-xs"><label className="block font-semibold" htmlFor="invoice-financial-account">Received into *</label><select id="invoice-financial-account" required value={invoiceAccountId} disabled={invoiceAccountsLoading||isSubmitting||checkoutUncertain} onChange={e=>setInvoiceAccountId(e.target.value)} className="w-full rounded border border-slate-300 p-2"><option value="">{invoiceAccountsLoading?'Loading accounts…':'Select receiving account'}</option>{matchingInvoiceAccounts.map(a=><option key={a.id} value={a.id}>{a.name} · {formatMoney(a.balance)}</option>)}</select>{invoiceAccountsError&&<p role="alert" className="text-red-700">{invoiceAccountsError}</p>}{!invoiceAccountsLoading&&!invoiceAccountsError&&!matchingInvoiceAccounts.length&&<p className="text-amber-800">Create a matching account in Accounting first, or choose Pay later if payment has not been received.</p>}{selectedInvoiceAccount&&<p>Estimated balance after receipt: <strong>{formatMoney(selectedInvoiceAccount.balance+total)}</strong></p>}</div>}
                        {paymentMethod === 'Credit Account' && (
                <div role="status" className={`mb-3 rounded-lg border px-3 py-2 text-xs ${creditAccountAllowed?'border-amber-200 bg-amber-50 text-amber-900':'border-rose-200 bg-rose-50 text-rose-800'}`}>
                  {creditLimit <= 0 ? 'This customer has no credit limit configured.'
                    : creditExceeded ? `Credit limit exceeded: ${formatMoney(projectedCreditBalance)} above allowed ${formatMoney(creditLimit)}.`
                    : `Invoice will be posted to customer credit. New balance: ${formatMoney(projectedCreditBalance)} / ${formatMoney(creditLimit)}.`}
                </div>
              )}

          {activeCreditTerms&&<fieldset disabled={isSubmitting||checkoutUncertain} className="rounded-xl border border-slate-200 p-3 space-y-2 text-xs"><legend className="font-semibold px-1">Agreed payment terms (optional)</legend><label className="block font-semibold" htmlFor="credit-due-date">Payment due date</label><input id="credit-due-date" type="date" min={creditToday} max="9999-12-31" value={creditDueDate} onChange={e=>{setCreditDueDate(e.target.value);if(!e.target.value)setCreditEvidence('');}} className="w-full rounded border border-slate-300 p-2"/><label className="block font-semibold" htmlFor="credit-evidence">Payment agreement reference {creditDueDate?'*':''}</label><input id="credit-evidence" value={creditEvidence} maxLength={500} disabled={!creditDueDate||isSubmitting||checkoutUncertain} onChange={e=>setCreditEvidence(e.target.value)} placeholder="Agreed with customer / order reference" className="w-full rounded border border-slate-300 p-2"/><p className="text-slate-500">Leave blank if no due date has been agreed. No money is collected now.</p>{invalidCreditTerms&&<p role="alert" className="text-rose-700">Enter a valid due date and agreement reference.</p>}</fieldset>}

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

            {/* One invoice-level discount: switch between fixed rupees and percentage. */}
            <div className="rounded-xl border border-slate-200 bg-white p-2 space-y-1.5" id="pos-invoice-discount">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="pos-cart-discount-input" className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <Ticket className="h-4 w-4 text-indigo-600" /> Invoice discount
                </label>
                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Invoice discount type">
                  <button type="button" id="pos-discount-amount"
                    aria-pressed={discountMode === 'amount'} onClick={() => {setDiscountMode('amount');setDiscountInput('0');}}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${discountMode === 'amount' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    {currencySymbol} Fixed
                  </button>
                  <button type="button" id="pos-discount-percent"
                    aria-pressed={discountMode === 'percent'} onClick={() => {setDiscountMode('percent');setDiscountInput('0');}}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${discountMode === 'percent' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    % Percent
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <input id="pos-cart-discount-input" type="number" min="0" step="0.01"
                  max={discountMode === 'percent' ? 100 : subtotal}
                  value={discountInput}
                  onChange={e => setDiscountInput(e.target.value)}
                  className="min-w-0 w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold tabular-nums outline-none focus:border-indigo-500"
                  aria-label={discountMode === 'percent' ? 'Invoice discount percentage' : 'Invoice discount amount in rupees'}/>
                <span className="text-xs text-slate-600">
                  {discountMode === 'percent' ? `${Math.min(100,normalizedDiscountInput)}% = ` : 'Discount = '}
                  <strong className="font-mono text-emerald-700">{formatMoney(cashDiscount)}</strong>
                </span>
              </div>
              {normalizedDiscountInput > (discountMode === 'percent' ? 100 : subtotal) && (
                <p role="status" className="text-xs text-amber-800">
                  Discount is limited to {discountMode === 'percent' ? '100%' : 'the item subtotal'}.
                </p>
              )}
            </div>

            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Sales Tax ({taxConfig.taxRate.toFixed(1)}% standard)</span>
              <span className="font-mono">{currencySymbol}{tax.toFixed(2)}</span>
            </div>

            <div className="flex justify-between items-center rounded-lg bg-slate-900 px-3 py-2 text-lg font-bold text-white">
              <span>Total Bill</span>
              <span className="tabular-nums text-amber-300">{formatMoney(total)}</span>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
              {paymentMethod==='Credit Account' ? <><strong>Payment due: {formatMoney(total)}</strong><p className="mt-1">Issue the invoice now and record payments later in the customer account. No cash is collected at this step.</p></> : <><strong>Paid in full: {formatMoney(total)}</strong><p className="mt-1">Select this arrangement only if the full amount has already been received.</p></>}
            </div>
          </div>

              </div>
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2 sm:px-5">
              <button type="button" onClick={() => setIsReviewOpen(false)} disabled={isSubmitting}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Back to invoice</button>
                        {/* Checkout Submit Trigger */}
          <button
            id="pos-pay-trigger" type="button"
            disabled={cart.length === 0 || isSubmitting || checkoutUncertain || !!currentStockIssue || invalidCreditTerms || (paymentMethod === 'Credit Account' && !creditAccountAllowed) || (needsInvoiceAccount&&(!selectedInvoiceAccount||invoiceAccountsLoading||total<=0))}
            onClick={handleCheckout}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-lg text-sm font-sans font-bold transition flex items-center justify-center gap-2 shadow-sm ${
              cart.length === 0 || isSubmitting || checkoutUncertain || (paymentMethod === 'Credit Account' && !creditAccountAllowed)
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                : 'bg-amber-400 border border-amber-400 text-slate-900 hover:bg-amber-500'
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="h-4 w-4 border-2 border-slate-400 border-t-white rounded-full animate-spin"></div>
                Recording Receipt...
              </>
            ) : (
              <>
                Save Invoice & Print A4 ({formatMoney(total)})
              </>
            )}
          </button>

            </footer>
          </section>
        </div>, document.body
      )}

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
                {effectivePrintFormat === 'a4' && (
                  <div key={taxConfig.activeShopId + ':' + receiptModel.id}><A4InvoicePreview id={receiptModel.id} request={authFetch} /></div>
                )}
                <details key={receiptModel.id} open={effectivePrintFormat === 'thermal'}>
                  <summary className="my-2 cursor-pointer text-sm font-semibold text-slate-700">Transaction details</summary>
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
                          <p className="font-semibold uppercase tracking-wide text-slate-700 mb-1">Business Information</p>
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
                              {itm.invoiceDescription && <span className="block text-[10px] text-slate-500">{itm.invoiceDescription}</span>}
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

                </details>
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
                          <span className="font-mono">{reportTime(log.printedAt)}</span>
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
                    <ReportExportMenu report={() => printAuditReport()} settings={taxConfig}/>
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
                              <td className="px-2 py-1">{reportTime(row.printedAt)}</td>
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
                        const invoiceWindow = createPrintWindow();
                        if(!invoiceWindow) return;
                        const printAudit = await logInvoicePrint(receiptModel, selectedCopyType);
                        await loadInvoicePrintHistory(receiptModel);
                        await loadInvoicePrintAudit();
                        await printReceiptInvoice(receiptModel, invoiceWindow, {
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
            onProductFound={(product) => openUnitPicker(product, getSelectedVariant(product))}
            products={products}
            userRole={currentRole}
            authToken={authToken}
          />
        )}
      </div>
    </div>
  );
}
