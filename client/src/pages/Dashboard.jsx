import { useState, useEffect } from 'react';
import { useShop } from '../contexts/ShopContext';
import { fetchDashboardStats, fetchAnalyticsSummary, fetchRetention, fetchBroadcastRoi, fetchAdminOverview } from '../hooks/useApi';
import { formatToman } from '../utils/helpers';
import {
  TrendingUp, Clock, AlertTriangle, ShoppingCart, CheckCircle2, XCircle,
  Package, MessageCircle, BarChart3, PieChart, Send, Camera as Instagram, Filter, Trophy, Repeat, Megaphone, Store
} from 'lucide-react';

// ─── Daily sales trend (native SVG/Tailwind bar chart) ───────────────────────
function SalesTrendChart({ analytics }) {
  const trend = analytics?.dailyTrend || [];
  const maxRev = Math.max(1, ...trend.map(d => d.revenue));

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-slate-700">روند فروش روزانه</h3>
        </div>
        <span className="text-xs text-slate-400">۷ روز اخیر</span>
      </div>

      <div className="flex items-end justify-between gap-2 h-40">
        {trend.map((d) => {
          const pct = (d.revenue / maxRev) * 100;
          const barHeight = d.revenue > 0 ? Math.max(pct, 4) : 0;
          return (
            <div key={d.key} className="flex-1 flex flex-col items-center justify-end h-full group">
              <div className="relative w-full flex flex-col justify-end h-28">
                <div
                  className="w-full rounded-t-lg bg-gradient-to-t from-primary-500 to-primary-300 group-hover:from-primary-600 group-hover:to-primary-400 transition-all duration-200"
                  style={ { height: `${barHeight}%` } }
                />
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {d.count} سفارش
                </span>
              </div>
              <span className="text-xs text-slate-500 mt-2">{d.label}</span>
              <span className="text-xs text-slate-400">{d.dateLabel}</span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100">
        <div>
          <p className="text-xs text-slate-400">فروش این هفته</p>
          <p className="text-sm font-bold text-emerald-700 mt-1">{formatToman(analytics?.weekRevenue || 0)}</p>
        </div>
        <div className="text-left">
          <p className="text-xs text-slate-400">سفارش‌های تأییدشده هفته</p>
          <p className="text-sm font-bold text-slate-800 mt-1">{analytics?.weekCount || 0} سفارش</p>
        </div>
      </div>
    </div>
  );
}

// ─── Platform sales share (Telegram vs Instagram) ────────────────────────────
function PlatformShareChart({ analytics }) {
  const platforms = analytics?.platforms || {
    telegram: { count: 0, revenue: 0 },
    instagram: { count: 0, revenue: 0 },
  };
  const totalRev = analytics?.platformTotalRevenue || 0;
  const tgPct = totalRev > 0 ? Math.round((platforms.telegram.revenue / totalRev) * 100) : 0;
  const igPct = totalRev > 0 ? 100 - tgPct : 0;

  const rows = [
    {
      key: 'telegram',
      label: 'تلگرام',
      icon: Send,
      pct: tgPct,
      data: platforms.telegram,
      dot: 'bg-sky-500',
      bar: 'bg-sky-500',
      text: 'text-sky-600',
    },
    {
      key: 'instagram',
      label: 'اینستاگرام',
      icon: Instagram,
      pct: igPct,
      data: platforms.instagram,
      dot: 'bg-pink-500',
      bar: 'bg-pink-500',
      text: 'text-pink-600',
    },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-5">
        <PieChart className="w-4 h-4 text-violet-600" />
        <h3 className="text-sm font-semibold text-slate-700">سهم فروش کانال‌ها</h3>
      </div>

      {totalRev === 0 ? (
        <div className="text-sm text-slate-400 text-center py-10">هنوز فروش تأییدشده‌ای ثبت نشده است</div>
      ) : (
        <div className="space-y-5">
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
            <div className="bg-sky-500 transition-all duration-300" style={ { width: `${tgPct}%` } } />
            <div className="bg-pink-500 transition-all duration-300" style={ { width: `${igPct}%` } } />
          </div>

          <div className="space-y-4">
            {rows.map(({ key, label, icon: Icon, pct, data, dot, bar, text }) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                    <Icon className={`w-4 h-4 ${text}`} />
                    <span className="text-sm text-slate-600">{label}</span>
                  </div>
                  <span className={`text-sm font-bold ${text}`}>{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full ${bar} transition-all duration-300`} style={ { width: `${pct}%` } } />
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-slate-400">{data.count} سفارش</span>
                  <span className="text-xs font-medium text-slate-500">{formatToman(data.revenue)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Conversion funnel (مکالمه → سفارش → پرداخت) ───────────────────────
function FunnelChart({ summary }) {
  const funnel = summary?.funnel || [];
  const maxVal = Math.max(1, ...funnel.map((s) => s.value));
  const colors = ['bg-blue-500', 'bg-violet-500', 'bg-amber-500', 'bg-emerald-500'];
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-700">قیف تبدیل</h3>
        </div>
        <span className="text-xs text-slate-400">نرخ تبدیل کل: {summary?.conversionRate ?? 0}%</span>
      </div>
      <div className="space-y-3">
        {funnel.map((s, i) => {
          const pct = (s.value / maxVal) * 100;
          const barWidth = s.value > 0 ? Math.max(pct, 6) : 0;
          return (
            <div key={s.stage}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-slate-600">{s.label}</span>
                <span className="text-sm font-bold text-slate-800">
                  {s.value.toLocaleString('fa-IR')}
                  {typeof s.ofPrev === 'number' ? <span className="text-xs font-normal text-slate-400 mr-1">({s.ofPrev}%)</span> : null}
                </span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${colors[i % colors.length]} transition-all duration-300`} style={ { width: `${barWidth}%` } } />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Top products by revenue ───────────────────────────────────────
function TopProductsCard({ summary }) {
  const products = summary?.topProducts || [];
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-5">
        <Trophy className="w-4 h-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-slate-700">پرفروش‌ترین محصولات</h3>
      </div>
      {products.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-10">هنوز فروش تأییدشده‌ای ثبت نشده است</div>
      ) : (
        <div className="space-y-3">
          {products.map((p, i) => (
            <div key={p.productId} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-6 h-6 shrink-0 rounded-lg bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">{(i + 1).toLocaleString('fa-IR')}</span>
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 truncate">{p.name}</p>
                  <p className="text-xs text-slate-400">{p.units.toLocaleString('fa-IR')} عدد · {p.orders.toLocaleString('fa-IR')} سفارش</p>
                </div>
              </div>
              <span className="text-sm font-bold text-emerald-700 shrink-0">{formatToman(p.revenue)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Cohort retention table (PHASE 7 · STEP 2) ───────────────────────────────
function RetentionCard({ retention }) {
  const cohorts = retention?.cohorts || [];
  const totals = retention?.totals || {};
  const maxOffset = retention?.months ? retention.months - 1 : 0;
  const offsets = [];
  for (let i = 0; i <= maxOffset; i++) offsets.push(i);

  const cellColor = (pct) => {
    if (pct >= 60) return 'bg-emerald-500 text-white';
    if (pct >= 30) return 'bg-emerald-300 text-emerald-900';
    if (pct > 0) return 'bg-emerald-100 text-emerald-700';
    return 'bg-slate-50 text-slate-300';
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <Repeat className="w-4 h-4 text-indigo-500" />
        <h3 className="text-sm font-semibold text-slate-700">بازگشت مشتری (کوهورت ماهانه)</h3>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="p-3 bg-indigo-50 rounded-xl text-center">
          <p className="text-lg font-bold text-indigo-700">{(totals.repeatRate ?? 0).toLocaleString('fa-IR')}%</p>
          <p className="text-xs text-slate-500">نرخ خرید مجدد</p>
        </div>
        <div className="p-3 bg-slate-50 rounded-xl text-center">
          <p className="text-lg font-bold text-slate-700">{(totals.totalCustomers ?? 0).toLocaleString('fa-IR')}</p>
          <p className="text-xs text-slate-500">کل مشتریان</p>
        </div>
        <div className="p-3 bg-slate-50 rounded-xl text-center">
          <p className="text-lg font-bold text-slate-700">{(totals.avgOrdersPerCustomer ?? 0).toLocaleString('fa-IR')}</p>
          <p className="text-xs text-slate-500">میانگین سفارش هر مشتری</p>
        </div>
      </div>
      {cohorts.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-8">هنوز دادهٔ کافی برای تحلیل کوهورت ثبت نشده است</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-right font-medium pb-2 pr-2 whitespace-nowrap">ماه شروع</th>
                <th className="font-medium pb-2 px-1">تعداد</th>
                {offsets.map((o) => (
                  <th key={o} className="font-medium pb-2 px-1 whitespace-nowrap">ماه +{o.toLocaleString('fa-IR')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.cohort}>
                  <td className="text-right text-slate-600 py-1 pr-2 whitespace-nowrap">{c.cohort}</td>
                  <td className="text-center text-slate-500 py-1 px-1">{(c.size ?? 0).toLocaleString('fa-IR')}</td>
                  {offsets.map((o) => {
                    const cell = (c.retention || []).find((r) => r.offset === o);
                    if (!cell) return <td key={o} className="py-1 px-1" />;
                    return (
                      <td key={o} className="py-1 px-1">
                        <div className={`rounded-md py-1 text-center ${cellColor(cell.pct)}`}>{cell.pct.toLocaleString('fa-IR')}%</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Broadcast ROI table (PHASE 7 · STEP 3) ─────────────────────────────
function BroadcastRoiCard({ roi }) {
  const campaigns = roi?.campaigns || [];
  const totals = roi?.totals || {};
  const windowDays = roi?.windowDays ?? 3;

  const audienceLabel = (a) => {
    if (a === 'buyers') return 'خریداران';
    if (a === 'leads') return 'سرنخ‌ها';
    if (a === 'all') return 'همه';
    return a;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <Megaphone className="w-4 h-4 text-rose-500" />
        <h3 className="text-sm font-semibold text-slate-700">بازده کمپین‌های پیامی (ROI)</h3>
      </div>
      <p className="text-xs text-slate-400 mb-4">فروش منتسب در {windowDays.toLocaleString('fa-IR')} روز پس از هر ارسال</p>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="p-3 bg-slate-50 rounded-xl text-center">
          <p className="text-lg font-bold text-slate-700">{(totals.campaigns ?? 0).toLocaleString('fa-IR')}</p>
          <p className="text-xs text-slate-500">کمپین</p>
        </div>
        <div className="p-3 bg-rose-50 rounded-xl text-center">
          <p className="text-lg font-bold text-rose-700">{(totals.totalAttributedOrders ?? 0).toLocaleString('fa-IR')}</p>
          <p className="text-xs text-slate-500">سفارش منتسب</p>
        </div>
        <div className="p-3 bg-emerald-50 rounded-xl text-center">
          <p className="text-sm font-bold text-emerald-700">{formatToman(totals.totalAttributedRevenue || 0)}</p>
          <p className="text-xs text-slate-500">درآمد منتسب</p>
        </div>
      </div>
      {campaigns.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-8">هنوز کمپینی ارسال نشده است</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-right font-medium pb-2 pr-2">پیام</th>
                <th className="font-medium pb-2 px-1 whitespace-nowrap">مخاطب</th>
                <th className="font-medium pb-2 px-1 whitespace-nowrap">ارسال</th>
                <th className="font-medium pb-2 px-1 whitespace-nowrap">سفارش</th>
                <th className="font-medium pb-2 px-1 whitespace-nowrap">نرخ تبدیل</th>
                <th className="font-medium pb-2 pl-1 whitespace-nowrap">درآمد</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-slate-50">
                  <td className="text-right text-slate-600 py-2 pr-2 max-w-xs truncate">{c.message || '—'}</td>
                  <td className="text-center text-slate-500 py-2 px-1 whitespace-nowrap">{audienceLabel(c.audience)}</td>
                  <td className="text-center text-slate-500 py-2 px-1">{(c.sentCount ?? 0).toLocaleString('fa-IR')}</td>
                  <td className="text-center text-slate-700 py-2 px-1 font-semibold">{(c.attributedOrders ?? 0).toLocaleString('fa-IR')}</td>
                  <td className="text-center py-2 px-1">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-rose-50 text-rose-600">{(c.conversionRate ?? 0).toLocaleString('fa-IR')}%</span>
                  </td>
                  <td className="text-left text-emerald-700 py-2 pl-1 font-bold whitespace-nowrap">{formatToman(c.attributedRevenue || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Super-admin aggregated dashboard (cross-shop roll-up) ───────────────────
function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchAdminOverview(7)
      .then((d) => { setData(d); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-center text-slate-500 py-12">خطا در بارگذاری اطلاعات تجمیعی</div>;
  }

  const t = data.totals || {};
  const trend = data.revenueTrend || [];
  const maxRev = Math.max(1, ...trend.map((d) => d.revenue));
  const platforms = data.platforms || { telegram: { count: 0, revenue: 0 }, instagram: { count: 0, revenue: 0 } };
  const platTotal = data.platformTotalRevenue || 0;
  const tgPct = platTotal > 0 ? Math.round((platforms.telegram.revenue / platTotal) * 100) : 0;
  const igPct = platTotal > 0 ? 100 - tgPct : 0;

  const cards = [
    { label: 'فروش کل (همه فروشگاه‌ها)', value: formatToman(t.totalRevenue || 0), icon: TrendingUp, bgLight: 'bg-emerald-50', textColor: 'text-emerald-700' },
    { label: 'سفارش‌های در انتظار', value: t.pendingCount || 0, icon: Clock, bgLight: 'bg-primary-50', textColor: 'text-primary-700' },
    { label: 'تعداد فروشگاه‌ها', value: data.shopCount || 0, icon: Store, bgLight: 'bg-violet-50', textColor: 'text-violet-700' },
    { label: 'چت‌های ربات', value: t.totalChats || 0, icon: MessageCircle, bgLight: 'bg-blue-50', textColor: 'text-blue-700', subtitle: `تلگرام ${t.telegramChats || 0} · اینستاگرام ${t.instagramChats || 0}` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">میز کار مدیرکل</h1>
        <p className="text-sm text-slate-500 mt-1">نمای تجمیعی همه فروشگاه‌های تحت کنترل شما</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, bgLight, textColor, subtitle }) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-500">{label}</p>
                  <p className={`text-2xl font-bold mt-2 ${textColor}`}>{value}</p>
                  {subtitle ? <p className="text-xs text-slate-400 mt-1">{subtitle}</p> : null}
                </div>
                <div className={`w-11 h-11 rounded-xl ${bgLight} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${textColor}`} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue trend across all shops */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-5">
            <BarChart3 className="w-4 h-4 text-primary-600" />
            <h3 className="text-sm font-semibold text-slate-700">روند فروش روزانه (تجمیعی)</h3>
          </div>
          <div className="flex items-end justify-between gap-2 h-40">
            {trend.map((d) => {
              const pct = (d.revenue / maxRev) * 100;
              const barHeight = d.revenue > 0 ? Math.max(pct, 4) : 0;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full group">
                  <div className="relative w-full flex flex-col justify-end h-28">
                    <div className="w-full rounded-t-lg bg-gradient-to-t from-primary-500 to-primary-300" style={ { height: `${barHeight}%` } } />
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{d.count} سفارش</span>
                  </div>
                  <span className="text-xs text-slate-400 mt-2" dir="ltr">{d.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Platform split */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-5">
            <PieChart className="w-4 h-4 text-violet-600" />
            <h3 className="text-sm font-semibold text-slate-700">سهم فروش کانال‌ها (تجمیعی)</h3>
          </div>
          {platTotal === 0 ? (
            <div className="text-sm text-slate-400 text-center py-10">هنوز فروش تأییدشده‌ای ثبت نشده است</div>
          ) : (
            <div className="space-y-5">
              <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
                <div className="bg-sky-500" style={ { width: `${tgPct}%` } } />
                <div className="bg-pink-500" style={ { width: `${igPct}%` } } />
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2"><Send className="w-4 h-4 text-sky-600" /><span className="text-slate-600">تلگرام</span></div>
                <span className="font-bold text-sky-600">{tgPct}% · {formatToman(platforms.telegram.revenue)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2"><Instagram className="w-4 h-4 text-pink-600" /><span className="text-slate-600">اینستاگرام</span></div>
                <span className="font-bold text-pink-600">{igPct}% · {formatToman(platforms.instagram.revenue)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Per-shop breakdown */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Store className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">عملکرد فروشگاه‌ها</h3>
        </div>
        {(!data.shops || data.shops.length === 0) ? (
          <div className="text-sm text-slate-400 text-center py-8">هنوز فروشگاهی ثبت نشده است</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs border-b border-slate-100">
                  <th className="text-right font-medium py-2 px-2">فروشگاه</th>
                  <th className="text-right font-medium py-2 px-2">فروش</th>
                  <th className="text-right font-medium py-2 px-2">سفارش تأییدشده</th>
                  <th className="text-right font-medium py-2 px-2">در انتظار</th>
                  <th className="text-right font-medium py-2 px-2">محصولات</th>
                  <th className="text-right font-medium py-2 px-2">چت‌ها</th>
                </tr>
              </thead>
              <tbody>
                {data.shops.map((s) => (
                  <tr key={s.shopId} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2.5 px-2 text-slate-700 font-medium">{s.name}</td>
                    <td className="py-2.5 px-2 text-emerald-700 font-bold">{formatToman(s.revenue)}</td>
                    <td className="py-2.5 px-2 text-slate-600">{s.approvedOrders}</td>
                    <td className="py-2.5 px-2 text-primary-600">{s.pendingCount}</td>
                    <td className="py-2.5 px-2 text-slate-600">{s.products}</td>
                    <td className="py-2.5 px-2 text-slate-600">{s.chats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top products across all shops */}
      {data.topProducts && data.topProducts.length > 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-700">پرفروش‌ترین محصولات (همه فروشگاه‌ها)</h3>
          </div>
          <div className="space-y-2">
            {data.topProducts.map((p, i) => (
              <div key={p.productId} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-lg bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <span className="text-sm text-slate-700">{p.name}</span>
                </div>
                <span className="text-sm font-bold text-emerald-700">{formatToman(p.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Dashboard() {
  const { shopId, isSuperAdmin } = useShop();
  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [retention, setRetention] = useState(null);
  const [roi, setRoi] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shopId) return;
    setLoading(true);
    fetchDashboardStats(shopId)
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
    fetchAnalyticsSummary(shopId).then(setSummary).catch(console.error);
    fetchRetention(shopId).then(setRetention).catch(console.error);
    fetchBroadcastRoi(shopId).then(setRoi).catch(console.error);
  }, [shopId]);

  // Super-admins get the cross-shop aggregated view instead of the per-shop
  // merchant dashboard. (Declared after all hooks to respect the rules of hooks.)
  if (isSuperAdmin) {
    return <AdminDashboard />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats) {
    return <div className="text-center text-slate-500 py-12">خطا در بارگذاری اطلاعات</div>;
  }

  const cards = [
    {
      label: 'کل فروش',
      value: formatToman(stats.totalRevenue),
      icon: TrendingUp,
      color: 'from-emerald-500 to-emerald-600',
      bgLight: 'bg-emerald-50',
      textColor: 'text-emerald-700'
    },
    {
      label: 'سفارشات در انتظار تأیید',
      value: stats.pendingCount,
      icon: Clock,
      color: 'from-primary-500 to-primary-600',
      bgLight: 'bg-primary-50',
      textColor: 'text-primary-700'
    },
    {
      label: 'کل محصولات',
      value: stats.totalProducts,
      icon: Package,
      color: 'from-violet-500 to-violet-600',
      bgLight: 'bg-violet-50',
      textColor: 'text-violet-700'
    },
    {
      label: 'چت‌های ربات',
      value: stats.totalChats,
      icon: MessageCircle,
      color: 'from-blue-500 to-blue-600',
      bgLight: 'bg-blue-50',
      textColor: 'text-blue-700',
      subtitle: `تلگرام ${stats.telegramChats} · اینستاگرام ${stats.instagramChats}`
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">میز کار</h1>
        <p className="text-sm text-slate-500 mt-1">نمای کلی وضعیت فروشگاه شما</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color, bgLight, textColor, subtitle }) => (
          <div
            key={label}
            className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
          >
            <div className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-500">{label}</p>
                  <p className={`text-2xl font-bold mt-2 ${textColor}`}>{value}</p>
                  {subtitle ? <p className="text-xs text-slate-400 mt-1">{subtitle}</p> : null}
                </div>
                <div className={`w-11 h-11 rounded-xl ${bgLight} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${textColor}`} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* STAGE 32 -- financial analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SalesTrendChart analytics={stats.analytics} />
        <PlatformShareChart analytics={stats.analytics} />
      </div>

      {/* PHASE 7 · STEP 1 -- conversion funnel + top products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FunnelChart summary={summary} />
        <TopProductsCard summary={summary} />
      </div>

      {/* PHASE 7 · STEP 2 -- cohort retention */}
      <RetentionCard retention={retention} />

      {/* PHASE 7 · STEP 3 -- broadcast ROI */}
      <BroadcastRoiCard roi={roi} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">خلاصه سفارشات</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-slate-400" />
                <span className="text-sm text-slate-600">کل سفارشات</span>
              </div>
              <span className="text-sm font-bold text-slate-800">{stats.totalOrders}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-success-50 rounded-xl">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-success-600" />
                <span className="text-sm text-success-600">تأیید شده</span>
              </div>
              <span className="text-sm font-bold text-success-600">{stats.approvedOrders}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-danger-50 rounded-xl">
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-danger-600" />
                <span className="text-sm text-danger-600">رد شده</span>
              </div>
              <span className="text-sm font-bold text-danger-600">
                {stats.totalOrders - stats.approvedOrders - stats.pendingCount}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">هشدارهای موجودی</h3>
          {stats.lowStockAlerts.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-8">موجودی همه محصولات کافی است</div>
          ) : (
            <div className="space-y-2">
              {stats.lowStockAlerts.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-warning-50 rounded-xl">
                  <span className="text-sm text-slate-700">{p.name}</span>
                  <span className="text-sm font-bold text-warning-600">فقط {p.stock} عدد</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
