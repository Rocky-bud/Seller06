import { useState, useEffect, useCallback } from 'react';
import { useShop } from '../contexts/ShopContext';
import { fetchCustomers } from '../hooks/useApi';
import { formatDate } from '../utils/helpers';
import {
  Users, Send, Camera as Instagram, RefreshCw, ShoppingBag, Search,
  Crown, MessageCircle, UserCircle, Phone
} from 'lucide-react';

function PlatformBadge({ platform }) {
  const isIg = platform === 'instagram';
  const Icon = isIg ? Instagram : Send;
  const cls = isIg
    ? 'bg-pink-50 text-pink-600 border-pink-200'
    : 'bg-sky-50 text-sky-600 border-sky-200';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${cls}`}>
      <Icon className="w-3.5 h-3.5" />
      {isIg ? 'اینستاگرام' : 'تلگرام'}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, bg, text }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${text}`} />
        </div>
        <div>
          <p className="text-xs text-slate-400">{label}</p>
          <p className="text-lg font-bold text-slate-800 mt-0.5">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function Customers() {
  const { shopId } = useShop();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');

  const load = useCallback((spinner = true) => {
    if (!shopId) return;
    if (spinner) setLoading(true); else setSyncing(true);
    fetchCustomers(shopId)
      .then((rows) => { setCustomers(rows); setError(''); })
      .catch((e) => setError(e.message || 'خطا در بارگذاری مشتریان'))
      .finally(() => { setLoading(false); setSyncing(false); });
  }, [shopId]);

  useEffect(() => { load(true); }, [load]);

  const filtered = customers.filter((c) => {
    if (platformFilter !== 'all' && c.platform !== platformFilter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.userId && String(c.userId).toLowerCase().includes(q))
    );
  });

  const stats = {
    total: customers.length,
    telegram: customers.filter((c) => c.platform === 'telegram').length,
    instagram: customers.filter((c) => c.platform === 'instagram').length,
    buyers: customers.filter((c) => c.orderCount > 0).length,
  };

  const FILTERS = [
    { key: 'all', label: 'همه' },
    { key: 'telegram', label: 'تلگرام' },
    { key: 'instagram', label: 'اینستاگرام' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">مدیریت مشتریان</h1>
          <p className="text-sm text-slate-500 mt-1">همه‌ی کاربرانی که با فروشگاه شما در تعامل بوده‌اند</p>
        </div>
        <button
          onClick={() => load(false)}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          به‌روزرسانی
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="کل مشتریان" value={stats.total} bg="bg-primary-50" text="text-primary-600" />
        <StatCard icon={Send} label="تلگرام" value={stats.telegram} bg="bg-sky-50" text="text-sky-600" />
        <StatCard icon={Instagram} label="اینستاگرام" value={stats.instagram} bg="bg-pink-50" text="text-pink-600" />
        <StatCard icon={ShoppingBag} label="مشتریان خریدار" value={stats.buyers} bg="bg-emerald-50" text="text-emerald-600" />
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجو بر اساس نام یا آیدی..."
            className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pr-10 pl-4 text-sm text-slate-700 outline-none focus:border-primary-400 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setPlatformFilter(f.key)}
              className={[
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                platformFilter === f.key
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-50',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="bg-danger-50 border border-danger-500 text-danger-600 text-sm rounded-xl px-4 py-3">{error}</div>
      ) : null}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center text-slate-400 py-16">
            <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm">هیچ مشتری‌ای یافت نشد</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs">
                  <th className="text-right font-medium px-5 py-3">مشتری</th>
                  <th className="text-right font-medium px-5 py-3">پلتفرم</th>
                  <th className="text-center font-medium px-5 py-3">سفارش‌ها</th>
                  <th className="text-center font-medium px-5 py-3">پیام‌ها</th>
                  <th className="text-right font-medium px-5 py-3">آخرین فعالیت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const loyal = c.orderCount >= 2;
                  return (
                    <tr key={`${c.platform}-${c.userId}`} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                            <UserCircle className="w-5 h-5 text-slate-400" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-slate-800 truncate">
                                {c.name || 'بدون نام'}
                              </span>
                              {loyal ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200">
                                  <Crown className="w-3 h-3" />
                                  وفادار
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-slate-400 font-mono" dir="ltr">{c.userId}</span>
                              {c.phone ? (
                                <span className="inline-flex items-center gap-1 text-xs text-slate-400" dir="ltr">
                                  <Phone className="w-3 h-3" />{c.phone}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3"><PlatformBadge platform={c.platform} /></td>
                      <td className="px-5 py-3 text-center">
                        {c.orderCount > 0 ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="font-bold text-slate-800">{c.orderCount}</span>
                            <span className="text-xs text-emerald-600">{c.approvedCount} تأیید</span>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <MessageCircle className="w-3.5 h-3.5 text-slate-400" />
                          {c.messageCount}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {formatDate(c.lastMessageAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 text-center">
        نمایش {filtered.length} از {customers.length} مشتری
      </p>
    </div>
  );
}
