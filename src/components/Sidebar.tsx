import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  History,
  Truck,
  Users2,
  Sparkles,
  Settings2,
  Lock,
  Bolt,
  User,
  LogOut,
  Database,
  FileBarChart2,
  FileText,
  Timer,
  Calculator,
  X,
} from 'lucide-react';
import { Role } from '../types';

interface SidebarProps {
  activeTab: 'dashboard' | 'pos' | 'products' | 'inventory' | 'purchases' | 'relationships' | 'reports' | 'quotations' | 'shifts' | 'ai-insights' | 'accounting' | 'db-admin' | 'calculators';
  setActiveTab: (tab: 'dashboard' | 'pos' | 'products' | 'inventory' | 'purchases' | 'relationships' | 'reports' | 'quotations' | 'shifts' | 'ai-insights' | 'accounting' | 'db-admin' | 'calculators') => void;
  currentRole: Role;
  currentUser: string;
  activeShopId: string;
  shopProfiles: Array<{ id: string; name: string }>;
  isShopLocked?: boolean;
  onOpenProfile: () => void;
  onSwitchShop: (shopId: string) => void;
  onLogout: () => void;
  onClose?: () => void;
}

type NavItem = {
  id: SidebarProps['activeTab'];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
};

export default function Sidebar({
  activeTab,
  setActiveTab,
  currentRole,
  currentUser,
  activeShopId,
  shopProfiles,
  isShopLocked = false,
  onOpenProfile,
  onSwitchShop,
  onLogout,
  onClose,
}: SidebarProps) {
  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['Super Admin', 'Store Manager', 'Cashier', 'Inventory Staff'] },
    { id: 'pos', label: 'POS Billing', icon: ShoppingCart, roles: ['Super Admin', 'Store Manager', 'Cashier'] },
    { id: 'products', label: 'Product Catalog', icon: Package, roles: ['Super Admin', 'Store Manager', 'Inventory Staff'] },
    { id: 'inventory', label: 'Stock Ledger', icon: History, roles: ['Super Admin', 'Store Manager', 'Inventory Staff'] },
    { id: 'purchases', label: 'Suppliers & PO', icon: Truck, roles: ['Super Admin', 'Store Manager', 'Inventory Staff'] },
    { id: 'relationships', label: 'Customers & Staff', icon: Users2, roles: ['Super Admin', 'Store Manager', 'Cashier'] },
    { id: 'reports', label: 'Reports', icon: FileBarChart2, roles: ['Super Admin', 'Store Manager', 'Cashier'] },
    { id: 'quotations', label: 'Quotations', icon: FileText, roles: ['Super Admin', 'Store Manager', 'Cashier'] },
    { id: 'shifts', label: 'Cash Shifts', icon: Timer, roles: ['Super Admin', 'Store Manager', 'Cashier'] },
    { id: 'calculators', label: 'Calculators Hub', icon: Calculator, roles: ['Super Admin', 'Store Manager', 'Cashier', 'Inventory Staff'] },
    { id: 'ai-insights', label: 'Smart AI Insights', icon: Sparkles, roles: ['Super Admin', 'Store Manager', 'Cashier', 'Inventory Staff'] },
    { id: 'accounting', label: 'Accounting', icon: Settings2, roles: ['Super Admin', 'Store Manager'] },
    { id: 'db-admin', label: 'System Administration', icon: Database, roles: ['Super Admin'] },
  ];

  return (
    <div id="sidebar-container" className="w-68 bg-slate-900 text-white h-screen flex flex-col justify-between border-r border-slate-800 shrink-0">
      {/* Brand Header */}
      <div className="p-6 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-lg text-white font-black shadow-md shadow-indigo-500/20">
            <Bolt className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-heading font-medium text-lg tracking-tight leading-none text-slate-100">
              SMART POS
            </h1>
            <p className="text-[10px] uppercase font-mono tracking-wider text-indigo-400 mt-1">
              Sleek Hardware POS
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto min-h-0 scrollbar-thin">
        {navItems.map((item) => {
          const Icon = item.icon;
          const hasAccess = item.roles.includes(currentRole);
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              id={`nav-btn-${item.id}`}
              disabled={!hasAccess}
              onClick={() => {
                setActiveTab(item.id);
                onClose?.();
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium transition-all duration-250 ${
                isActive
                  ? 'bg-white/5 text-white border-l-4 border-indigo-500 rounded-r-lg rounded-l-none pl-2.5'
                  : hasAccess
                  ? 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-100 rounded-lg'
                  : 'text-slate-600 cursor-not-allowed opacity-42'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {!hasAccess && <Lock className="w-3 h-3 text-slate-700" />}
            </button>
          );
        })}
      </nav>

      {/* Role Switcher & Operator Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40">
        <div className="mb-3">
          <label className="mb-1 block text-[10px] uppercase tracking-wider font-mono text-slate-500">
            Active Shop
          </label>
          <select
            value={activeShopId}
            onChange={(e) => onSwitchShop(e.target.value)}
            disabled={isShopLocked}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
          >
            {(shopProfiles || []).map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </select>
          {isShopLocked && (
            <p className="mt-1 text-[10px] font-mono text-slate-500">Locked by login shop scope</p>
          )}
        </div>

        <div className="mb-4 text-[10px] uppercase tracking-wider font-mono text-slate-500 flex items-center gap-1.5">
          <User className="w-3 h-3 text-slate-500" /> Signed in operator
        </div>

        <div className="flex items-center gap-2.5 py-2 px-1">
          <div className="relative h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-indigo-400 border border-slate-700">
            {currentUser.split(' ').map(n=>n[0]).join('')}
            <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-slate-950"></span>
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-xs font-semibold text-slate-200 truncate">{currentUser}</p>
            <p className="text-[10px] font-mono text-slate-400 truncate">{currentRole}</p>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 font-mono">
          <span>Terminal Online</span>
          <span className="flex items-center gap-1 text-[10px] text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            ACTIVE
          </span>
        </div>

        <button
          onClick={onOpenProfile}
          className="w-full mt-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-slate-100 flex items-center justify-center gap-1.5"
        >
          <User className="w-3.5 h-3.5" /> Profile
        </button>

        <button
          onClick={onLogout}
          className="w-full mt-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-slate-100 flex items-center justify-center gap-1.5"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
    </div>
  );
}
