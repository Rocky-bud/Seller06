import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FileCheck, Package, Settings, LogOut, Store, Users, Megaphone } from 'lucide-react';
import { useShop } from '../contexts/ShopContext';

// Each item declares WHICH roles may see it. Canonical roles:
//   'super_admin' — owns the platform; only needs the aggregated dashboard
//                   and shop management. No per-shop merchant tooling.
//   'owner'       — shop owner; full merchant tooling + bot settings.
//   'staff'       — shop staff; day-to-day operations, no broadcast/settings.
const navItems = [
  { to: '/dashboard', label: 'میز کار', icon: LayoutDashboard, roles: ['super_admin', 'owner', 'staff'] },
  { to: '/shops', label: 'مدیریت فروشگاه‌ها', icon: Store, roles: ['super_admin'] },
  { to: '/receipts', label: 'تأیید فیش‌های مالی', icon: FileCheck, roles: ['owner', 'staff'] },
  { to: '/products', label: 'مدیریت محصولات', icon: Package, roles: ['owner', 'staff'] },
  { to: '/customers', label: 'مدیریت مشتریان', icon: Users, roles: ['owner', 'staff'] },
  { to: '/broadcast', label: 'پیام همگانی', icon: Megaphone, roles: ['owner'] },
  { to: '/settings', label: 'تنظیمات ربات', icon: Settings, roles: ['owner'] },
];

const ROLE_LABELS = {
  super_admin: 'مدیرکل',
  owner: 'صاحب فروشگاه',
  staff: 'کارمند',
};

export default function Sidebar() {
  const { shopId, role, isSuperAdmin, logout } = useShop();

  const visibleItems = navItems.filter((item) => item.roles.includes(role));
  const roleLabel = ROLE_LABELS[role] || '';

  return (
    <aside className="w-64 bg-white border-l border-slate-200 flex flex-col h-screen shrink-0 sticky top-0">
      <div className="px-5 py-6 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">{isSuperAdmin ? 'پنل مدیرکل' : 'فروشگاه من'}</h2>
            {roleLabel ? <p className="text-xs text-primary-600 mt-0.5">{roleLabel}</p> : null}
            {!isSuperAdmin && shopId ? (
              <p className="text-xs text-slate-400 mt-0.5" dir="ltr">{shopId}</p>
            ) : null}
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {visibleItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-primary-50 text-primary-700 shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800',
              ].join(' ')
            }
          >
            <Icon className="w-5 h-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-slate-100">
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-danger-50 hover:text-danger-600 transition-all"
        >
          <LogOut className="w-5 h-5" />
          خروج
        </button>
      </div>
    </aside>
  );
}
