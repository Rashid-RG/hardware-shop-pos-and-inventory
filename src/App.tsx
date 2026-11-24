import { arsDisplayName } from './utils/arsPrintLogo';
import React, { Suspense, lazy, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import NotificationCenter from './components/NotificationCenter';
import ARSBrand from './components/ARSBrand';
import loginBackgroundImage from './assets/login-hardware-bg.svg';
import { Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck, Store, ArrowUpRight, LockKeyhole, Bolt } from 'lucide-react';
const DashboardView = lazy(() => import('./components/DashboardView'));
const POSView = lazy(() => import('./components/POSView'));
const ProductManagementView = lazy(() => import('./components/ProductManagementView'));
const InventoryView = lazy(() => import('./components/InventoryView'));
const SupplierPurchaseView = lazy(() => import('./components/SupplierPurchaseView'));
const ImportCostPlanner = lazy(() => import('./components/ImportCostPlanner'));
const ImportShipmentView = lazy(() => import('./components/ImportShipmentView'));
const PartnerCapitalView = lazy(() => import('./components/PartnerCapitalView'));
const BackupRecoveryView = lazy(() => import('./components/BackupRecoveryView'));
const CustomerEmployeeView = lazy(() => import('./components/CustomerEmployeeView'));
const AccountingSettingsView = lazy(() => import('./components/AccountingSettingsView'));
const DBAdminView = lazy(() => import('./components/DBAdminView'));
const ReportsView = lazy(() => import('./components/ReportsView'));
const QuotationView = lazy(() => import('./components/QuotationView'));
const CashDrawerView = lazy(() => import('./components/CashDrawerView'));
import type { EstimateDraft } from './components/CalculatorsView';
const CalculatorsView = lazy(() => import('./components/CalculatorsView'));

import { Product, Supplier, Customer, Employee, SalesTransaction, PurchaseOrder, StockLog, ActivityLog, Role, StoreSettings, ManualExpense, AuthUser, SupplierPayment, Quotation, CashShift, CustomerCreditPayment } from './types';

type AppTab = 'dashboard' | 'pos' | 'products' | 'inventory' | 'purchases' | 'imports' | 'shipments' | 'warehouse-receiving' | 'partners' | 'customers' | 'staff' | 'reports' | 'quotations' | 'shifts' | 'accounting' | 'company-profile' | 'backup-recovery' | 'db-admin' | 'calculators';
const SESSION_KEY = 'hardware_shop_session';
const SHOP_SESSION_KEY = 'hardware_shop_active_shop';
const ACTIVE_TAB_SESSION_KEY = 'ars_active_workspace';
const permittedTabs = (role: Role): AppTab[] => {
  const tabs: AppTab[] = ['dashboard', 'calculators'];
  if (['Super Admin', 'Store Manager', 'Cashier'].includes(role)) tabs.push('pos', 'quotations', 'shifts', 'customers', 'reports');
  if (['Super Admin', 'Store Manager', 'Inventory Staff'].includes(role)) tabs.push('products', 'inventory', 'purchases', 'warehouse-receiving');
  if (['Super Admin', 'Store Manager'].includes(role)) tabs.push('imports', 'shipments', 'staff', 'accounting', 'company-profile');
  if (role === 'Super Admin') tabs.push('partners', 'backup-recovery', 'db-admin');
  return tabs;
};

export default function App() {
  const [estimateDraft, setEstimateDraft] = useState<EstimateDraft | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => localStorage.getItem('ars_sidebar_collapsed') === 'true');
  const [sessionToken, setSessionToken] = useState<string>('');
  const [selectedShopId, setSelectedShopId] = useState<string>('');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [isCreatingAdmin, setIsCreatingAdmin] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [setupStatus, setSetupStatus] = useState('');
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [recoveryEmailEnabled, setRecoveryEmailEnabled] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirm, setRecoveryConfirm] = useState('');
  const [recoveryRequested, setRecoveryRequested] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveryDone, setRecoveryDone] = useState(false);
  const [recoveryRetryAt, setRecoveryRetryAt] = useState(0);
  const [recoveryNow, setRecoveryNow] = useState(Date.now());
  useEffect(() => {
    if (!isForgotModalOpen || !recoveryRequested || recoveryDone) return;
    const timer = window.setInterval(() => setRecoveryNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isForgotModalOpen, recoveryRequested, recoveryDone]);
  const resendRecovery = async () => {
    if (recoveryBusy || Date.now() < recoveryRetryAt) return;
    setRecoveryBusy(true); setRecoveryMessage('');
    try {
      const response = await fetch('/api/auth/recovery/request', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:recoveryEmail})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to request another code.');
      setRecoveryCode(''); setRecoveryPassword(''); setRecoveryConfirm(''); setRecoveryMessage(data.message); setRecoveryNow(Date.now()); setRecoveryRetryAt(Date.now()+301000);
    } catch (error) { setRecoveryMessage(error instanceof Error ? error.message : 'Recovery unavailable.'); } finally { setRecoveryBusy(false); }
  };
  const openForgotPassword = async () => {
    setRecoveryEmailEnabled(false); setRecoveryEmail(''); setRecoveryCode(''); setRecoveryPassword(''); setRecoveryConfirm(''); setRecoveryRequested(false); setRecoveryMessage(''); setRecoveryDone(false); setRecoveryRetryAt(0); setRecoveryNow(Date.now()); setIsForgotModalOpen(true);
    try { const response = await fetch('/api/auth/recovery-status'); if (response.ok) setRecoveryEmailEnabled((await response.json()).emailEnabled === true); } catch {}
  };
  const submitRecovery = async (event: React.FormEvent) => {
    event.preventDefault(); if (recoveryBusy || recoveryDone) return;
    setRecoveryBusy(true); setRecoveryMessage('');
    try {
      const response = await fetch('/api/auth/recovery/' + (recoveryRequested ? 'complete' : 'request'), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(recoveryRequested ? {email:recoveryEmail,code:recoveryCode,password:recoveryPassword,confirmPassword:recoveryConfirm} : {email:recoveryEmail})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Recovery could not be completed.');
      setRecoveryMessage(data.message);
      if (recoveryRequested) { setRecoveryDone(true); setRecoveryPassword(''); setRecoveryConfirm(''); setRecoveryCode(''); } else { setRecoveryRequested(true); setRecoveryNow(Date.now()); setRecoveryRetryAt(Date.now()+301000); }
    } catch (error) { setRecoveryMessage(error instanceof Error ? error.message : 'Recovery unavailable.'); } finally { setRecoveryBusy(false); }
  };
  const [resetEmail, setResetEmail] = useState('');
  const [resetCurrentPassword, setResetCurrentPassword] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetCurrentPassword, setShowResetCurrentPassword] = useState(false);
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [isResetSubmitting, setIsResetSubmitting] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileCurrentPassword, setProfileCurrentPassword] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');

  const [profileConfirmPassword, setProfileConfirmPassword] = useState('');
  const [showProfileCurrentPassword, setShowProfileCurrentPassword] = useState(false);
  const [showProfileNewPassword, setShowProfileNewPassword] = useState(false);
  const [showProfileConfirmPassword, setShowProfileConfirmPassword] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Core Data Hydration states
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [transactions, setTransactions] = useState<SalesTransaction[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [stockLogs, setStockLogs] = useState<StockLog[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [manualExpenses, setManualExpenses] = useState<ManualExpense[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [cashShifts, setCashShifts] = useState<CashShift[]>([]);
  const [customerCreditPayments, setCustomerCreditPayments] = useState<CustomerCreditPayment[]>([]);

  // Local Tax and Brand configuration parameters
  const [taxConfig, setTaxConfig] = useState<StoreSettings>({
    taxRate: 0,
    storeName: 'ARS Distributor',
    currency: 'LKR',
    invoicePrefix: 'SL-INV',
    logoUrl: '',
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
        name: 'ARS Distributor',
        logoUrl: '',
        address: '',
        phone: '',
        taxRate: 0,
        invoicePrefix: 'SL-INV',
        printFormat: 'a4',
      },
    ],
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Status only enables setup when PostgreSQL has no accounts.
    // If the endpoint is unreachable or access is denied, show normal login.
    let cancelled = false;
    fetch('/api/auth/setup-status')
      .then(async (response) => {
        if (!response.ok) return { setupRequired: false };
        return response.json();
      })
      .then((result) => { if (!cancelled) setSetupRequired(result.setupRequired === true); })
      .catch(() => { if (!cancelled) setSetupRequired(false); });
    return () => { cancelled = true; };
  }, []);

  const handleCreateAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    setSetupError('');
    if (setupPassword.length < 12 || setupPassword !== setupConfirmPassword) {
      setSetupError('Choose a matching password of at least 12 characters.');
      return;
    }
    setIsCreatingAdmin(true);
    try {
      const response = await fetch('/api/auth/setup-admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: setupName, email: setupEmail, password: setupPassword, confirmPassword: setupConfirmPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to create administrator');
      setSetupPassword('');
      setSetupConfirmPassword('');
      setLoginEmail(setupEmail.trim().toLowerCase());
      setSetupStatus('Administrator account created. Sign in using your new password.');
      setSetupRequired(false);
    } catch (error: any) {
      setSetupError(error.message || 'Setup failed.');
    } finally {
      setIsCreatingAdmin(false);
    }
  };

  useEffect(() => {
    const savedSession = sessionStorage.getItem(SESSION_KEY);
    if (!savedSession) {
      setIsLoading(false);
      return;
    }

    try {
      const parsed = JSON.parse(savedSession) as { token: string; user: AuthUser };
      if (parsed?.token && parsed?.user) {
        setSessionToken(parsed.token);
        setAuthUser(parsed.user);
        try {
          const saved = JSON.parse(sessionStorage.getItem(ACTIVE_TAB_SESSION_KEY) || 'null');
          if (saved?.owner === parsed.user.email && permittedTabs(parsed.user.role).includes(saved.tab)) setActiveTab(saved.tab);
        } catch { /* Invalid workspace preference falls back to dashboard. */ }
        setSelectedShopId(parsed.user.scopedShopId || parsed.user.allowedShopIds?.[0] || sessionStorage.getItem(SHOP_SESSION_KEY) || '');
      }
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    handleRefreshDb();
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken || !selectedShopId) {
      return;
    }
    handleRefreshDb();
  }, [selectedShopId]);

  useEffect(() => {
    if (!authUser || !sessionToken) return;
    if (!permittedTabs(authUser.role).includes(activeTab)) {
      setActiveTab('dashboard');
      return;
    }
    try {
      sessionStorage.setItem(ACTIVE_TAB_SESSION_KEY, JSON.stringify({ owner: authUser.email, tab: activeTab }));
    } catch { /* Navigation still works when browser storage is unavailable. */ }
  }, [authUser, sessionToken, activeTab]);

  const handleLogout = () => {
    // Revoke this exact session on the server before clearing its browser copy.
    // The server keeps the revocation in PostgreSQL across restarts.
    if (sessionToken) {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      }).catch(() => {
        // Local sign-out still clears the token if the network is unavailable.
      });
    }
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SHOP_SESSION_KEY);
    sessionStorage.removeItem(ACTIVE_TAB_SESSION_KEY);
    setSessionToken('');
    setSelectedShopId('');
    setAuthUser(null);
    setActiveTab('dashboard');
  };

  const apiRequest = async (url: string, init?: RequestInit) => {
    if (!sessionToken) {
      throw new Error('No active session token found');
    }

    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${sessionToken}`);
    if (selectedShopId) {
      headers.set('X-Shop-Id', selectedShopId);
    }
    if (!headers.has('Content-Type') && init?.body) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
      ...init,
      headers,
    });

    if (response.status === 401) {
      handleLogout();
      throw new Error('Session expired. Please log in again.');
    }

    return response;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      const user: AuthUser = data.user;
      const token: string = data.token;
      setAuthUser(user);
      setSessionToken(token);
      const scopedShop = user.scopedShopId || user.allowedShopIds?.[0] || sessionStorage.getItem(SHOP_SESSION_KEY) || '';
      setSelectedShopId(scopedShop);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
      if (scopedShop) {
        sessionStorage.setItem(SHOP_SESSION_KEY, scopedShop);
      }
      setLoginPassword('');
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleRefreshDb = async () => {
    setIsLoading(true);
    try {
      const res = await apiRequest('/api/db');
      if (!res.ok) throw new Error('Database hydration failed');
      const data = await res.json();
      const settings = data.settings || taxConfig;
      const profiles = Array.isArray(settings.shopProfiles) ? settings.shopProfiles : [];
      const fallbackShopId = data?._meta?.activeShopId || settings.activeShopId || profiles[0]?.id || '';
      const scopedShopId = authUser?.scopedShopId || '';
      const allowedShopIds = authUser?.allowedShopIds || [];
      const hasSelectedShop = selectedShopId && profiles.some((shop: { id: string }) => shop.id === selectedShopId);
      const selectedAllowed = allowedShopIds.length === 0 || allowedShopIds.includes(selectedShopId);
      const allowedFallbackShopId = allowedShopIds.find((shopId) => profiles.some((shop: { id: string }) => shop.id === shopId)) || fallbackShopId;
      const effectiveShopId = scopedShopId || (hasSelectedShop && selectedAllowed ? selectedShopId : allowedFallbackShopId);

      setProducts(data.products || []);
      setSuppliers(data.suppliers || []);
      setCustomers(data.customers || []);
      setEmployees(data.employees || []);
      setTransactions(data.transactions || []);
      setPurchaseOrders(data.purchaseOrders || []);
      setStockLogs(data.stockLogs || []);
      setActivityLogs(data.activityLogs || []);
      setTaxConfig({ ...settings, activeShopId: effectiveShopId });
      setManualExpenses(data.manualExpenses || []);
      setSupplierPayments(data.supplierPayments || []);
      setQuotations(data.quotations || []);
      setCashShifts(data.cashShifts || []);
      setCustomerCreditPayments(data.customerCreditPayments || []);

      if (effectiveShopId && effectiveShopId !== selectedShopId) {
        setSelectedShopId(effectiveShopId);
        sessionStorage.setItem(SHOP_SESSION_KEY, effectiveShopId);
      }
    } catch (err) {
      console.error('Failed to sync state from backend database API:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Product CRUD
  const handleAddProduct = async (payload: Omit<Product, 'id'>) => {
    const res = await apiRequest('/api/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to add product');
    }
    await handleRefreshDb();
  };

  const handleEditProduct = async (id: string, payload: Partial<Product> & { reason?: string; user?: string }) => {
    const res = await apiRequest(`/api/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to modify product');
    }
    await handleRefreshDb();
  };

  const handleDeleteProduct = async (id: string) => {
    const res = await apiRequest(`/api/products/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to delete product');
    }
    await handleRefreshDb();
  };

  // Supplier Add
  const handleAddSupplier = async (payload: Omit<Supplier, 'id'>) => {
    const res = await apiRequest('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to register supplier');
    }
    await handleRefreshDb();
  };

  // Purchase REST Integration
  const handleCreatePO = async (payload: { supplierId: string; supplierName: string; items: any[]; orderUser: string }) => {
    const res = await apiRequest('/api/purchases', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to issue purchase request');
    }
    await handleRefreshDb();
  };

  const handleReceivePO = async (poId: string, receiveUser: string) => {
    const res = await apiRequest(`/api/purchases/${poId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'Received', receiveUser }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to acknowledge stock receipt checkout');
    }
    await handleRefreshDb();
  };

  // Customer Add
  const handleAddCustomer = async (payload: Omit<Customer, 'id' | 'purchaseCount'>) => {
    const res = await apiRequest('/api/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to register customer');
    }
    await handleRefreshDb();
  };

  const handleUpdateCustomer = async (
    customerId: string,
    details: Pick<Customer, 'name' | 'phone' | 'email' | 'address'>
  ) => {
    const res = await apiRequest(`/api/customers/${encodeURIComponent(customerId)}/profile`, {
      method: 'PUT',
      body: JSON.stringify(details),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Could not update customer details');
    }
    await handleRefreshDb();
  };

  // Employee Add
  const handleAddEmployee = async (payload: Omit<Employee, 'id' | 'performanceScore'>) => {
    const res = await apiRequest('/api/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to onboard employee');
    }
    await handleRefreshDb();
  };

  const handleAddSupplierPayment = async (payload: { supplierId: string; supplierName: string; purchaseOrderId?: string; amount: number; paymentMethod: string; date: string; note?: string }) => {
    const res = await apiRequest('/api/supplier-payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to record supplier payment');
    }
    await handleRefreshDb();
  };

  const handleSetCreditLimit = async (customerId: string, creditLimit: number) => {
    const res = await apiRequest(`/api/customers/${customerId}/credit`, {
      method: 'PUT',
      body: JSON.stringify({ creditLimit }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update customer credit limit');
    }
    await handleRefreshDb();
  };

  const handleAddCreditPayment = async (payload: { customerId: string; amount: number; paymentMethod: string; date: string; note?: string }) => {
    const res = await apiRequest(`/api/customers/${payload.customerId}/credit-payment`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to record customer payment');
    }
    await handleRefreshDb();
  };

  const handleOpenShift = async (openingFloat: number) => {
    const res = await apiRequest('/api/shifts/open', {
      method: 'POST',
      body: JSON.stringify({ openingFloat }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to open shift');
    }
    await handleRefreshDb();
  };

  const handleCloseShift = async (shiftId: string, closingCash: number, notes?: string) => {
    const res = await apiRequest(`/api/shifts/${shiftId}/close`, {
      method: 'POST',
      body: JSON.stringify({ closingCash, notes }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to close shift');
    }
    await handleRefreshDb();
  };

  const handleUpdateSettings = async (payload: StoreSettings) => {
    const res = await apiRequest('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to save settings');
    }
    const data = await res.json();
    setTaxConfig(data);
    await handleRefreshDb();
  };

  const handleAddManualExpense = async (payload: Omit<ManualExpense, 'id' | 'date'>) => {
    const res = await apiRequest('/api/manual-expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to log expense');
    }
    await handleRefreshDb();
  };

  const handleAddProductCategory = async (categoryName: string) => {
    const normalized = categoryName.trim();
    if (!normalized) {
      throw new Error('Category name is required');
    }

    const nextSettings: StoreSettings = {
      ...taxConfig,
      productCategories: Array.from(
        new Set([...(taxConfig.productCategories || []), normalized])
      ).sort((left, right) => left.localeCompare(right)),
    };

    const res = await apiRequest('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(nextSettings),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || err.error || 'Failed to add category');
    }
    const data = await res.json();
    setTaxConfig(data);
    await handleRefreshDb();
  };

  const handleShopSwitch = (shopId: string) => {
    if (authUser?.scopedShopId) {
      return;
    }
    if (authUser?.allowedShopIds && authUser.allowedShopIds.length > 0 && !authUser.allowedShopIds.includes(shopId)) {
      return;
    }
    setSelectedShopId(shopId);
    sessionStorage.setItem(SHOP_SESSION_KEY, shopId);
  };

  const openLoginResetModal = () => {
    setResetEmail(loginEmail);
    setResetCurrentPassword('');
    setResetNewPassword('');
    setResetConfirmPassword('');
    setShowResetCurrentPassword(false);
    setShowResetNewPassword(false);
    setShowResetConfirmPassword(false);
    setResetError('');
    setResetSuccess('');
    setIsResetModalOpen(true);
  };

  const handleLoginPasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setResetError('');
    setResetSuccess('');

    if (!resetEmail.trim()) {
      setResetError('Email is required');
      return;
    }

    if (!resetCurrentPassword || !resetNewPassword || !resetConfirmPassword) {
      setResetError('All password fields are required');
      return;
    }

    if (resetNewPassword.length < 12) {
      setResetError('New password must be at least 12 characters');
      return;
    }

    if (resetNewPassword !== resetConfirmPassword) {
      setResetError('New password and confirm password do not match');
      return;
    }

    setIsResetSubmitting(true);
    try {
      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, password: resetCurrentPassword }),
      });
      const loginData = await loginResponse.json();
      if (!loginResponse.ok) {
        throw new Error(loginData.error || 'Current password verification failed');
      }

      const updateResponse = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${loginData.token}`,
        },
        body: JSON.stringify({ currentPassword: resetCurrentPassword, newPassword: resetNewPassword }),
      });
      const updateData = await updateResponse.json();
      if (!updateResponse.ok) {
        throw new Error(updateData.error || 'Password reset failed');
      }

      setLoginEmail(resetEmail.trim());
      setLoginPassword('');
      setResetCurrentPassword('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      setResetSuccess('Password updated. Please sign in with your new password.');
    } catch (error: any) {
      setResetError(error.message || 'Password reset failed');
    } finally {
      setIsResetSubmitting(false);
    }
  };

  const openProfileModal = () => {
    if (!authUser) {
      return;
    }
    setProfileName(authUser.name || '');
    setProfileCurrentPassword('');
    setProfileNewPassword('');
    setProfileConfirmPassword('');
    setShowProfileCurrentPassword(false);
    setShowProfileNewPassword(false);
    setShowProfileConfirmPassword(false);
    setProfileError('');
    setProfileSuccess('');
    setIsProfileModalOpen(true);
  };

  const handleProfileSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!authUser) {
      return;
    }

    setProfileError('');
    setProfileSuccess('');

    const wantsPasswordChange = profileCurrentPassword.length > 0 || profileNewPassword.length > 0 || profileConfirmPassword.length > 0;
    if (wantsPasswordChange && profileNewPassword !== profileConfirmPassword) {
      setProfileError('New password and confirm password do not match');
      return;
    }

    setIsSavingProfile(true);
    try {
      const response = await apiRequest('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: profileName,
          currentPassword: profileCurrentPassword,
          newPassword: profileNewPassword,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update profile');
      }

      const updatedUser: AuthUser = data.user;
      const updatedToken: string = data.token;
      setAuthUser(updatedUser);
      setSessionToken(updatedToken);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: updatedToken, user: updatedUser }));
      setProfileCurrentPassword('');
      setProfileNewPassword('');
      setProfileConfirmPassword('');
      setProfileSuccess('Profile updated successfully');
    } catch (error: any) {
      setProfileError(error.message || 'Failed to update profile');
    } finally {
      setIsSavingProfile(false);
    }
  };

  if (!authUser && setupRequired) {
    const setupInputClass = 'mt-1.5 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-400/30';
    return (
      <div className="relative min-h-[100dvh] w-full overflow-y-auto bg-[#101d32] px-3 py-4 text-slate-900 sm:px-6 sm:py-6">
      <NotificationCenter />
        <div className="pointer-events-none fixed inset-0 bg-cover bg-center opacity-15" style={{ backgroundImage: `url(${loginBackgroundImage})` }} />
        <div className="relative mx-auto flex min-h-[calc(100dvh-2rem)] max-w-3xl items-center justify-center sm:min-h-[calc(100dvh-3rem)]">
          <form onSubmit={handleCreateAdmin} className="w-full rounded-[24px] border border-white/15 bg-white px-5 py-5 shadow-[0_24px_90px_rgba(0,0,0,0.25)] sm:px-8 sm:py-7">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <ARSBrand dark subtitle="Secure first-time setup" />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800">
                <ShieldCheck className="h-3.5 w-3.5" /> Owner registration
              </span>
            </div>
            <div className="pb-4 pt-4">
              <h1 className="font-heading text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Create your administrator account</h1>
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-500 sm:text-sm">
                Set up the first business owner account. Your credentials are securely stored in PostgreSQL.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <label htmlFor="ars-setup-name" className="block text-xs font-semibold text-slate-700">Full name
                <input id="ars-setup-name" value={setupName} onChange={(e) => setSetupName(e.target.value)} required minLength={2} maxLength={100} autoComplete="name" placeholder="Owner's full name" className={setupInputClass} />
              </label>
              <label htmlFor="ars-setup-email" className="block text-xs font-semibold text-slate-700">Email address
                <input id="ars-setup-email" type="email" value={setupEmail} onChange={(e) => setSetupEmail(e.target.value)} required autoComplete="username" placeholder="owner@company.com" className={setupInputClass} />
              </label>
              <label htmlFor="ars-setup-password" className="block text-xs font-semibold text-slate-700">Password
                <input id="ars-setup-password" type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" placeholder="At least 12 characters" className={setupInputClass} />
              </label>
              <label htmlFor="ars-setup-confirm" className="block text-xs font-semibold text-slate-700">Confirm password
                <input id="ars-setup-confirm" type="password" value={setupConfirmPassword} onChange={(e) => setSetupConfirmPassword(e.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" placeholder="Repeat your password" className={setupInputClass} />
              </label>
            </div>

            {setupError && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{setupError}</p>}
            <div className="mt-4 flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><LockKeyhole className="h-4 w-4 text-emerald-600" /> Setup closes after your first administrator is created.</p>
              <button disabled={isCreatingAdmin} type="submit" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#182a45] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#294264] disabled:opacity-50 sm:w-auto">
                {isCreatingAdmin ? 'Creating administrator...' : <>Create Administrator <ArrowUpRight className="h-4 w-4" /></>}
              </button>
            </div>
            <p className="mt-3 text-center text-[10px] tracking-wide text-slate-400 sm:text-right">Business software by RS Nextward</p>
          </form>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div
        className="relative min-h-[100dvh] w-full overflow-y-auto bg-[#101d32] text-white flex items-center justify-center p-3 sm:p-4"
      >
        <NotificationCenter />
        <div className="pointer-events-none absolute inset-0 opacity-30 bg-cover bg-center" style={{ backgroundImage: `url(${loginBackgroundImage})` }} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#101d32]/95 via-[#101d32]/85 to-[#243b5c]/90" />
        <div className="relative z-10 w-full max-w-6xl overflow-hidden rounded-[30px] border border-white/15 bg-white/5 shadow-[0_25px_100px_rgba(0,0,0,0.38)] lg:grid lg:grid-cols-[1.12fr_0.88fr]">
          <section className="hidden lg:flex flex-col justify-between gap-6 border-r border-white/10 p-7 xl:p-8 bg-gradient-to-br from-[#0b192e]/30 via-[#182e4d]/70 to-[#233854]/75">
            <div>
              <div className="inline-flex items-center gap-3">
                <ARSBrand featured subtitle="Imports • Wholesale • Distribution" className="ars-login-brand" />
              </div>
              <div className="mt-7 max-w-xl">
                <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.19em] text-amber-300"><Store className="h-3.5 w-3.5" /> Built for import and distribution</p>
                <h1 className="font-heading text-4xl font-bold tracking-tight leading-[1.12] xl:text-[44px]">Your business.<br/><span className="text-amber-300">One powerful</span><br/>workspace.</h1>
                <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">Manage international purchasing, warehouse inventory, wholesale distribution and financial reporting in one secure workspace.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-3 text-sm text-slate-300"><div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-amber-300" /><span>Secure staff access · PostgreSQL-backed</span></div><div className="text-right"><svg role="img" aria-label="RS Nextward" viewBox="0 0 158 28" className="ml-auto block h-7 w-[122px] text-white"><text x="157" y="17" textAnchor="end" fill="currentColor" fontFamily="Helvetica, Arial, sans-serif" fontSize="16" fontWeight="bold" fontStyle="italic">RS Nextward</text><path d="M91 24 Q121 16 158 20 Q123 18 91 25 Z" fill="currentColor" /></svg><span className="block text-[10px] text-slate-300">Smart systems for business.</span></div></div>
          </section>
          <div className="bg-white p-5 text-slate-900 sm:p-6 xl:p-8 flex flex-col justify-center">
            <div className="mb-4">
              <div className="mb-4 lg:hidden"><ARSBrand dark featured subtitle="Imports • Wholesale • Distribution" /></div>
              <h2 className="font-heading text-2xl font-bold tracking-tight">Welcome to ARS Distributor</h2>
              <p className="mt-2 text-sm text-slate-500">Sign in to your branch workspace.</p>
            </div>
            <form onSubmit={handleLogin} className="space-y-3">

          {setupStatus && <p role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">{setupStatus}</p>}

          <div className="space-y-2">
            <label htmlFor="ars-login-email" className="block text-xs font-semibold text-slate-700">Email address</label>
            <input
              id="ars-login-email"
              type="email"
              autoComplete="username"
              placeholder="name@yourcompany.com"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              className="w-full rounded-xl px-4 py-3 bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-500 transition"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="ars-login-password" className="block text-xs font-semibold text-slate-700">Password</label>
            <div className="relative">
              <input
                id="ars-login-password"
                type={showLoginPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full rounded-xl px-4 py-3 bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-500 pr-20 transition"
                required
              />
              <button
                type="button"
                onClick={() => setShowLoginPassword((current) => !current)}
                className="absolute inset-y-0 right-2 my-auto h-8 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-200"
              >
                {showLoginPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-xs font-semibold text-slate-800">Your branch is protected</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">Only branches assigned to your account are available.</p>
            </div>
          </div>

          {loginError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loginError}</p>}

          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 bg-[#182a45] text-white text-sm font-bold hover:bg-[#243c60] transition shadow-lg shadow-slate-950/10 disabled:opacity-60"
          >
            {isLoggingIn ? 'Signing in...' : <>Secure Sign In <ArrowUpRight className="h-4 w-4" /></>}
          </button>

          <button
            type="button"
            onClick={openLoginResetModal}
            className="w-full rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
          >
            Change Password
          </button>
          <button type="button" onClick={openForgotPassword} className="w-full rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">Forgot Password?</button>
            </form>
            <div className="mt-3 border-t border-slate-100 pt-3 flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5 text-emerald-600" /> Protected business access</span>
              <span>RS Nextward</span>
            </div>
          </div>
        </div>

        {isForgotModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onKeyDown={e => { if (e.key === 'Escape') setIsForgotModalOpen(false); }}>
            <section role="dialog" aria-modal="true" aria-labelledby="forgot-password-title" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 text-slate-800 shadow-2xl">
              <h3 id="forgot-password-title" className="text-xl font-bold">Recover your account</h3>
              <p className="mt-2 text-sm text-slate-600">Choose the recovery method for your account. Your business records remain intact.</p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl border p-3"><h4 className="font-bold">Staff account</h4><p className="mt-1">Contact your authorized System Administrator. They can reset your password in System Administration → User Management.</p></div>
                <div className="rounded-xl border p-3"><h4 className="font-bold">Owner or System Administrator</h4><p className="mt-1">For a local installation, use the protected local administrator recovery procedure on the host computer after verifying a backup. For hosted installations, contact the authorized system operator.</p></div>
                {recoveryEmailEnabled ? (
                  <form onSubmit={submitRecovery} className="space-y-3 rounded-xl border p-3">
                    <h4 className="font-bold">Email verification</h4>
                    {!recoveryDone && <>
                      <label className="block">Registered email<input type="email" required maxLength={254} disabled={recoveryRequested || recoveryBusy} value={recoveryEmail} onChange={e=>setRecoveryEmail(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
                      {recoveryRequested && <>
                        <label className="block">Six-digit verification code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={recoveryCode} onChange={e=>setRecoveryCode(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
                        <label className="block">New password<input required type="password" autoComplete="new-password" minLength={12} maxLength={72} value={recoveryPassword} onChange={e=>setRecoveryPassword(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
                        <label className="block">Confirm password<input required type="password" autoComplete="new-password" minLength={12} maxLength={72} value={recoveryConfirm} onChange={e=>setRecoveryConfirm(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
                      </>}
                      <button disabled={recoveryBusy} type="submit" className="w-full rounded-lg bg-slate-800 p-2 font-semibold text-white disabled:opacity-50">{recoveryBusy?'Processing…':recoveryRequested?'Reset Password':'Send Verification Code'}</button>
                    </>}
                    {recoveryRequested && !recoveryDone && <button type="button" disabled={recoveryBusy || recoveryNow < recoveryRetryAt} onClick={resendRecovery} className="w-full rounded-lg border p-2 text-xs font-semibold disabled:opacity-50">{recoveryNow < recoveryRetryAt ? 'Resend in '+Math.ceil((recoveryRetryAt-recoveryNow)/1000)+'s' : 'Resend Verification Code'}</button>}
                    {recoveryMessage && <p role="status" className="text-sm">{recoveryMessage}</p>}
                  </form>
                ) : <p className="text-xs text-slate-500">Email verification is not configured. Never share your password or database credentials.</p>}
              </div>
              <button autoFocus type="button" onClick={() => setIsForgotModalOpen(false)} className="mt-5 w-full rounded-xl bg-[#182a45] px-4 py-3 text-sm font-bold text-white">Back to Sign In</button>
            </section>
          </div>
        )}
        {isResetModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
            <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
              <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-100">Change Password</h3>
                <p className="text-xs text-slate-400">Verify current password and set a new one.</p>
              </div>

              <form className="space-y-3" onSubmit={handleLoginPasswordReset}>
                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Email</label>
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={(event) => setResetEmail(event.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Current Password</label>
                  <div className="relative">
                    <input
                      type={showResetCurrentPassword ? 'text' : 'password'}
                      value={resetCurrentPassword}
                      onChange={(event) => setResetCurrentPassword(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none pr-20"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetCurrentPassword((current) => !current)}
                      className="absolute inset-y-0 right-2 my-auto h-7 rounded-md border border-slate-700 bg-slate-700/70 px-2 text-[10px] font-semibold text-slate-200 hover:bg-slate-600"
                    >
                      {showResetCurrentPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-300">New Password</label>
                  <div className="relative">
                    <input
                      type={showResetNewPassword ? 'text' : 'password'}
                      value={resetNewPassword}
                      onChange={(event) => setResetNewPassword(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none pr-20"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetNewPassword((current) => !current)}
                      className="absolute inset-y-0 right-2 my-auto h-7 rounded-md border border-slate-700 bg-slate-700/70 px-2 text-[10px] font-semibold text-slate-200 hover:bg-slate-600"
                    >
                      {showResetNewPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-300">Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={showResetConfirmPassword ? 'text' : 'password'}
                      value={resetConfirmPassword}
                      onChange={(event) => setResetConfirmPassword(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none pr-20"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetConfirmPassword((current) => !current)}
                      className="absolute inset-y-0 right-2 my-auto h-7 rounded-md border border-slate-700 bg-slate-700/70 px-2 text-[10px] font-semibold text-slate-200 hover:bg-slate-600"
                    >
                      {showResetConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                {resetError && <p className="text-xs text-rose-400">{resetError}</p>}
                {resetSuccess && <p className="text-xs text-emerald-400">{resetSuccess}</p>}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsResetModalOpen(false)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={isResetSubmitting}
                    className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-60"
                  >
                    {isResetSubmitting ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  const currentRole: Role = authUser.role;
  const currentUser = authUser.name;
  const visibleShopProfiles = (taxConfig.shopProfiles || []).filter((shop) => {
    if (!authUser.allowedShopIds || authUser.allowedShopIds.length === 0) {
      return true;
    }
    return authUser.allowedShopIds.includes(shop.id);
  });

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-[#f3f6fb] text-slate-800 antialiased font-sans overflow-hidden relative">
      <NotificationCenter />
      {/* Mobile Header Bar */}
      <header className="md:hidden h-16 bg-[#101d32] text-white flex items-center justify-between px-4 border-b border-white/10 shrink-0 z-40 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-200 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-heading font-medium text-sm tracking-tight text-slate-100">
            {taxConfig.storeName}
          </span>
        </div>
        <div className="text-[9px] uppercase font-mono tracking-wider text-indigo-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
          {currentRole}
        </div>
      </header>

      {/* Mobile Sidebar Drawer Backdrop Overlay */}
      {isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-40 md:hidden"
        />
      )}

      {/* Dynamic Siderail Navigation bar container with mobile sliding drawer capability */}
      <div className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 md:relative md:transform-none md:z-auto ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          currentRole={currentRole}
          currentUser={currentUser}
          activeShopId={authUser.scopedShopId || selectedShopId || taxConfig.activeShopId || ''}
          shopProfiles={visibleShopProfiles}
          isShopLocked={Boolean(authUser.scopedShopId)}
          onOpenProfile={openProfileModal}
          onSwitchShop={handleShopSwitch}
          onLogout={handleLogout}
          onClose={() => setIsSidebarOpen(false)}
        />
      </div>

      {/* Primary Inner Main Area Scroll view wrapper */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-[#f3f6fb]">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" aria-label={isSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                aria-expanded={!isSidebarCollapsed}
                title={isSidebarCollapsed ? 'Show navigation sidebar' : 'Hide navigation sidebar'}
                onClick={() => {
                  setIsSidebarCollapsed((value) => {
                    localStorage.setItem('ars_sidebar_collapsed', String(!value));
                    return !value;
                  });
                }}
                className="hidden md:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-amber-50 hover:border-amber-300 focus-visible:outline-2 focus-visible:outline-amber-400">
                {isSidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
              </button>
              <div className="min-w-0">
              <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">ARS Distributor · Business workspace</p>
              <p className="truncate font-heading text-lg font-bold text-slate-900 sm:text-xl">{({
                dashboard: 'Business Overview', pos: 'Wholesale Billing', products: 'Product Catalog',
                inventory: 'Stock Management', purchases: 'Suppliers & Purchasing', imports: 'Import Landed Costs', shipments: 'Import Shipments', 'warehouse-receiving': 'Warehouse Receiving', partners: 'Partner Capital',
                customers: 'Customer Management', staff: 'Staff Management', reports: 'Reports & Analytics',
                quotations: 'Quotations', shifts: 'Cash Shifts', 
                accounting: 'Accounting', 'company-profile': 'Company Profile', 'backup-recovery': 'Backup & Recovery', 'db-admin': 'System Administration', calculators: 'Calculators',
              } as Record<AppTab, string>)[activeTab]}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600"><Store className="h-4 w-4 text-amber-600" /> <span className="max-w-[170px] truncate">{taxConfig.storeName}</span></span>
              {(['Super Admin', 'Store Manager', 'Cashier'] as Role[]).includes(currentRole) && (
                <button type="button" onClick={() => setActiveTab('pos')} className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-3 py-2.5 text-xs font-bold text-slate-900 hover:bg-amber-300 transition shadow-sm">
                  <Bolt className="h-4 w-4" /> <span className="hidden sm:inline">New Invoice</span><span className="sm:hidden">Invoice</span>
                </button>
              )}
            </div>
          </div>
        </header>
        <div className="p-4 sm:p-6 lg:p-8">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <div className="h-9 w-9 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-mono text-slate-400 animate-pulse uppercase tracking-widest">
              Hydrating warehouse records...
            </p>
          </div>
        ) : (
          <div className="max-w-[1500px] mx-auto">
            <Suspense
              fallback={
                <div className="flex min-h-[24rem] flex-col items-center justify-center space-y-4 rounded-3xl border border-slate-200 bg-white/70">
                  <div className="h-9 w-9 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs font-mono uppercase tracking-widest text-slate-400">Loading workspace...</p>
                </div>
              }
            >
              {activeTab === 'dashboard' && (
                <DashboardView
                  products={products}
                  transactions={transactions}
                  customers={customers}
                  suppliers={suppliers}
                  employees={employees}
                  activityLogs={activityLogs}
                  taxConfig={taxConfig}
                  onNavigateToTab={(tab) => setActiveTab(tab as AppTab)}
                />
              )}

              {activeTab === 'pos' && (
                <POSView
                  key={`${authUser.email}:${taxConfig.activeShopId || selectedShopId}`}
                  draftOwner={authUser.email}
                  products={products}
                  customers={customers}
                  employees={employees}
                  cashierName={currentUser}
                  currentRole={currentRole}
                  taxConfig={taxConfig}
                  onRefreshDb={handleRefreshDb}
                  authToken={sessionToken}
                />
              )}

              {activeTab === 'products' && (
                <ProductManagementView
                  products={products}
                  currentRole={currentRole}
                  taxConfig={taxConfig}
                  authToken={sessionToken}
                  onAddProduct={handleAddProduct}
                  onEditProduct={handleEditProduct}
                  onDeleteProduct={handleDeleteProduct}
                  onAddCategory={handleAddProductCategory}
                />
              )}

              {activeTab === 'inventory' && (
                <InventoryView
                  taxConfig={taxConfig}
                  products={products}
                  stockLogs={stockLogs}
                  currentRole={currentRole}
                  currentUser={currentUser}
                  onEditProduct={handleEditProduct}
                />
              )}

              {activeTab === 'purchases' && (
                <SupplierPurchaseView
                  suppliers={suppliers}
                  purchaseOrders={purchaseOrders}
                  supplierPayments={supplierPayments}
                  products={products}
                  currentRole={currentRole}
                  currentUser={currentUser}
                  taxConfig={taxConfig}
                  onAddSupplier={handleAddSupplier}
                  onCreatePO={handleCreatePO}
                  onReceivePO={handleReceivePO}
                  onAddSupplierPayment={handleAddSupplierPayment}
                />
              )}

              {activeTab === 'imports' && ['Super Admin', 'Store Manager'].includes(currentRole) && (
                <ImportCostPlanner />
              )}

              {(activeTab === 'shipments' || activeTab === 'warehouse-receiving') &&
                ['Super Admin','Store Manager','Inventory Staff'].includes(currentRole) && (
                  <ImportShipmentView
                  taxConfig={taxConfig}
                    mode={activeTab === 'shipments' ? 'shipments' : 'receiving'}
                    authToken={sessionToken}
                    shopId={authUser.scopedShopId || selectedShopId || taxConfig.activeShopId || 'shop-main'}
                    currentRole={currentRole}
                    purchaseOrders={purchaseOrders}
                    onRefreshDb={handleRefreshDb}
                  />
              )}

              {activeTab === 'partners' && currentRole === 'Super Admin' && (
                <PartnerCapitalView taxConfig={taxConfig} authToken={sessionToken}
                  shopId={authUser.scopedShopId || selectedShopId || taxConfig.activeShopId || 'shop-main'} />
              )}

              {(activeTab === 'customers' || activeTab === 'staff') && (
                <CustomerEmployeeView
                  taxConfig={taxConfig}
                  key={activeTab}
                  viewMode={activeTab === 'customers' ? 'customers' : 'employees'}
                  customers={customers}
                  employees={employees}
                  customerCreditPayments={customerCreditPayments}
                  transactions={transactions}
                  currentRole={currentRole}
                  onAddCustomer={handleAddCustomer}
                  onUpdateCustomer={handleUpdateCustomer}
                  onAddEmployee={handleAddEmployee}
                  onSetCreditLimit={handleSetCreditLimit}
                  onAddCreditPayment={handleAddCreditPayment}
                />
              )}

              {activeTab === 'reports' && (
                <ReportsView
                  taxConfig={taxConfig}
                  transactions={transactions}
                  products={products}
                  manualExpenses={manualExpenses}
                  authToken={sessionToken}
                />
              )}

              {activeTab === 'quotations' && (
                <QuotationView
                  initialDraft={estimateDraft}
                  onDraftOpened={() => setEstimateDraft(null)}
                  products={products}
                  customers={customers}
                  employees={employees}
                  quotations={quotations}
                  taxConfig={taxConfig}
                  cashierName={currentUser}
                  authToken={sessionToken}
                  onRefreshDb={handleRefreshDb}
                />
              )}

              {activeTab === 'shifts' && (
                <CashDrawerView
                  taxConfig={taxConfig}
                  cashShifts={cashShifts}
                  transactions={transactions}
                  authToken={sessionToken}
                  onRefreshDb={handleRefreshDb}
                />
              )}

              {(activeTab === 'accounting' || activeTab === 'company-profile') && (
                <AccountingSettingsView
                  key={activeTab}
                  initialView={activeTab === 'company-profile' ? 'settings' : 'accounting'}
                  transactions={transactions}
                  purchaseOrders={purchaseOrders}
                  currentRole={currentRole}
                  taxConfig={taxConfig}
                  manualExpenses={manualExpenses}
                  authToken={sessionToken}
                  onUpdateTaxConfig={handleUpdateSettings}
                  onAddManualExpense={handleAddManualExpense}
                />
              )}

              {activeTab === 'backup-recovery' && currentRole === 'Super Admin' && (
                <BackupRecoveryView authToken={sessionToken} />
              )}

              {activeTab === 'calculators' && (
                <CalculatorsView
                  onQuote={['Super Admin', 'Store Manager', 'Cashier'].includes(currentRole) ? draft => {
                    setEstimateDraft(draft);
                    setActiveTab('quotations');
                  } : undefined}
                  products={products}
                  taxConfig={taxConfig}
                />
              )}

              {activeTab === 'db-admin' && (
                <DBAdminView
                  shopId={authUser.scopedShopId || selectedShopId || taxConfig.activeShopId || ''}
                  shopName={arsDisplayName(taxConfig.shopProfiles?.find(shop => shop.id === (authUser.scopedShopId || selectedShopId || taxConfig.activeShopId))?.name || taxConfig.storeName)}
                  onSamplesAdded={handleRefreshDb}
                  authToken={sessionToken}
                />
              )}
            </Suspense>
          </div>
        )}
        </div>
      </main>

      {isProfileModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-100">Profile Management</h3>
              <p className="text-xs text-slate-400">Update your display name or change your password.</p>
            </div>

            <form className="space-y-3" onSubmit={handleProfileSave}>
              <div className="space-y-1">
                <label className="text-xs text-slate-300">Display Name</label>
                <input
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300">Current Password</label>
                  <div className="relative">
                    <input
                      type={showProfileCurrentPassword ? 'text' : 'password'}
                      value={profileCurrentPassword}
                      onChange={(event) => setProfileCurrentPassword(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none pr-20"
                      placeholder="Required only for password change"
                    />
                    <button
                      type="button"
                      onClick={() => setShowProfileCurrentPassword((current) => !current)}
                      className="absolute inset-y-0 right-2 my-auto h-7 rounded-md border border-slate-700 bg-slate-700/70 px-2 text-[10px] font-semibold text-slate-200 hover:bg-slate-600"
                    >
                      {showProfileCurrentPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300">New Password</label>
                  <div className="relative">
                    <input
                      type={showProfileNewPassword ? 'text' : 'password'}
                      value={profileNewPassword}
                      onChange={(event) => setProfileNewPassword(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none pr-20"
                      placeholder="Minimum 12 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowProfileNewPassword((current) => !current)}
                      className="absolute inset-y-0 right-2 my-auto h-7 rounded-md border border-slate-700 bg-slate-700/70 px-2 text-[10px] font-semibold text-slate-200 hover:bg-slate-600"
                    >
                      {showProfileNewPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-300">Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={showProfileConfirmPassword ? 'text' : 'password'}
                      value={profileConfirmPassword}
                      onChange={(event) => setProfileConfirmPassword(event.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none pr-20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowProfileConfirmPassword((current) => !current)}
                      className="absolute inset-y-0 right-2 my-auto h-7 rounded-md border border-slate-700 bg-slate-700/70 px-2 text-[10px] font-semibold text-slate-200 hover:bg-slate-600"
                    >
                      {showProfileConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
              </div>

              {profileError && <p className="text-xs text-rose-400">{profileError}</p>}
              {profileSuccess && <p className="text-xs text-emerald-400">{profileSuccess}</p>}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsProfileModalOpen(false)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-60"
                >
                  {isSavingProfile ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


    </div>
  );
}
