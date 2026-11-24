import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard, ShoppingCart, Package, Truck, Users2,
  Settings2, LogOut, ShieldCheck, FileBarChart2, FileText,
  Timer, Calculator, X, ChevronDown, Store, ArrowUpRight, Layers3,
  UserRoundCog, Ship, Building2, Landmark, ClipboardCheck, DatabaseBackup,
} from 'lucide-react';
import { Role } from '../types';
import ARSBrand from './ARSBrand';

type Tab = 'dashboard' | 'pos' | 'products' | 'inventory' | 'purchases' | 'imports' | 'shipments' | 'warehouse-receiving' | 'partners' | 'customers' | 'staff' | 'reports' | 'quotations' | 'shifts' | 'accounting' | 'company-profile' | 'backup-recovery' | 'db-admin' | 'calculators' | 'my-collections';
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
};
type NavGroup = { id: string; title: string; items: NavItem[] };
const ALL_ROLES: Role[] = ['Super Admin', 'Store Manager', 'Cashier', 'Inventory Staff'];
const SALES_ROLES: Role[] = ['Super Admin', 'Store Manager', 'Cashier'];
const STOCK_ROLES: Role[] = ['Super Admin', 'Store Manager', 'Inventory Staff'];
const MANAGERS: Role[] = ['Super Admin', 'Store Manager'];

const pinnedItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ALL_ROLES },
  { id: 'pos', label: 'Wholesale Invoices', icon: ShoppingCart, roles: SALES_ROLES },
  { id: 'my-collections', label: 'My Collections', icon: Landmark, roles: ['Cashier'] },
];
const groups: NavGroup[] = [
  { id: 'sales', title: 'Wholesale & Billing', items: [
    { id: 'quotations', label: 'Quotations', icon: FileText, roles: SALES_ROLES },
    { id: 'shifts', label: 'Cash Shifts', icon: Timer, roles: SALES_ROLES },
  ] },
  { id: 'inventory', title: 'Imports & Stock', items: [
    { id: 'products', label: 'Products', icon: Package, roles: STOCK_ROLES },
    { id: 'inventory', label: 'Stock Management', icon: Layers3, roles: STOCK_ROLES },
    { id: 'purchases', label: 'Suppliers & Purchasing', icon: Truck, roles: STOCK_ROLES },
    { id: 'imports', label: 'Import Landed Costs', icon: Ship, roles: MANAGERS },
    { id: 'shipments', label: 'Import Shipments', icon: Ship, roles: MANAGERS },
    { id: 'warehouse-receiving', label: 'Warehouse Receiving', icon: ClipboardCheck, roles: STOCK_ROLES },
  ] },
  { id: 'people', title: 'Customers & Staff', items: [
    { id: 'customers', label: 'Customers', icon: Users2, roles: SALES_ROLES },
    { id: 'staff', label: 'Staff', icon: UserRoundCog, roles: MANAGERS },
  ] },
  { id: 'management', title: 'Reports & Management', items: [
    { id: 'reports', label: 'Reports & Analytics', icon: FileBarChart2, roles: SALES_ROLES },
    { id: 'accounting', label: 'Accounting', icon: Settings2, roles: MANAGERS },
    { id: 'partners', label: 'Partner Capital', icon: Landmark, roles: ['Super Admin'] },
    { id: 'calculators', label: 'Calculators', icon: Calculator, roles: ALL_ROLES },
  ] },
  { id: 'admin', title: 'Administration', items: [
    { id: 'company-profile', label: 'Company Profile', icon: Building2, roles: MANAGERS },
    { id: 'backup-recovery', label: 'Backup & Recovery', icon: DatabaseBackup, roles: ['Super Admin'] },
    { id: 'db-admin', label: 'System Administration', icon: ShieldCheck, roles: ['Super Admin'] },
  ] },
];

const getGroupForTab = (tab: Tab): string | null =>
  groups.find((group) => group.items.some((item) => item.id === tab))?.id || null;

export default function Sidebar({
  activeTab, setActiveTab, currentRole, currentUser, activeShopId, shopProfiles,
  isShopLocked = false, onOpenProfile, onSwitchShop, onLogout, onClose,
}: SidebarProps) {
  const currentShop = shopProfiles.find((shop) => shop.id === activeShopId);
  const initials = currentUser.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'AR';
  const [expandedGroups, setExpandedGroups] = useState<string[]>(() => {
    const group = getGroupForTab(activeTab);
    return group ? [group] : [];
  });
  useEffect(() => {
    const group = getGroupForTab(activeTab);
    if (group) setExpandedGroups((previous) => previous.includes(group) ? previous : [...previous, group]);
  }, [activeTab]);

  const navigate = (tab: Tab) => { setActiveTab(tab); onClose?.(); };
  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const selected = activeTab === item.id;
    return (
      <button key={item.id} id={`nav-btn-${item.id}`} type="button" aria-current={selected ? 'page' : undefined}
        onClick={() => navigate(item.id)}
        className={`group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${selected ? 'bg-amber-400 text-slate-950 shadow-sm' : 'text-slate-300 hover:bg-white/[0.085] hover:text-white'}`}>
        <Icon className={`h-[17px] w-[17px] shrink-0 ${selected ? 'text-slate-900' : 'text-slate-400 group-hover:text-amber-300'}`} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-slate-900" />}
      </button>
    );
  };

  return (
    <aside id="sidebar-container" aria-label="Main navigation" className="flex h-full min-h-0 w-[272px] shrink-0 flex-col border-r border-white/10 bg-[#101d32] text-white shadow-xl shadow-slate-950/10">
      <div className="shrink-0 border-b border-white/10 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-1">
          <ARSBrand subtitle="Wholesale Distribution" />
          {onClose && (
            <button type="button" aria-label="Close navigation" onClick={onClose} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 md:hidden">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Modules" className="min-h-0 flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:thin] [scrollbar-color:#536078_transparent]">
        <div className="space-y-1 border-b border-white/10 pb-3">
          {pinnedItems.filter((item) => item.roles.includes(currentRole)).map(renderItem)}
        </div>
        <div className="space-y-1 pt-2">
          {groups.map((group) => {
            const items = group.items.filter((item) => item.roles.includes(currentRole));
            if (!items.length) return null;
            const expanded = expandedGroups.includes(group.id);
            const hasActive = items.some((item) => item.id === activeTab);
            return (
              <section key={group.id} aria-label={group.title} className="rounded-xl">
                <button type="button" aria-expanded={expanded} aria-controls={`ars-nav-group-${group.id}`}
                  onClick={() => setExpandedGroups((previous) => expanded ? previous.filter((id) => id !== group.id) : [group.id])}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.075em] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-400 ${hasActive ? 'text-amber-300' : 'text-slate-400'}`}>
                  <span className="min-w-0 flex-1 truncate">{group.title}</span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {expanded && (
                  <div id={`ars-nav-group-${group.id}`} className="space-y-0.5 pb-1 pl-1">
                    {items.map(renderItem)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </nav>

      <div className="shrink-0 border-t border-white/10 bg-[#0c1729] px-3 pb-3 pt-3">
        <div className="relative mb-2 flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-2.5">
          <Store className="h-4 w-4 shrink-0 text-amber-300" />
          <select id="ars-shop-switcher" aria-label="Shop / Branch" value={activeShopId} onChange={(e) => onSwitchShop(e.target.value)} disabled={isShopLocked}
            className="min-w-0 flex-1 appearance-none bg-transparent py-2.5 pr-5 text-xs font-semibold text-white outline-none disabled:opacity-70">
            {(shopProfiles || []).map((shop) => <option className="text-slate-900" key={shop.id} value={shop.id}>{shop.name}</option>)}
          </select>
          {isShopLocked ? <ShieldCheck className="pointer-events-none absolute right-2 h-4 w-4 text-slate-400" /> : <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-slate-400" />}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onOpenProfile} title="Edit profile" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber-400">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-xs font-bold">{initials}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{currentUser}</span>
              <span className="block truncate text-[10px] text-slate-400">{currentRole}</span>
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
          <button type="button" onClick={onLogout} title="Sign out" aria-label="Sign out" className="rounded-lg border border-white/10 p-2.5 text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-amber-400">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-slate-500">Powered by RS Nextward</p>
      </div>
    </aside>
  );
}
