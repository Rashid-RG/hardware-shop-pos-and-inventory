import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Plus,
  Sliders,
  Settings,
  X,
  CreditCard,
  Building,
  CheckCircle,
  Percent,
  Receipt,
  FileSpreadsheet,
} from 'lucide-react';
import { SalesTransaction, PurchaseOrder, Role, ManualExpense, StoreSettings } from '../types';
import { sanitizeImageSrc } from '../utils/sanitizeImageSrc';

interface AccountingSettingsViewProps {
  transactions: SalesTransaction[];
  purchaseOrders: PurchaseOrder[];
  currentRole: Role;
  taxConfig: StoreSettings;
  manualExpenses: ManualExpense[];
  authToken: string;
  onUpdateTaxConfig: (config: StoreSettings) => Promise<void>;
  onAddManualExpense: (expense: Omit<ManualExpense, 'id' | 'date'>) => Promise<void>;
}

export default function AccountingSettingsView({
  transactions,
  purchaseOrders,
  currentRole,
  taxConfig,
  manualExpenses,
  authToken,
  onUpdateTaxConfig,
  onAddManualExpense,
}: AccountingSettingsViewProps) {
  const defaultInvoiceCompanyMeta = {
    companyLegalName: '',
    companyTagline: 'Hardware Wholesale & Retail',
    businessRegistrationNo: '',
    vatRegistrationNo: '',
    tinNo: '',
    supportPhone: '',
    supportEmail: '',
    websiteUrl: '',
    socialLinks: '',
  };

  const currencySymbol = 'Rs.';
  const [activeTab, setActiveTab] = useState<'accounting' | 'settings'>('accounting');

  // Expense Logger form states
  const [isExpOpen, setIsExpOpen] = useState(false);
  const [expDesc, setExpDesc] = useState('');
  const [expAmt, setExpAmt] = useState(0);
  const [expCat, setExpCat] = useState('Utilities');
  const expenseCategories = ['Utilities', 'Maintenance', 'Rent', 'Wages', 'Freight', 'Marketing', 'Other'];

  const toDefaultShopProfiles = (config: StoreSettings) => {
    if (Array.isArray(config.shopProfiles) && config.shopProfiles.length > 0) {
      return config.shopProfiles.map((shop) => ({
        ...shop,
        address: shop.address || '',
        phone: shop.phone || '',
        printFormat: shop.printFormat === 'thermal' ? 'thermal' : 'a4',
      }));
    }
    return [
      {
        id: 'shop-main',
        name: config.storeName || 'Lanka Smart Hardware',
        logoUrl: config.logoUrl || '',
        address: '150 Galle Road, Colombo 03, Sri Lanka',
        phone: '+94 11 234 5678',
        taxRate: config.taxRate || 18,
        invoicePrefix: config.invoicePrefix || 'SL-INV',
        printFormat: 'a4',
        invoiceCompanyMeta: {
          ...defaultInvoiceCompanyMeta,
        },
      },
    ];
  };

  // Settings forms
  const [storeName, setStoreName] = useState(taxConfig.storeName);
  const [taxRate, setTaxRate] = useState(taxConfig.taxRate);
  const [currency, setCurrency] = useState(taxConfig.currency);
  const [invoicePrefix, setInvoicePrefix] = useState(taxConfig.invoicePrefix);
  const [logoUrl, setLogoUrl] = useState(taxConfig.logoUrl || '');
  const [shopAddress, setShopAddress] = useState(toDefaultShopProfiles(taxConfig)[0].address || '');
  const [shopPhone, setShopPhone] = useState(toDefaultShopProfiles(taxConfig)[0].phone || '');
  const [printFormat, setPrintFormat] = useState<'a4' | 'thermal'>('a4');
  const [shopProfiles, setShopProfiles] = useState(toDefaultShopProfiles(taxConfig));
  const [activeShopId, setActiveShopId] = useState(taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id);
  const [companyLegalName, setCompanyLegalName] = useState(defaultInvoiceCompanyMeta.companyLegalName);
  const [companyTagline, setCompanyTagline] = useState(defaultInvoiceCompanyMeta.companyTagline);
  const [businessRegistrationNo, setBusinessRegistrationNo] = useState(defaultInvoiceCompanyMeta.businessRegistrationNo);
  const [vatRegistrationNo, setVatRegistrationNo] = useState(defaultInvoiceCompanyMeta.vatRegistrationNo);
  const [tinNo, setTinNo] = useState(defaultInvoiceCompanyMeta.tinNo);
  const [supportPhone, setSupportPhone] = useState(defaultInvoiceCompanyMeta.supportPhone);
  const [supportEmail, setSupportEmail] = useState(defaultInvoiceCompanyMeta.supportEmail);
  const [websiteUrl, setWebsiteUrl] = useState(defaultInvoiceCompanyMeta.websiteUrl);
  const [socialLinks, setSocialLinks] = useState(defaultInvoiceCompanyMeta.socialLinks);
  const [isSettingsSaved, setIsSettingsSaved] = useState(false);

  const isWholesaleShopProfile = (shop: { id?: string; name?: string }) => {
    const normalizedName = String(shop.name || '').toLowerCase();
    return String(shop.id || '') === 'shop-2' || normalizedName.includes('wholesale') || normalizedName.includes('ars pvt');
  };

  const authFetch = (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${authToken}`);
    return fetch(url, { ...init, headers });
  };

  const handleUploadShopLogo = async (file: File) => {
    const formData = new FormData();
    formData.append('image', file);

    const res = await authFetch('/api/uploads/shop-logo', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to upload shop logo');
    }

    setLogoUrl(sanitizeImageSrc(data.imageUrl) || '');
  };

  useEffect(() => {
    const profiles = toDefaultShopProfiles(taxConfig);
    const selectedShopId = taxConfig.activeShopId || profiles[0].id;
    const activeShop = profiles.find((shop) => shop.id === selectedShopId) || profiles[0];
    const activeInvoiceMeta = {
      ...defaultInvoiceCompanyMeta,
      ...(activeShop.invoiceCompanyMeta || {}),
    };

    setShopProfiles(profiles);
    setActiveShopId(selectedShopId);
    setStoreName(taxConfig.storeName);
    setTaxRate(taxConfig.taxRate);
    setCurrency(taxConfig.currency);
    setInvoicePrefix(taxConfig.invoicePrefix);
    setLogoUrl(sanitizeImageSrc(activeShop.logoUrl || taxConfig.logoUrl || '') || '');
    setShopAddress(activeShop.address || '');
    setShopPhone(activeShop.phone || '');
    setPrintFormat((activeShop.printFormat as 'a4' | 'thermal') || 'a4');
    setCompanyLegalName(activeInvoiceMeta.companyLegalName || defaultInvoiceCompanyMeta.companyLegalName);
    setCompanyTagline(activeInvoiceMeta.companyTagline || defaultInvoiceCompanyMeta.companyTagline);
    setBusinessRegistrationNo(activeInvoiceMeta.businessRegistrationNo || '');
    setVatRegistrationNo(activeInvoiceMeta.vatRegistrationNo || '');
    setTinNo(activeInvoiceMeta.tinNo || '');
    setSupportPhone(activeInvoiceMeta.supportPhone || '');
    setSupportEmail(activeInvoiceMeta.supportEmail || '');
    setWebsiteUrl(activeInvoiceMeta.websiteUrl || '');
    setSocialLinks(activeInvoiceMeta.socialLinks || '');
  }, [taxConfig]);

  const addShopProfile = () => {
    const newShopId = `shop-${Date.now()}`;
    const newShop = {
      id: newShopId,
      name: `Branch ${shopProfiles.length + 1}`,
      logoUrl: '',
      address: '150 Galle Road, Colombo 03, Sri Lanka',
      phone: '+94 11 234 5678',
      taxRate,
      invoicePrefix,
      printFormat: 'a4' as const,
      invoiceCompanyMeta: {
        ...defaultInvoiceCompanyMeta,
      },
    };
    const nextProfiles = [...shopProfiles, newShop];
    setShopProfiles(nextProfiles);
    setActiveShopId(newShopId);
    setStoreName(newShop.name);
    setInvoicePrefix(newShop.invoicePrefix || 'SL-INV');
    setTaxRate(Number(newShop.taxRate || 18));
    setLogoUrl('');
    setShopAddress(newShop.address || '');
    setShopPhone(newShop.phone || '');
    setPrintFormat('a4');
    setCompanyLegalName(defaultInvoiceCompanyMeta.companyLegalName);
    setCompanyTagline(defaultInvoiceCompanyMeta.companyTagline);
    setBusinessRegistrationNo('');
    setVatRegistrationNo('');
    setTinNo('');
    setSupportPhone('');
    setSupportEmail('');
    setWebsiteUrl('');
    setSocialLinks('');
  };

  const handleShopChange = (shopId: string) => {
    const activeShop = shopProfiles.find((shop) => shop.id === shopId);
    if (!activeShop) {
      return;
    }
    setActiveShopId(shopId);
    setStoreName(activeShop.name || 'Lanka Smart Hardware');
    setInvoicePrefix(activeShop.invoicePrefix || 'SL-INV');
    setTaxRate(Number(activeShop.taxRate || 18));
    setLogoUrl(sanitizeImageSrc(activeShop.logoUrl || '') || '');
    setShopAddress(activeShop.address || '');
    setShopPhone(activeShop.phone || '');
    setPrintFormat(isWholesaleShopProfile(activeShop) ? 'a4' : ((activeShop.printFormat as 'a4' | 'thermal') || 'a4'));
    const activeInvoiceMeta = {
      ...defaultInvoiceCompanyMeta,
      ...(activeShop.invoiceCompanyMeta || {}),
    };
    setCompanyLegalName(activeInvoiceMeta.companyLegalName || defaultInvoiceCompanyMeta.companyLegalName);
    setCompanyTagline(activeInvoiceMeta.companyTagline || defaultInvoiceCompanyMeta.companyTagline);
    setBusinessRegistrationNo(activeInvoiceMeta.businessRegistrationNo || '');
    setVatRegistrationNo(activeInvoiceMeta.vatRegistrationNo || '');
    setTinNo(activeInvoiceMeta.tinNo || '');
    setSupportPhone(activeInvoiceMeta.supportPhone || '');
    setSupportEmail(activeInvoiceMeta.supportEmail || '');
    setWebsiteUrl(activeInvoiceMeta.websiteUrl || '');
    setSocialLinks(activeInvoiceMeta.socialLinks || '');
  };

  // Profit/Loss Calculations
  // Income comes from completed POS sales transactions
  const totalIncome = transactions.reduce((sum, t) => sum + t.subtotal + t.tax, 0);

  // Expenses come from Received POs (actually bought restocks) plus manual expenses
  const purchaseExpenses = purchaseOrders
    .filter((po) => po.status === 'Received')
    .reduce((sum, po) => sum + po.total, 0);

  const totalExpensesAmt = manualExpenses.reduce((sum, e) => sum + e.amount, 0) + purchaseExpenses;
  const netProfit = totalIncome - totalExpensesAmt;

  const handleLogManualExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expDesc.trim() || expAmt <= 0) {
      alert('Description and positive amount are required.');
      return;
    }

    try {
      await onAddManualExpense({
        desc: expDesc,
        amount: expAmt,
        category: expCat,
      });
      setIsExpOpen(false);
      setExpDesc('');
      setExpAmt(0);
    } catch (err: any) {
      alert(err.message || 'Failed to log expense');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();

    const nextProfiles = shopProfiles.map((shop) => {
      if (shop.id !== activeShopId) {
        return shop;
      }
      const nextShop = {
        ...shop,
        name: storeName,
        taxRate,
        invoicePrefix,
        logoUrl,
        address: shopAddress,
        phone: shopPhone,
        printFormat,
        invoiceCompanyMeta: {
          companyLegalName,
          companyTagline,
          businessRegistrationNo,
          vatRegistrationNo,
          tinNo,
          supportPhone,
          supportEmail,
          websiteUrl,
          socialLinks,
        },
      };
      return isWholesaleShopProfile(nextShop) ? { ...nextShop, printFormat: 'a4' as const } : nextShop;
    });

    const activeShop = nextProfiles.find((shop) => shop.id === activeShopId) || nextProfiles[0];

    try {
      await onUpdateTaxConfig({
        storeName: activeShop?.name || storeName,
        taxRate: Number(activeShop?.taxRate || taxRate),
        currency,
        invoicePrefix: String(activeShop?.invoicePrefix || invoicePrefix),
        logoUrl: String(activeShop?.logoUrl || logoUrl || ''),
        address: String(activeShop?.address || shopAddress || ''),
        phone: String(activeShop?.phone || shopPhone || ''),
        activeShopId: activeShop?.id,
        shopProfiles: nextProfiles,
      });
      setIsSettingsSaved(true);
      setTimeout(() => setIsSettingsSaved(false), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to save settings');
    }
  };

  const isManager = ['Super Admin', 'Store Manager'].includes(currentRole);
  const selectedSettingsShop = shopProfiles.find((shop) => shop.id === activeShopId);
  const isWholesaleSettingsShop = Boolean(selectedSettingsShop && isWholesaleShopProfile(selectedSettingsShop));

  return (
    <div className="space-y-6 motion-safe:animate-fade-in font-sans selection:bg-amber-100">
      {/* Tab Switching Navigation Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-heading font-medium tracking-tight text-slate-900">
            Accounting and Store Settings
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Audit store cash flows, register fixed overhead expenses, and configure invoicing parameters.
          </p>
        </div>

        <div className="flex bg-slate-100 p-1.5 rounded-lg border border-slate-200 shrink-0">
          <button
            onClick={() => setActiveTab('accounting')}
            className={`px-4 py-1.5 rounded text-xs font-semibold tracking-tight transition-all ${
              activeTab === 'accounting' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Financial Ledger
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-1.5 rounded text-xs font-semibold tracking-tight transition-all ${
              activeTab === 'settings' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Store settings
          </button>
        </div>
      </div>

      {isSettingsSaved && (
        <div id="settings-save-toast" className="bg-emerald-50 border border-emerald-250 text-emerald-800 p-4 rounded-xl flex items-center gap-2 text-xs">
          <CheckCircle className="w-4 h-4 text-emerald-500" />
          <span>General store configurations saved and applied to POS checkout registers.</span>
        </div>
      )}

      {/* RENDER TAB 1: FINANCIAL LEDGER */}
      {activeTab === 'accounting' && (
        <div className="space-y-6">
          {/* KPI Analytics Block */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block tracking-wider">Gross Sales Income</span>
                <strong className="text-2xl font-mono text-slate-900 block mt-1">{currencySymbol}{totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-1 mt-1 font-mono">
                  <TrendingUp className="w-3 h-3" /> FROM {transactions.length} CASHIER SALES
                </span>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600 h-11 w-11 flex items-center justify-center shrink-0">
                <DollarSign className="w-5 h-5 font-bold" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block tracking-wider">Total Store Cost Expenses</span>
                <strong className="text-2xl font-mono text-slate-900 block mt-1">{currencySymbol}{totalExpensesAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                <span className="text-[9px] text-rose-600 font-bold flex items-center gap-1 mt-1 font-mono">
                  <TrendingDown className="w-3 h-3" /> Procurement: {currencySymbol}{purchaseExpenses.toFixed(2)}
                </span>
              </div>
              <div className="p-3 bg-rose-50 rounded-xl text-rose-600 h-11 w-11 flex items-center justify-center shrink-0">
                <CreditCard className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block tracking-wider">Net Operating Surplus</span>
                <strong className={`text-2xl font-mono block mt-1 ${netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {currencySymbol}{netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
                <span className="text-[9px] text-slate-500 block mt-1 font-mono">After logistics and overheads</span>
              </div>
              <div className={`p-3 rounded-xl h-11 w-11 flex items-center justify-center shrink-0 ${netProfit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                <FileSpreadsheet className="w-5 h-5" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Cash Flow Timeline logs (8 cols) */}
            <div className="lg:col-span-8 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h4 className="font-heading font-medium text-slate-900 text-sm">Overhead & Expense Chronology</h4>
                  <p className="text-[10px] text-slate-400">Inventory shipments and fixed store expenditures.</p>
                </div>

                {isManager && (
                  <button
                    id="btn-trigger-expense"
                    onClick={() => setIsExpOpen(true)}
                    className="bg-slate-900 hover:bg-slate-950 text-slate-100 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 leading-none shadow-3xs transition"
                  >
                    <Plus className="w-4 h-4" /> Log Store Expense
                  </button>
                )}
              </div>

              <div className="overflow-x-auto text-[11px] font-sans">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/75 text-slate-500 font-medium font-sans border-b border-slate-100">
                      <th className="p-4">Paid On</th>
                      <th className="p-4">Reference/Description</th>
                      <th className="p-4">Category</th>
                      <th className="p-4 text-right">Debit amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {/* Map purchases first as capital expenses */}
                    {purchaseOrders
                      .filter((po) => po.status === 'Received')
                      .map((po) => (
                        <tr key={po.id} className="hover:bg-slate-50/50 transition">
                          <td className="p-4 text-slate-400 font-mono">Completed Date</td>
                          <td className="p-4">
                            <span className="font-semibold text-slate-900 block">Stock Replenishment Invoice</span>
                            <span className="text-[9px] text-slate-400 block mt-0.5">Wholesaler PO: {po.poNumber} ({po.supplierName})</span>
                          </td>
                          <td className="p-4">
                            <span className="bg-blue-50 text-blue-800 text-[9px] font-mono font-bold px-2 py-0.5 rounded">Inventory</span>
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-rose-600">
                            -{currencySymbol}{po.total.toFixed(2)}
                          </td>
                        </tr>
                      ))}

                    {/* Map manual expenses */}
                    {manualExpenses.map((exp) => (
                      <tr key={exp.id} className="hover:bg-slate-50/50 transition">
                        <td className="p-4 text-slate-400 font-mono">{exp.date}</td>
                        <td className="p-4">
                          <span className="font-semibold text-slate-900 block">{exp.desc}</span>
                        </td>
                        <td className="p-4">
                          <span className="bg-slate-100 text-slate-700 text-[9px] font-mono font-bold px-2 py-0.5 rounded">{exp.category}</span>
                        </td>
                        <td className="p-4 text-right font-mono font-bold text-rose-600">
                          -{currencySymbol}{exp.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Income Streams POS Quick Ledger (4 cols) */}
            <div className="lg:col-span-4 bg-white p-5 rounded-xl border border-slate-100 shadow-xs flex flex-col justify-between">
              <div>
                <h4 className="font-heading font-medium text-slate-900 text-sm">POS Income Stream Feed</h4>
                <p className="text-[11px] text-slate-400 mb-4">Chronological receipts compiled at cashier registers.</p>

                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  {transactions.map((t, idx) => {
                    const grossText = (t.subtotal + t.tax).toFixed(2);
                    return (
                      <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200/55 flex justify-between font-mono text-[11px]">
                        <div>
                          <strong className="text-slate-800 font-sans block">{t.invoiceNumber}</strong>
                          <span className="text-slate-400 text-[9px] block mt-0.5">Ref: {t.paymentMethod}</span>
                        </div>
                        <span className="text-emerald-600 font-bold shrink-0 mt-0.5">+{currencySymbol}{grossText}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-mono text-slate-500 leading-relaxed text-center">
                Financial balances calculated dynamically against local state file storage records.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RENDER TAB 2: STORE SETTINGS PANEL */}
      {activeTab === 'settings' && (
        <div className="bg-white p-6 rounded-xl border border-slate-150 shadow-xs max-w-lg mx-auto">
          <h3 className="font-heading font-medium text-slate-900 text-base mb-4 flex items-center gap-1.5">
            <Settings className="w-5 h-5 text-amber-500 animate-spin-slow" /> Store Parameters configuration
          </h3>

          <form onSubmit={handleSaveSettings} className="space-y-5 text-xs font-sans">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Active Shop / Branch</label>
                <select
                  id="settings-active-shop"
                  value={activeShopId}
                  onChange={(e) => handleShopChange(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none text-xs"
                >
                  {shopProfiles.map((shop) => (
                    <option key={shop.id} value={shop.id}>
                      {shop.name}{isWholesaleShopProfile(shop) ? ' (Wholesale)' : ' (Retail)'}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={addShopProfile}
                className="h-10 px-3 bg-slate-900 hover:bg-slate-950 text-white rounded font-semibold"
              >
                + Add Shop
              </button>
            </div>

            <div>
              <label className="block text-slate-500 font-semibold mb-1">Corporate Store Handle Name *</label>
              <input
                id="settings-store-name"
                type="text"
                required
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500 font-bold"
              />
            </div>

            <div>
              <label className="block text-slate-500 font-semibold mb-1">Logo URL or Uploaded Path (per shop)</label>
              <input
                id="settings-logo-url"
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png or /uploads/shops/logo.png"
                className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
              />
              <div className="mt-2">
                <label className="block text-slate-500 font-semibold mb-1">Upload Logo File</label>
                <input
                  id="settings-logo-upload"
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) {
                      return;
                    }
                    try {
                      await handleUploadShopLogo(file);
                    } catch (err: any) {
                      alert(err.message || 'Failed to upload logo');
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded text-xs"
                />
              </div>
              {logoUrl && (
                <div className="mt-2 p-2 bg-slate-50 border border-slate-200 rounded flex items-center gap-2">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded bg-white border border-slate-200 text-[10px] font-bold text-slate-500">OK</span>
                  <span className="text-[11px] text-slate-500">Logo uploaded and stored for the active shop</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Shop Address</label>
                <textarea
                  id="settings-shop-address"
                  value={shopAddress}
                  onChange={(e) => setShopAddress(e.target.value)}
                  rows={3}
                  placeholder="Street, city, country"
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500 resize-y"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">Shop Phone</label>
                <input
                  id="settings-shop-phone"
                  type="text"
                  value={shopPhone}
                  onChange={(e) => setShopPhone(e.target.value)}
                  placeholder="+94..."
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-slate-500 font-semibold mb-1 flex items-center gap-1">
                  <Percent className="w-4 h-4 text-slate-400" /> State VAT/GST Tax Rate (%)
                </label>
                <input
                  id="settings-tax-rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="30"
                  required
                  value={taxRate}
                  onChange={(e) => setTaxRate(Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-semibold mb-1">POS Currency ISO</label>
                <select
                  id="settings-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none text-xs"
                >
                  <option value="LKR">LKR (Rs)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-slate-500 font-semibold mb-1 flex items-center gap-1">
                <Receipt className="w-4 h-4 text-slate-400" /> Cashier Invoice Series Prefix
              </label>
              <input
                id="settings-invoice-prefix"
                type="text"
                required
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500 font-mono uppercase"
              />
            </div>

            <div>
              <label className="block text-slate-500 font-semibold mb-1">Bill Print Format (per shop)</label>
              <select
                id="settings-print-format"
                value={printFormat}
                onChange={(e) => setPrintFormat(e.target.value as 'a4' | 'thermal')}
                className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none text-xs"
              >
                <option value="a4">A4 Invoice</option>
                <option value="thermal" disabled={isWholesaleSettingsShop}>Thermal 80mm</option>
              </select>
              {isWholesaleSettingsShop && (
                <p className="mt-1 text-[11px] text-amber-700">Wholesale shop billing is locked to A4 format.</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Company Legal Name</label>
                <input
                  type="text"
                  value={companyLegalName}
                  onChange={(e) => setCompanyLegalName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Company Tagline</label>
                <input
                  type="text"
                  value={companyTagline}
                  onChange={(e) => setCompanyTagline(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Business Registration No.</label>
                <input
                  type="text"
                  value={businessRegistrationNo}
                  onChange={(e) => setBusinessRegistrationNo(e.target.value)}
                  placeholder="e.g. PV123456"
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-slate-500 font-semibold mb-1">VAT Registration No.</label>
                <input
                  type="text"
                  value={vatRegistrationNo}
                  onChange={(e) => setVatRegistrationNo(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-slate-500 font-semibold mb-1">TIN No.</label>
                <input
                  type="text"
                  value={tinNo}
                  onChange={(e) => setTinNo(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Customer Support Contact</label>
                <input
                  type="text"
                  value={supportPhone}
                  onChange={(e) => setSupportPhone(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Support Email</label>
                <input
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Website URL</label>
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-500 font-semibold mb-1">Social Media Links</label>
                <input
                  type="text"
                  value={socialLinks}
                  onChange={(e) => setSocialLinks(e.target.value)}
                  placeholder="Facebook, Instagram, LinkedIn"
                  className="w-full bg-slate-50 border border-slate-200 p-2.5 rounded focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-lg text-slate-700 leading-snug">
              <strong>Caution:</strong> Changes configured in settings will propagate instantly into checkout receipts generated inside POS and reports summaries. Ensure tax ratios map actual legislative mandates.
            </div>

            <div className="pt-2">
              <button
                id="btn-save-settings"
                type="submit"
                className="w-full py-3 bg-slate-900 hover:bg-slate-950 text-slate-100 font-bold rounded-lg shadow-sm transition"
              >
                Save configurations
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FIXED LOG OVERHEAD EXPENSE DRAWER MODAL */}
      {isExpOpen && (
        <div id="expense-modal-backdrop" className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm border border-slate-250 font-sans relative">
            <button
              onClick={() => setIsExpOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4">
              Log Operations Overhead Expense
            </h3>

            <form onSubmit={handleLogManualExpense} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Expense Description *</label>
                <input
                  id="input-exp-desc"
                  type="text"
                  required
                  value={expDesc}
                  onChange={(e) => setExpDesc(e.target.value)}
                  placeholder="e.g. Daily diesel for generator back-up"
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Amount ({currencySymbol}) *</label>
                  <input
                    id="input-exp-amount"
                    type="number"
                    step="0.01"
                    min="0.1"
                    required
                    value={expAmt}
                    onChange={(e) => setExpAmt(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-500 font-semibold mb-1">Expense Category</label>
                  <select
                    id="input-exp-category"
                    value={expCat}
                    onChange={(e) => setExpCat(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 p-2 rounded focus:outline-none text-xs"
                  >
                    {expenseCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsExpOpen(false)}
                  className="flex-1 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
                >
                  Cancel
                </button>
                <button
                  id="btn-log-expense-submit"
                  type="submit"
                  className="flex-1 py-1.5 text-xs font-bold text-slate-150 bg-rose-500 hover:bg-rose-600 rounded shadow-3xs text-slate-100"
                >
                  Log Expense Debit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}