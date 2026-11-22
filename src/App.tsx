import React, { Suspense, lazy, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import ARSBrand from './components/ARSBrand';
import loginBackgroundImage from './assets/login-hardware-bg.svg';
import { Sparkles, MessageSquare, X, Send, Menu, ShieldCheck, Store, ArrowUpRight, LockKeyhole, Bolt } from 'lucide-react';
const DashboardView = lazy(() => import('./components/DashboardView'));
const POSView = lazy(() => import('./components/POSView'));
const ProductManagementView = lazy(() => import('./components/ProductManagementView'));
const InventoryView = lazy(() => import('./components/InventoryView'));
const SupplierPurchaseView = lazy(() => import('./components/SupplierPurchaseView'));
const CustomerEmployeeView = lazy(() => import('./components/CustomerEmployeeView'));
const AIRecommendationsView = lazy(() => import('./components/AIRecommendationsView'));
const AccountingSettingsView = lazy(() => import('./components/AccountingSettingsView'));
const DBAdminView = lazy(() => import('./components/DBAdminView'));
const ReportsView = lazy(() => import('./components/ReportsView'));
const QuotationView = lazy(() => import('./components/QuotationView'));
const CashDrawerView = lazy(() => import('./components/CashDrawerView'));
const CalculatorsView = lazy(() => import('./components/CalculatorsView'));

import { Product, Supplier, Customer, Employee, SalesTransaction, PurchaseOrder, StockLog, ActivityLog, Role, StoreSettings, ManualExpense, AuthUser, SupplierPayment, Quotation, CashShift, CustomerCreditPayment } from './types';

type AppTab = 'dashboard' | 'pos' | 'products' | 'inventory' | 'purchases' | 'relationships' | 'reports' | 'quotations' | 'shifts' | 'ai-insights' | 'accounting' | 'db-admin' | 'calculators';
const SESSION_KEY = 'hardware_shop_session';
const SHOP_SESSION_KEY = 'hardware_shop_active_shop';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
    storeName: 'Lanka Smart Hardware',
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
        name: 'Lanka Smart Hardware',
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

  // Floating AI Chat Assistant States
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'model'; content: string }>>([
    { role: 'model', content: 'Hello! I am your Lanka Smart Hardware AI Assistant. How can I help you today with stock forecasting, builders\' estimates, or operations?' }
  ]);
  const [isChatSending, setIsChatSending] = useState(false);

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || isChatSending) return;

    const userMsg = chatMessage.trim();
    setChatMessage('');
    const newHistory = [...chatHistory, { role: 'user', content: userMsg }];
    setChatHistory(newHistory);
    setIsChatSending(true);

    try {
      const response = await apiRequest('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: userMsg,
          history: newHistory
        })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setChatHistory([...newHistory, { role: 'model', content: data.response }]);
      } else {
        setChatHistory([...newHistory, { role: 'model', content: `Error: ${data.error || 'Failed to generate response'}` }]);
      }
    } catch (err: any) {
      setChatHistory([...newHistory, { role: 'model', content: `Error: ${err.message || 'Network error occurred'}` }]);
    } finally {
      setIsChatSending(false);
    }
  };

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
    return (
      <div className="min-h-screen bg-[#101d32] p-4 sm:p-8 flex items-center justify-center text-slate-900 relative overflow-y-auto">
        <div className="absolute inset-0 opacity-20 bg-cover bg-center pointer-events-none" style={{ backgroundImage: `url(${loginBackgroundImage})` }} />
        <form onSubmit={handleCreateAdmin} className="relative w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-7 sm:p-10 shadow-2xl space-y-5">
          <div className="mb-8"><ARSBrand dark subtitle="First-time business setup" /></div>
          <h1 className="font-heading text-3xl tracking-tight font-bold">Create your administrator account</h1>
          <p className="text-sm leading-relaxed text-slate-600">Set up secure owner access. Employee accounts are managed in PostgreSQL, not in configuration files. This form becomes unavailable when the first account is created.</p>
          <label className="block text-sm">Full name
            <input value={setupName} onChange={(e) => setSetupName(e.target.value)} required minLength={2} maxLength={100} autoComplete="name" className="mt-1.5 w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-500" />
          </label>
          <label className="block text-sm">Email address
            <input type="email" value={setupEmail} onChange={(e) => setSetupEmail(e.target.value)} required autoComplete="username" className="mt-1.5 w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-500" />
          </label>
          <label className="block text-sm">Password (12 characters minimum)
            <input type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" className="mt-1.5 w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-500" />
          </label>
          <label className="block text-sm">Confirm password
            <input type="password" value={setupConfirmPassword} onChange={(e) => setSetupConfirmPassword(e.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" className="mt-1.5 w-full rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-500" />
          </label>
          {setupError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{setupError}</p>}
          <button disabled={isCreatingAdmin} type="submit" className="w-full rounded-xl bg-[#182a45] hover:bg-[#294264] px-4 py-3.5 font-semibold text-white transition disabled:opacity-50">
            {isCreatingAdmin ? 'Creating administrator...' : 'Create Administrator'}
          </button>
        </form>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div
        className="relative min-h-[100dvh] w-full overflow-y-auto bg-[#101d32] text-white flex items-center justify-center p-3 sm:p-6 lg:p-7"
      >
        <div className="pointer-events-none absolute inset-0 opacity-30 bg-cover bg-center" style={{ backgroundImage: `url(${loginBackgroundImage})` }} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#101d32]/95 via-[#101d32]/85 to-[#243b5c]/90" />
        <div className="relative z-10 w-full max-w-6xl overflow-hidden rounded-[30px] border border-white/15 bg-white/5 shadow-[0_25px_100px_rgba(0,0,0,0.38)] lg:grid lg:grid-cols-[1.12fr_0.88fr]">
          <section className="hidden lg:flex flex-col justify-between min-h-[560px] border-r border-white/10 p-9 xl:p-12 bg-gradient-to-br from-[#0b192e]/30 via-[#182e4d]/70 to-[#233854]/75">
            <div>
              <div className="inline-flex items-center gap-3">
                <ARSBrand featured subtitle="Hardware • Wholesale • Retail" className="ars-login-brand" />
              </div>
              <div className="mt-14 max-w-xl">
                <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.19em] text-amber-300"><Store className="h-3.5 w-3.5" /> Built for hardware commerce</p>
                <h1 className="font-heading text-5xl font-bold tracking-tight leading-[1.14] xl:text-[56px]">Your business.<br/><span className="text-amber-300">One powerful</span><br/>workspace.</h1>
                <p className="mt-6 max-w-md text-[15px] leading-7 text-slate-300">Manage counter sales, inventory, purchasing and financial reporting from one organized, secure platform.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 border-t border-white/15 pt-5 text-sm text-slate-300"><ShieldCheck className="h-5 w-5 text-amber-300" /><span>Secure staff access · PostgreSQL-backed</span></div>
          </section>
          <div className="bg-white p-6 text-slate-900 sm:p-8 lg:p-9 xl:p-11 flex flex-col justify-center">
            <div className="mb-6">
              <div className="mb-6 lg:hidden"><ARSBrand dark featured subtitle="Hardware • Wholesale • Retail" /></div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Welcome back</p>
              <h2 className="mt-2 font-heading text-3xl font-bold tracking-tight">Welcome to ARS Hardware</h2>
              <p className="mt-3 text-sm text-slate-500">Sign in securely. Your authorized branch will load after verification.</p>
            </div>
            <form onSubmit={handleLogin} className="space-y-4">

          {setupStatus && <p role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">{setupStatus}</p>}

          <div className="space-y-2">
            <label htmlFor="ars-login-email" className="mb-2 block text-xs font-semibold text-slate-700">Email address</label>
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
            <label htmlFor="ars-login-password" className="mb-2 block text-xs font-semibold text-slate-700">Password</label>
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
              <p className="mt-1 text-xs leading-relaxed text-slate-500">Sign in first. You'll only see branches assigned to your account.</p>
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
            </form>
            <div className="mt-5 border-t border-slate-100 pt-4 flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5 text-emerald-600" /> Protected business access</span>
              <span>RS Nextward</span>
            </div>
          </div>
        </div>

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
      <div className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 md:relative md:transform-none md:z-auto ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
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
            <div className="min-w-0">
              <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">ARS Hardware · Business workspace</p>
              <p className="truncate font-heading text-lg font-bold text-slate-900 sm:text-xl">{({
                dashboard: 'Business Overview', pos: 'Point of Sale', products: 'Product Catalog',
                inventory: 'Stock Management', purchases: 'Suppliers & Purchasing',
                relationships: 'Customers & Staff', reports: 'Reports & Analytics',
                quotations: 'Quotations', shifts: 'Cash Shifts', 'ai-insights': 'AI Insights',
                accounting: 'Accounting', 'db-admin': 'System Administration', calculators: 'Calculators',
              } as Record<AppTab, string>)[activeTab]}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600"><Store className="h-4 w-4 text-amber-600" /> <span className="max-w-[170px] truncate">{taxConfig.storeName}</span></span>
              {(['Super Admin', 'Store Manager', 'Cashier'] as Role[]).includes(currentRole) && (
                <button type="button" onClick={() => setActiveTab('pos')} className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-3 py-2.5 text-xs font-bold text-slate-900 hover:bg-amber-300 transition shadow-sm">
                  <Bolt className="h-4 w-4" /> <span className="hidden sm:inline">New Sale</span><span className="sm:hidden">Sale</span>
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
                  products={products}
                  customers={customers}
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

              {activeTab === 'relationships' && (
                <CustomerEmployeeView
                  customers={customers}
                  employees={employees}
                  customerCreditPayments={customerCreditPayments}
                  currentRole={currentRole}
                  onAddCustomer={handleAddCustomer}
                  onAddEmployee={handleAddEmployee}
                  onSetCreditLimit={handleSetCreditLimit}
                  onAddCreditPayment={handleAddCreditPayment}
                />
              )}

              {activeTab === 'reports' && (
                <ReportsView
                  transactions={transactions}
                  products={products}
                  manualExpenses={manualExpenses}
                  authToken={sessionToken}
                />
              )}

              {activeTab === 'quotations' && (
                <QuotationView
                  products={products}
                  customers={customers}
                  quotations={quotations}
                  taxConfig={taxConfig}
                  cashierName={currentUser}
                  authToken={sessionToken}
                  onRefreshDb={handleRefreshDb}
                />
              )}

              {activeTab === 'shifts' && (
                <CashDrawerView
                  cashShifts={cashShifts}
                  transactions={transactions}
                  authToken={sessionToken}
                  onRefreshDb={handleRefreshDb}
                />
              )}

              {activeTab === 'ai-insights' && (
                <AIRecommendationsView
                  products={products}
                  suppliers={suppliers}
                  currentUser={currentUser}
                  onRefreshDb={handleRefreshDb}
                  onNavigateToTab={(tab) => setActiveTab(tab as AppTab)}
                  authToken={sessionToken}
                />
              )}

              {activeTab === 'accounting' && (
                <AccountingSettingsView
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

              {activeTab === 'calculators' && (
                <CalculatorsView
                  products={products}
                  taxConfig={taxConfig}
                />
              )}

              {activeTab === 'db-admin' && (
                <DBAdminView
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
                      placeholder="Minimum 8 characters"
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

      {/* Floating AI Chat Assistant Bubble & Drawer */}
      {authUser && (
        <>
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="fixed bottom-6 right-6 z-50 p-4 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-xl text-white transition-all transform hover:scale-105 flex items-center justify-center border border-indigo-500/20"
          >
            {isChatOpen ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6 animate-pulse" />}
          </button>

          {isChatOpen && (
            <div className="fixed bottom-24 right-6 w-96 h-[500px] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden text-slate-100 animate-in slide-in-from-bottom duration-250">
              {/* Header */}
              <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-600/10 rounded text-indigo-400 animate-bounce">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">AI Assistant</h3>
                    <p className="text-[10px] text-slate-400">Powered by Gemini AI Model</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsChatOpen(false)}
                  className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 font-sans text-xs">
                {chatHistory.map((chat, idx) => (
                  <div
                    key={idx}
                    className={`flex ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-3 py-2 leading-relaxed ${
                        chat.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-br-none shadow-md shadow-indigo-600/10'
                          : 'bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700/50'
                      }`}
                      style={{ whiteSpace: 'pre-line' }}
                    >
                      {chat.content}
                    </div>
                  </div>
                ))}
                {isChatSending && (
                  <div className="flex justify-start">
                    <div className="bg-slate-800 text-slate-400 rounded-xl rounded-bl-none border border-slate-700/50 px-3 py-2 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                      <span className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                      <span className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                    </div>
                  </div>
                )}
              </div>

              {/* Input Area */}
              <form onSubmit={handleSendChatMessage} className="p-3 bg-slate-950 border-t border-slate-800 flex gap-2">
                <input
                  type="text"
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  placeholder="Ask a question or calculate cement..."
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  disabled={isChatSending}
                />
                <button
                  type="submit"
                  disabled={isChatSending || !chatMessage.trim()}
                  className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:hover:bg-indigo-600 flex items-center justify-center transition"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
