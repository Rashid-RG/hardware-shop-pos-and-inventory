import HistoricalCostReviewPanel from './HistoricalCostReviewPanel';
import FinancialProfitPanel from './FinancialProfitPanel';
import FinancialCashFlowPanel from './FinancialCashFlowPanel';
import DisbursementVoucherActions from './DisbursementVoucherActions';
import CashHandoversPanel from './CashHandoversPanel';
import RepresentativeLoginsPanel from './RepresentativeLoginsPanel';
import RepresentativeAccountsPanel from './RepresentativeAccountsPanel';
import { arsDisplayName } from '../utils/arsPrintLogo';
import { reportDay } from '../utils/reporting';
import { ReportExportMenu } from './ReportExportMenu';
import type { BusinessReport } from '../utils/businessReport';
import React, { useEffect, useState, useRef } from 'react';
import { notify } from '../utils/notifications';
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
import SupportHealthPanel from './SupportHealthPanel';
import FinancialAccountsPanel from './FinancialAccountsPanel';
import ChequeManagementPanel from './ChequeManagementPanel';
import FinancialReconciliationPanel from './FinancialReconciliationPanel';
import FinancialStatementPanel from './FinancialStatementPanel';
import type { Customer } from '../types';

type ExpenseRequest=Omit<ManualExpense,'id'|'date'> & {sourceAccountId?:string;requestId?:string;paymentMethod?:string};
type ExpenseAccount={id:string;name:string;kind:string;active:boolean;balance:number};
interface AccountingSettingsViewProps {
  initialView?: 'accounting' | 'settings';
  transactions: SalesTransaction[];
  purchaseOrders: PurchaseOrder[];
  currentRole: Role;
  taxConfig: StoreSettings;
  manualExpenses: ManualExpense[];
  authToken: string;
  financialOwner?: string;
  financialCustomers?: Customer[];
  onFinancialRefresh?: () => Promise<void>;
  financialShopId?: string;
  onUpdateTaxConfig: (config: StoreSettings) => Promise<void>;
  onAddManualExpense: (expense: ExpenseRequest) => Promise<void>;
}

export default function AccountingSettingsView({
  initialView = 'accounting',
  transactions,
  purchaseOrders,
  currentRole,
  taxConfig,
  manualExpenses,
  authToken,
  financialOwner,
  financialCustomers = [],
  onFinancialRefresh,
  financialShopId,
  onUpdateTaxConfig,
  onAddManualExpense,
}: AccountingSettingsViewProps) {
  const defaultInvoiceCompanyMeta = {
    companyLegalName: '',
    companyTagline: 'Imports & Wholesale Distribution',
    businessRegistrationNo: '',
    vatRegistrationNo: '',
    tinNo: '',
    supportPhone: '',
    supportEmail: '',
    websiteUrl: '',
    socialLinks: '',
  };

  const currencySymbol = 'Rs.';
  const [costCorrectionRevision,setCostCorrectionRevision]=useState(0);
  const [activeTab, setActiveTab] = useState<'accounting' | 'settings'>(initialView);

  // Expense Logger form states
  const [isExpOpen, setIsExpOpen] = useState(false);
  const [expDesc, setExpDesc] = useState('');
  const [expAmt, setExpAmt] = useState(0);
  const [expCat, setExpCat] = useState('Utilities');
  const expenseCategories = ['Utilities','Maintenance','Rent','Wages','Transport & distribution','Vehicle fuel','Freight','Customs & clearance','Warehouse handling','Packaging','Office supplies','Marketing','Bank charges','Professional fees','Other'];
  const [expenseAccounts,setExpenseAccounts]=useState<ExpenseAccount[]>([]);
  const [expenseSource,setExpenseSource]=useState('');
  const [expenseMethod,setExpenseMethod]=useState('Cash');
  const [expenseLoading,setExpenseLoading]=useState(false);
  const [expenseBusy,setExpenseBusy]=useState(false);
  const [expenseError,setExpenseError]=useState('');
  const [expensePending,setExpensePending]=useState<ExpenseRequest|null>(null);
  const [expenseReady,setExpenseReady]=useState(false);
  const expenseLock=useRef(false);
  const expenseShop=financialShopId||taxConfig.activeShopId||'';
  const expenseKey='ars:pending-expense:'+JSON.stringify([financialOwner||'',expenseShop]);
  const matchingExpenseAccounts=expenseAccounts.filter(a=>a.active&&a.kind===(expenseMethod==='Cash'?'Office Cash':'Bank'));
  const chosenExpenseAccount=matchingExpenseAccounts.find(a=>a.id===expenseSource);
  useEffect(()=>{
    setExpenseReady(false);setExpensePending(null);setIsExpOpen(false);setExpenseError('');
    if(!financialOwner||!expenseShop)return;
    try{setExpensePending(JSON.parse(localStorage.getItem(expenseKey)||'null'));setExpenseReady(true);}catch{setExpenseError('Cannot read saved expense. Check browser storage.');}
  },[expenseKey,financialOwner,expenseShop]);
  useEffect(()=>{
    setExpenseAccounts([]);setExpenseSource('');
    if(!isExpOpen||!expenseShop)return;
    const controller=new AbortController();setExpenseLoading(true);setExpenseError('');
    fetch('/api/financial-accounts',{headers:{Authorization:'Bearer '+authToken,'X-Shop-Id':expenseShop},cache:'no-store',signal:controller.signal})
      .then(async r=>{const data=await r.json();if(!r.ok||!Array.isArray(data))throw Error(data.error||'Unable to load financial accounts.');return data;})
      .then(data=>{if(!controller.signal.aborted)setExpenseAccounts(data);})
      .catch(e=>{if(!controller.signal.aborted)setExpenseError(e.message);})
      .finally(()=>{if(!controller.signal.aborted)setExpenseLoading(false);});
    return ()=>controller.abort();
  },[isExpOpen,expenseShop,authToken]);

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
        name: config.storeName || 'ARS Distributor',
        logoUrl: config.logoUrl || '',
        address: config.address || '',
        phone: config.phone || '',
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
      address: '',
      phone: '',
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
    setStoreName(arsDisplayName(activeShop.name || 'ARS Distributor'));
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

  // Invoice value is not cash income; stock procurement is not cost of goods sold.
  const completedSales=transactions.filter(t=>t.status==='Completed');
  const totalIncome=completedSales.reduce((sum,t)=>sum+t.total,0);
  const purchaseExpenses=purchaseOrders.filter(po=>po.status==='Received').reduce((sum,po)=>sum+po.total,0);
  const totalExpensesAmt=manualExpenses.reduce((sum,e)=>sum+e.amount,0);
  const creditInvoiceValue=completedSales.filter(t=>t.paymentMethod==='Credit Account').reduce((sum,t)=>sum+t.total,0);

  const sendExpense=async(request:ExpenseRequest)=>{
    if(expenseLock.current)return;
    expenseLock.current=true;setExpenseBusy(true);setExpenseError('');
    try{
      await onAddManualExpense(request);
      localStorage.removeItem(expenseKey);setExpensePending(null);setIsExpOpen(false);setExpDesc('');setExpAmt(0);
      notify.success('Expense recorded.');
    }catch(err){setExpenseError(err instanceof Error?err.message:'Unable to confirm expense. Retry the original request.');}
    finally{expenseLock.current=false;setExpenseBusy(false);}
  };
  const handleLogManualExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if(expenseLock.current||expensePending||!expenseReady)return;
    if(!expDesc.trim()||!Number.isFinite(expAmt)||expAmt<=0||!chosenExpenseAccount||chosenExpenseAccount.balance<expAmt){
      setExpenseError('Enter valid expense details and select an account with sufficient recorded funds.');return;
    }
    const request:ExpenseRequest={desc:expDesc.trim(),amount:expAmt,category:expCat,sourceAccountId:expenseSource,paymentMethod:expenseMethod,requestId:crypto.randomUUID()};
    try{localStorage.setItem(expenseKey,JSON.stringify(request));}catch{setExpenseError('Cannot safely preserve expense request.');return;}
    setExpensePending(request);await sendExpense(request);
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
        printFormat: 'a4' as const,
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
      return nextShop;
    });

    const activeShop = nextProfiles.find((shop) => shop.id === activeShopId) || nextProfiles[0];

    try {
      await onUpdateTaxConfig({
        storeName: activeShop?.name || storeName,
        taxRate: Number(activeShop?.taxRate ?? taxRate),
        currency,
        invoicePrefix: String(activeShop?.invoicePrefix ?? invoicePrefix),
        logoUrl: String(activeShop?.logoUrl || logoUrl || ''),
        address: String(activeShop?.address || shopAddress || ''),
        phone: String(activeShop?.phone || shopPhone || ''),
        activeShopId: activeShop?.id,
        shopProfiles: nextProfiles,
      });
      setIsSettingsSaved(true);
      setTimeout(() => setIsSettingsSaved(false), 3000);
    } catch (err: any) {
      notify.warning(err.message || 'Failed to save settings');
    }
  };

  const isManager = ['Super Admin', 'Store Manager'].includes(currentRole);
  const selectedSettingsShop = shopProfiles.find((shop) => shop.id === activeShopId);
  const isWholesaleSettingsShop = true; // ARS uses A4 wholesale invoices.

  return (
    <div className="space-y-6 motion-safe:animate-fade-in font-sans selection:bg-amber-100">
      {/* Tab Switching Navigation Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-heading font-medium tracking-tight text-slate-900">
            ARS Finance & Company Profile
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage wholesale finances and edit ARS company details used in A4 invoices.
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
          {currentRole==='Super Admin' && <RepresentativeLoginsPanel authToken={authToken} shopId={financialShopId || taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id} />}
          {isManager && financialOwner && <CashHandoversPanel manager authToken={authToken} owner={financialOwner} shopId={financialShopId || taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id} />}
          {isManager && <RepresentativeAccountsPanel authToken={authToken} shopId={financialShopId || taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id} />}
          {isManager && <FinancialAccountsPanel authToken={authToken} owner={financialOwner} shopId={financialShopId || taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id} />}
          {isManager && <ChequeManagementPanel authToken={authToken} owner={financialOwner} shopId={financialShopId || taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id} customers={financialCustomers} transactions={transactions} onRefresh={onFinancialRefresh} />}
          {isManager && <FinancialReconciliationPanel authToken={authToken} owner={financialOwner} shopId={financialShopId || taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id} />}
          {currentRole==='Super Admin' && financialOwner && <HistoricalCostReviewPanel authToken={authToken} owner={financialOwner} shopId={financialShopId || taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id} onChanged={()=>setCostCorrectionRevision(n=>n+1)} />}
          {isManager && <FinancialProfitPanel correctionRevision={costCorrectionRevision} authToken={authToken} shopId={financialShopId || taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id} settings={taxConfig} />}
          {isManager && <FinancialCashFlowPanel authToken={authToken} shopId={financialShopId || taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id} settings={taxConfig} />}
          {isManager && <FinancialStatementPanel authToken={authToken} shopId={financialShopId || taxConfig.activeShopId || toDefaultShopProfiles(taxConfig)[0].id} settings={taxConfig} />}
          {isManager&&<ReportExportMenu settings={taxConfig} report={()=>({title:'Financial ledger overview',filename:'ars-financial-ledger',period:'All available records | operational figures, not audited accounts',headers:['Type','Date','Reference / description','Status','Amount (LKR)'],moneyColumns:[4],rows:[...transactions.map(t=>['Sale',reportDay(t.date),t.invoiceNumber,t.status||'Completed',t.total]),...purchaseOrders.map(p=>['Purchase order',reportDay(p.date),p.poNumber,p.status,p.total]),...manualExpenses.map(e=>['Manual expense',reportDay(e.date),e.desc,e.category,e.amount])],summary:[{label:'Non-refunded invoice totals (LKR)',value:transactions.filter(t=>t.status!=='Refunded').reduce((a,t)=>a+t.total,0)},{label:'Received purchase orders (LKR)',value:purchaseOrders.filter(p=>p.status==='Received').reduce((a,p)=>a+p.total,0)},{label:'Manual expenses (LKR)',value:manualExpenses.reduce((a,e)=>a+e.amount,0)}]})}/>}
          {/* KPI Analytics Block */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block tracking-wider">Completed invoice value (incl. tax)</span>
                <strong className="text-2xl font-mono text-slate-900 block mt-1">{currencySymbol}{totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-1 mt-1 font-mono">
                  <TrendingUp className="w-3 h-3" /> FROM {completedSales.length} INVOICES
                </span>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600 h-11 w-11 flex items-center justify-center shrink-0">
                <DollarSign className="w-5 h-5 font-bold" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block tracking-wider">Recorded manual expenses</span>
                <strong className="text-2xl font-mono text-slate-900 block mt-1">{currencySymbol}{totalExpensesAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                <span className="text-[9px] text-rose-600 font-bold flex items-center gap-1 mt-1 font-mono">
                  <TrendingDown className="w-3 h-3" /> Received PO value (separate): {currencySymbol}{purchaseExpenses.toFixed(2)}
                </span>
              </div>
              <div className="p-3 bg-rose-50 rounded-xl text-rose-600 h-11 w-11 flex items-center justify-center shrink-0">
                <CreditCard className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block tracking-wider">Credit invoice value</span>
                <strong className={`text-2xl font-mono block mt-1 text-slate-900`}>
                  {currencySymbol}{creditInvoiceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
                <span className="text-[9px] text-slate-500 block mt-1 font-mono">Original credit invoice totals, not outstanding debt</span>
              </div>
              <div className={`p-3 rounded-xl h-11 w-11 flex items-center justify-center shrink-0 bg-slate-100 text-slate-700`}>
                <FileSpreadsheet className="w-5 h-5" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Cash Flow Timeline logs (8 cols) */}
            <div className="lg:col-span-8 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h4 className="font-heading font-medium text-slate-900 text-sm">Procurement and expense records</h4>
                  <p className="text-[10px] text-slate-400">Received purchase orders are inventory records, not evidence of payment.</p>
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
                      <th className="p-4">Record date</th>
                      <th className="p-4">Reference/Description</th>
                      <th className="p-4">Category</th>
                      <th className="p-4 text-right">Recorded value</th>
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
                            <span className="font-semibold text-slate-900 block">Received purchase order (not payment)</span>
                            <span className="text-[9px] text-slate-400 block mt-0.5">Wholesaler PO: {po.poNumber} ({po.supplierName})</span>
                          </td>
                          <td className="p-4">
                            <span className="bg-blue-50 text-blue-800 text-[9px] font-mono font-bold px-2 py-0.5 rounded">Inventory</span>
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-rose-600">
                            {currencySymbol}{po.total.toFixed(2)}
                          </td>
                        </tr>
                      ))}

                    {/* Map manual expenses */}
                    {manualExpenses.map((exp) => (
                      <tr key={exp.id} className="hover:bg-slate-50/50 transition">
                        <td className="p-4 text-slate-400 font-mono">{exp.date}</td>
                        <td className="p-4">
                          <span className="font-semibold text-slate-900 block">{exp.desc}</span>
                          {isManager&&expenseShop&&<DisbursementVoucherActions kind="expense" id={exp.id} authToken={authToken} shopId={expenseShop} />}
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
                <h4 className="font-heading font-medium text-slate-900 text-sm">Completed invoice register</h4>
                <p className="text-[11px] text-slate-400 mb-4">Invoice values, including credit sales; not cash collections.</p>

                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  {completedSales.map((t, idx) => {
                    const grossText = t.total.toFixed(2);
                    return (
                      <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200/55 flex justify-between font-mono text-[11px]">
                        <div>
                          <strong className="text-slate-800 font-sans block">{t.invoiceNumber}</strong>
                          <span className="text-slate-400 text-[9px] block mt-0.5">Ref: {t.paymentMethod}</span>
                        </div>
                        <span className="text-emerald-600 font-bold shrink-0 mt-0.5">{currencySymbol}{grossText}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-mono text-slate-500 leading-relaxed text-center">
                For actual cash movements, use the recorded cash flow and account statements above.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RENDER TAB 2: STORE SETTINGS PANEL */}
      {activeTab === 'settings' && (
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-150 shadow-xs max-w-5xl mx-auto">
          <h3 className="font-heading font-medium text-slate-900 text-base mb-4 flex items-center gap-1.5">
            <Settings className="w-5 h-5 text-amber-500 animate-spin-slow" /> Company Profile · Legal & Billing Details
          </h3>

          <form onSubmit={handleSaveSettings} className="space-y-3 text-xs font-sans">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-3">
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
                      {shop.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={addShopProfile}
                className="h-10 px-3 bg-slate-900 hover:bg-slate-950 text-white rounded font-semibold"
              >
                + Add Branch
              </button>
            </div>

            <div>
              <label className="block text-slate-500 font-semibold mb-1">Company / Branch Name *</label>
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
                      notify.warning(err.message || 'Failed to upload logo');
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-200 p-2 rounded text-xs"
                />
              </div>
              {logoUrl && (
                <div className="mt-2 p-2 bg-slate-50 border border-slate-200 rounded flex items-center gap-2">
                  <img src={sanitizeImageSrc(logoUrl) || ''} alt="Company logo preview" className="h-14 w-20 rounded-lg border border-slate-200 bg-slate-900 p-1 object-contain" />
                  <span className="text-[11px] text-slate-500">Logo ready. Save Company Profile to apply it to invoices.</span>
                </div>
              )}
            </div>

              </div>
              <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-500 font-semibold mb-1">Registered / Trading Address</label>
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

            <div className="grid grid-cols-2 gap-3">
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
                <Receipt className="w-4 h-4 text-slate-400" /> Invoice Series Prefix
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

              </div>
            </div>

            <details className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">Legal registration, support contacts and additional invoice details</summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            </details>

            <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-lg text-slate-700 leading-snug">
              <strong>Caution:</strong> Changes configured in settings will propagate instantly into checkout receipts generated inside POS and reports summaries. Ensure tax ratios map actual legislative mandates.
            </div>

            <div className="sticky bottom-0 z-10 border-t border-slate-200 bg-white/95 py-3 backdrop-blur-sm">
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

      {activeTab === 'settings' && ['Super Admin', 'Store Manager'].includes(currentRole) && (
        <SupportHealthPanel authToken={authToken} />
      )}

      {expensePending&&isManager&&<div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm"><strong>Unconfirmed expense</strong><p>{expensePending.desc} · Rs. {expensePending.amount.toFixed(2)}</p><p>Retry the original request; do not enter another expense.</p>{expenseError&&<p role="alert">{expenseError}</p>}<button type="button" disabled={expenseBusy} className="rounded bg-slate-900 text-white px-3 py-2" onClick={()=>void sendExpense(expensePending)}>Retry exact expense</button></div>}
      {/* FIXED LOG OVERHEAD EXPENSE DRAWER MODAL */}
      {isExpOpen && (
        <div id="expense-modal-backdrop" className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-40 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md max-h-[90dvh] overflow-y-auto border border-slate-250 font-sans relative">
            <button
              disabled={expenseBusy}
              onClick={() => setIsExpOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="font-heading font-semibold text-slate-900 text-sm mb-4">
              Record Business Expense
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
                    min="0.01"
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

              <label className="block">Payment method<select value={expenseMethod} onChange={e=>{setExpenseMethod(e.target.value);setExpenseSource('');}} className="block w-full rounded border p-2"><option>Cash</option><option>Bank Transfer</option></select></label>
              <label className="block">Paid from *<select required value={expenseSource} disabled={expenseLoading||expenseBusy} onChange={e=>setExpenseSource(e.target.value)} className="block w-full rounded border p-2"><option value="">{expenseLoading?'Loading accounts…':'Select financial account'}</option>{matchingExpenseAccounts.map(a=><option key={a.id} value={a.id}>{a.name} · Rs. {a.balance.toFixed(2)}</option>)}</select></label>
              {!expenseLoading&&!matchingExpenseAccounts.length&&<p className="text-amber-800">Create a matching financial account first.</p>}
              {chosenExpenseAccount&&<p className="rounded bg-slate-50 p-2">Estimated remaining balance: Rs. {(chosenExpenseAccount.balance-expAmt).toFixed(2)}</p>}
              <p className="text-slate-500">Record only actual payments. Do not duplicate supplier payments or inventory costs as overhead expenses.</p>
              {expenseError&&<p role="alert" className="text-red-700">{expenseError}</p>}
              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  disabled={expenseBusy}
                  onClick={() => setIsExpOpen(false)}
                  className="flex-1 py-1.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
                >
                  Cancel
                </button>
                <button
                  id="btn-log-expense-submit"
                  type="submit"
                  disabled={expenseBusy||expenseLoading||!!expensePending||!expenseReady||!expenseSource}
                  className="flex-1 py-1.5 text-xs font-bold text-slate-150 bg-rose-500 hover:bg-rose-600 rounded shadow-3xs text-slate-100"
                >
                  {expenseBusy?'Recording…':'Record expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
