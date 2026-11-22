import React from 'react';
import {
  LayoutDashboard, ShoppingCart, Package, History, Truck, Users2, Sparkles,
  Settings2, Bolt, UserRound, LogOut, ShieldCheck, FileBarChart2, FileText,
  Timer, Calculator, X, ChevronDown, Store, ArrowUpRight, Layers3
} from 'lucide-react';
import { Role } from '../types';

type Tab = 'dashboard' | 'pos' | 'products' | 'inventory' | 'purchases' | 'relationships' | 'reports' | 'quotations' | 'shifts' | 'ai-insights' | 'accounting' | 'db-admin' | 'calculators';
interface SidebarProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
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
  id: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  description?: string;
};
const ALL_ROLES: Role[] = ['Super Admin', 'Store Manager', 'Cashier', 'Inventory Staff'];
const SALES_ROLES: Role[] = ['Super Admin', 'Store Manager', 'Cashier'];
const STOCK_ROLES: Role[] = ['Super Admin', 'Store Manager', 'Inventory Staff'];
const MANAGERS: Role[] = ['Super Admin', 'Store Manager'];
const groups: Array<{ title: string; items: NavItem[] }> = [
  { title: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ALL_ROLES },
  ] },
  { title: 'Sales & billing', items: [
    { id: 'pos', label: 'New Sale / POS', icon: ShoppingCart, roles: SALES_ROLES },
    { id: 'quotations', label: 'Quotations', icon: FileText, roles: SALES_ROLES },
    { id: 'shifts', label: 'Cash Shifts', icon: Timer, roles: SALES_ROLES },
  ] },
  { title: 'Inventory & purchasing', items: [
    { id: 'products', label: 'Product Catalog', icon: Package, roles: STOCK_ROLES },
    { id: 'inventory', label: 'Stock Management', icon: Layers3, roles: STOCK_ROLES },
    { id: 'purchases', label: 'Suppliers & Purchasing', icon: Truck, roles: STOCK_ROLES },
  ] },
  { title: 'Business management', items: [
    { id: 'relationships', label: 'Customers & Staff', icon: Users2, roles: SALES_ROLES },
    { id: 'accounting', label: 'Accounting', icon: Settings2, roles: MANAGERS },
    { id: 'reports', label: 'Reports & Analytics', icon: FileBarChart2, roles: SALES_ROLES },
  ] },
  { title: 'Tools & administration', items: [
    { id: 'calculators', label: 'Calculators', icon: Calculator, roles: ALL_ROLES },
    { id: 'ai-insights', label: 'AI Insights', icon: Sparkles, roles: ALL_ROLES },
    { id: 'db-admin', label: 'System Administration', icon: ShieldCheck, roles: ['Super Admin'] },
  ] },
];

export default function Sidebar({
  activeTab, setActiveTab, currentRole, currentUser, activeShopId, shopProfiles,
  isShopLocked = false, onOpenProfile, onSwitchShop, onLogout, onClose,
}: SidebarProps) {
  const currentShop = shopProfiles.find((shop) => shop.id === activeShopId);
  const initials = currentUser.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'AR';

  return (
    <aside id="sidebar-container" aria-label="Main navigation" className="w-[280px] h-full min-h-0 bg-[#101d32] text-white flex flex-col border-r border-white/10 shrink-0 shadow-xl shadow-slate-950/10">
      <div className="px-5 pt-6 pb-5 border-b border-white/10 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 flex items-center justify-center shadow-lg shadow-amber-500/15">
              <Bolt className="w-6 h-6" strokeWidth={2.4} />
            </div>
            <div className="min-w-0">
              <p className="font-heading text-xl font-bold leading-tight tracking-tight">ARS Hardware</p>
              <p className="text-[10px] uppercase font-semibold tracking-[0.18em] text-amber-300">Business POS</p>
            </div>
          </div>
          {onClose && (
            <button type="button" aria-label="Close navigation" onClick={onClose} className="md:hidden rounded-lg p-2 text-slate-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-400">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.055] px-3.5 py-3 flex items-center gap-2.5">
          <div className="rounded-lg bg-amber-400/15 p-2 text-amber-300"><Store className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Active workspace</p>
            <p className="truncate text-xs font-semibold text-slate-100" title={currentShop?.name}>{currentShop?.name || 'ARS Hardware'}</p>
          </div>
        </div>
      </div>

      <nav aria-label="Modules" className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-5 [scrollbar-width:thin] [scrollbar-color:#536078_transparent]">
        {groups.map(({ title, items }) => {
          const accessible = items.filter((item) => item.roles.includes(currentRole));
          if (!accessible.length) return null;
          return (
            <section key={title} aria-label={title}>
              <h2 className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.17em] text-slate-500">{title}</h2>
              <div className="space-y-0.5">
                {accessible.map((item) => {
                  const Icon = item.icon;
                  const selected = activeTab === item.id;
                  return (
                    <button key={item.id} id={`nav-btn-${item.id}`} type="button" aria-current={selected ? 'page' : undefined}
                      onClick={() => { setActiveTab(item.id); onClose?.(); }}
                      className={`group relative w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-left transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${selected ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-500/10' : 'text-slate-300 hover:bg-white/[0.075] hover:text-white'}`}>
                      <Icon className={`h-[17px] w-[17px] shrink-0 ${selected ? 'text-slate-900' : 'text-slate-400 group-hover:text-amber-300'}`} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {selected && <span className="h-1.5 w-1.5 rounded-full bg-slate-900" />}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-white/10 bg-[#0c1729] p-4">
        <label htmlFor="ars-shop-switcher" className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
          Shop / Branch
        </label>
        <div className="relative">
          <select id="ars-shop-switcher" value={activeShopId} onChange={(e) => onSwitchShop(e.target.value)} disabled={isShopLocked}
            className="w-full appearance-none rounded-xl border border-white/15 bg-white/[0.065] py-2.5 pl-3 pr-9 text-xs font-semibold text-white outline-none focus:border-amber-400 disabled:opacity-70">
            {(shopProfiles || []).map((shop) => <option className="text-slate-900" key={shop.id} value={shop.id}>{shop.name}</option>)}
          </select>
          {isShopLocked ? <ShieldCheck className="absolute right-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" /> : <ChevronDown className="absolute right-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />}
        </div>
        <button type="button" onClick={onOpenProfile} className="mt-3 w-full flex items-center gap-3 rounded-xl p-2 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-400">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-xs font-bold text-white">{initials}</span>
          <span className="flex-1 min-w-0">
            <span className="block truncate text-xs font-semibold">{currentUser}</span>
            <span className="block truncate text-[11px] text-slate-400">{currentRole} · Edit profile</span>
          </span>
          <ArrowUpRight className="h-4 w-4 text-slate-400" />
        </button>
        <button type="button" onClick={onLogout} className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-white/10 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-amber-400">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
        <p className="mt-3 text-center text-[10px] text-slate-500">Powered by RS Nextward</p>
      </div>
    </aside>
  );
}
