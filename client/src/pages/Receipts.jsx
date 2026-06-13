import { useState, useEffect, useCallback, useRef } from 'react';
import { useShop } from '../contexts/ShopContext';
import { fetchOrders, confirmOrder, updateOrderStatus, updateOrderReceipt, updateOrderShipment } from '../hooks/useApi';
import { useNotifications } from '../hooks/useNotifications';
import { formatToman, formatDate, statusLabels, statusColors, shipmentLabels, shipmentColors } from '../utils/helpers';
import ImageUpload from '../components/ImageUpload';
import {
  FileCheck,
  CheckCircle2,
  XCircle,
  Eye,
  X,
  RefreshCw,
  ImageIcon,
  Hash,
  Wifi,
  Bell,
  BellOff,
  User,
  Phone,
  MapPin,
  ExternalLink,
  Truck,
  Package,
  PackageCheck,
  Ticket,
  Gift,
} from 'lucide-react';

const POLL_INTERVAL = 15000;

const FILTERS = [
  { key: 'all', label: 'همه' },
  { key: 'awaiting_approval', label: 'در انتظار تأیید' },
  { key: 'approved', label: 'تأیید شده' },
  { key: 'rejected', label: 'رد شده' },
  { key: 'pending_receipt', label: 'در انتظار رسید' },
];

function StatusBadge({ status }) {
  const cls = statusColors[status] || 'bg-slate-100 text-slate-500 border-slate-300';
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${cls}`}>
      {statusLabels[status] || status}
    </span>
  );
}

export default function Receipts() {
  const { shopId } = useShop();
  const { getPermission, requestPermission, notifyNewReceipt, notifyBatch } = useNotifications();

  const [allOrders, setAllOrders] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [newCount, setNewCount] = useState(0);
  const [notifPermission, setNotifPermission] = useState(() => getPermission());

  const actionInProgress = useRef(false);
  const prevAwaitingIds = useRef(new Set());

  const awaitingIdSet = (list) =>
    new Set(list.filter((o) => o.status === 'awaiting_approval').map((o) => o.id));

  useEffect(() => {
    if (notifPermission === 'default') {
      requestPermission().then((result) => setNotifPermission(result));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Full load (shows spinner) -- mount and manual refresh
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOrders(shopId);
      const fresh = data || [];
      prevAwaitingIds.current = awaitingIdSet(fresh);
      setAllOrders(fresh);
      setLastUpdated(new Date());
      setNewCount(0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  // Silent background poll -- no spinner, keeps modal in sync
  const silentPoll = useCallback(async () => {
    if (actionInProgress.current) return;
    setSyncing(true);
    try {
      const data = await fetchOrders(shopId);
      const fresh = data || [];

      // Detect genuinely new "awaiting approval" arrivals for notifications
      const arrived = fresh.filter(
        (o) => o.status === 'awaiting_approval' && !prevAwaitingIds.current.has(o.id)
      );
      if (arrived.length > 0) {
        setNewCount((prev) => prev + arrived.length);
        if (arrived.length === 1) notifyNewReceipt(arrived[0]);
        else notifyBatch(arrived.length);
      }

      prevAwaitingIds.current = awaitingIdSet(fresh);
      setAllOrders(fresh);
      setLastUpdated(new Date());

      setSelected((prev) => {
        if (!prev) return null;
        return fresh.find((o) => o.id === prev.id) || prev;
      });
    } catch (err) {
      console.error('Poll error:', err);
    } finally {
      setSyncing(false);
    }
  }, [shopId, notifyNewReceipt, notifyBatch]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    const id = setInterval(silentPoll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [silentPoll]);

  const handleAction = async (orderId, action) => {
    actionInProgress.current = true;
    setActionLoading(orderId + action);
    try {
      if (action === 'approve') {
        await confirmOrder(orderId, shopId);
      } else {
        await updateOrderStatus(orderId, 'rejected', shopId);
      }
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      setAllOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );
      setSelected((prev) =>
        prev && prev.id === orderId ? { ...prev, status: newStatus } : prev
      );
      prevAwaitingIds.current.delete(orderId);
    } catch (err) {
      console.error(err);
      window.alert(action === 'approve' ? 'تأیید فیش ناموفق بود' : 'رد فیش ناموفق بود');
    } finally {
      setActionLoading(null);
      actionInProgress.current = false;
    }
  };

  const handleShipment = async (orderId, shipmentStatus, trackingCode) => {
    setActionLoading(orderId + 'ship');
    try {
      const result = await updateOrderShipment(orderId, shopId, shipmentStatus, trackingCode || null);
      const code = (result && result.data && result.data.postal_tracking_code) || trackingCode || null;
      setAllOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, shipment_status: shipmentStatus, postal_tracking_code: code } : o))
      );
      setSelected((prev) =>
        prev && prev.id === orderId ? { ...prev, shipment_status: shipmentStatus, postal_tracking_code: code } : prev
      );
    } catch (err) {
      console.error(err);
      window.alert(err.message || 'به‌روزرسانی وضعیت ارسال ناموفق بود');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReceiptSaved = (orderId, url) => {
    setAllOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, receipt_url: url } : o))
    );
    setSelected((prev) =>
      prev && prev.id === orderId ? { ...prev, receipt_url: url } : prev
    );
  };

  const handleManualRefresh = () => {
    setNewCount(0);
    loadOrders();
  };

  const handleEnableNotifications = async () => {
    const result = await requestPermission();
    setNotifPermission(result);
  };

  const counts = FILTERS.reduce((acc, f) => {
    acc[f.key] = f.key === 'all' ? allOrders.length : allOrders.filter((o) => o.status === f.key).length;
    return acc;
  }, {});
  const visible = filter === 'all' ? allOrders : allOrders.filter((o) => o.status === filter);

  return (
    <div className="space-y-6">
      {notifPermission === 'default' && <NotifBanner onEnable={handleEnableNotifications} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">فیش‌ها و سفارشات</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm text-slate-500">
              مدیریت سفارشات و بررسی رسیدهای پرداخت
            </p>
            <LiveIndicator syncing={syncing} lastUpdated={lastUpdated} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <NotifStatusPill permission={notifPermission} onEnable={handleEnableNotifications} />
          {newCount > 0 && (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white text-xs font-bold rounded-xl animate-pulse">
              +{newCount} رسید جدید
            </span>
          )}
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            بروزرسانی
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all border ${
              filter === f.key
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label}
            <span
              className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                filter === f.key ? 'bg-white/20' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {counts[f.key] || 0}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 && !loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileCheck className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-slate-600 font-medium mb-1">سفارشی در این دسته وجود ندارد</h3>
          <p className="text-sm text-slate-400">سفارشات پس از ثبت در اینجا نمایش داده می‌شوند</p>
          <p className="text-xs text-slate-300 mt-3">بررسی خودکار هر ۱۵ ثانیه</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-right text-xs font-semibold text-slate-500 px-5 py-3">مشتری</th>
                  <th className="text-right text-xs font-semibold text-slate-500 px-5 py-3">محصول</th>
                  <th className="text-right text-xs font-semibold text-slate-500 px-5 py-3">تعداد</th>
                  <th className="text-right text-xs font-semibold text-slate-500 px-5 py-3">مبلغ کل</th>
                  <th className="text-right text-xs font-semibold text-slate-500 px-5 py-3">وضعیت</th>
                  <th className="text-right text-xs font-semibold text-slate-500 px-5 py-3">تاریخ</th>
                  <th className="text-center text-xs font-semibold text-slate-500 px-5 py-3">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => (
                  <tr
                    key={order.id}
                    className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${
                      selected && selected.id === order.id ? 'bg-primary-50/40' : ''
                    }`}
                  >
                    <td className="px-5 py-4">
                      <div className="text-sm text-slate-700 font-medium">{order.customer_name || 'مشتری'}</div>
                      <div className="text-xs text-slate-400 font-mono" dir="ltr">{order.user_id}</div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700 font-medium">{order.products?.name || '---'}</td>
                    <td className="px-5 py-4 text-sm text-slate-600">{order.quantity} عدد</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-800">{formatToman(order.total_price)}</td>
                    <td className="px-5 py-4"><StatusBadge status={order.status} /></td>
                    <td className="px-5 py-4 text-sm text-slate-500">{formatDate(order.created_at)}</td>
                    <td className="px-5 py-4 text-center">
                      <button
                        type="button"
                        onClick={() => { setSelected(order); setNewCount(0); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 text-primary-700 rounded-lg text-xs font-medium hover:bg-primary-100 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        جزئیات
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}

      {selected && (
        <ReceiptModal
          order={selected}
          onClose={() => setSelected(null)}
          onApprove={() => handleAction(selected.id, 'approve')}
          onReject={() => handleAction(selected.id, 'reject')}
          actionLoading={actionLoading}
          shopId={shopId}
          onReceiptSaved={handleReceiptSaved}
          onShipment={(status, code) => handleShipment(selected.id, status, code)}
        />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────

function NotifBanner({ onEnable }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-center justify-between gap-4 bg-primary-50 border border-primary-200 rounded-2xl px-5 py-3.5">
      <div className="flex items-center gap-3">
        <Bell className="w-4 h-4 text-primary-600 shrink-0" />
        <p className="text-sm text-primary-700">
          برای دریافت اعلان مرورگر هنگام ورود رسید جدید، اجازه دسترسی را فعال کنید.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onEnable}
          className="px-3 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-lg hover:bg-primary-700 transition-colors"
        >
          فعال‌سازی
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1.5 text-primary-400 hover:text-primary-600 transition-colors"
          aria-label="بستن"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function NotifStatusPill({ permission, onEnable }) {
  if (permission === 'unsupported') return null;
  if (permission === 'granted') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 text-xs font-medium rounded-xl border border-emerald-200">
        <Bell className="w-3.5 h-3.5" />
        اعلان‌ها فعال
      </span>
    );
  }
  if (permission === 'denied') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-400 text-xs font-medium rounded-xl" title="اعلان‌ها در مرورگر شما غیرفعال شده‌اند.">
        <BellOff className="w-3.5 h-3.5" />
        اعلان‌ها غیرفعال
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onEnable}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-600 text-xs font-medium rounded-xl border border-amber-200 hover:bg-amber-100 transition-colors"
    >
      <Bell className="w-3.5 h-3.5" />
      فعال‌سازی اعلان
    </button>
  );
}

function LiveIndicator({ syncing, lastUpdated }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const update = () => {
      if (!lastUpdated) return;
      const sec = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      if (sec < 5) setLabel('همین الان');
      else if (sec < 60) setLabel(`${sec} ثانیه پیش`);
      else setLabel(`${Math.floor(sec / 60)} دقیقه پیش`);
    };
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <span className={`w-1.5 h-1.5 rounded-full ${syncing ? 'bg-primary-400 animate-pulse' : 'bg-emerald-400'}`} />
      <Wifi className="w-3 h-3" />
      {label ? `آخرین بررسی: ${label}` : 'در حال اتصال...'}
    </span>
  );
}

function DetailRow({ icon: Icon, label, children }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-xs text-slate-500 flex items-center gap-1.5 shrink-0">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </span>
      <span className="text-sm text-slate-700 text-left">{children}</span>
    </div>
  );
}

function ShipmentSection({ order, onShipment, actionLoading }) {
  const [code, setCode] = useState(order.postal_tracking_code || '');
  const current = order.shipment_status || null;
  const busy = actionLoading === order.id + 'ship';
  const STEPS = [
    { key: 'packed', label: 'در حال بسته‌بندی', icon: Package },
    { key: 'shipped', label: 'ارسال شد', icon: Truck },
    { key: 'delivered', label: 'تحویل داده شد', icon: PackageCheck },
  ];
  return (
    <div className="border-t border-slate-100 pt-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Truck className="w-4 h-4 text-primary-600" />
        وضعیت ارسال سفارش
      </div>
      <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-50 text-sm">
        {current ? (
          <span className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-medium ${shipmentColors[current] || ''}`}>
            {shipmentLabels[current] || current}
          </span>
        ) : (
          <span className="text-slate-400">هنوز ارسال نشده — وضعیت را مشخص کنید</span>
        )}
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1.5">کد رهگیری پستی (اختیاری)</label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          dir="ltr"
          placeholder="کد رهگیری مرسوله..."
          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono focus:border-primary-400 focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {STEPS.map((s) => {
          const Icon = s.icon;
          const active = current === s.key;
          return (
            <button
              key={s.key}
              type="button"
              disabled={busy}
              onClick={() => onShipment(s.key, code)}
              className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl border text-xs font-medium transition-all disabled:opacity-50 active:scale-[0.98] ${active ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-primary-300 hover:bg-primary-50'}`}
            >
              <Icon className="w-4 h-4" />
              {s.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">
        با زدن «ارسال شد» یا «تحویل داده شد»، یک پیام خودکار برای مشتری در همان پیام‌رسان ارسال می‌شود. «بسته‌بندی» بدون اطلاع‌رسانی ثبت می‌گردد.
      </p>
    </div>
  );
}

function ReceiptModal({ order, onClose, onApprove, onReject, actionLoading, shopId, onReceiptSaved, onShipment }) {
  const isLoading =
    actionLoading === order.id + 'approve' || actionLoading === order.id + 'reject';
  const isPending = order.status === 'awaiting_approval' || order.status === 'pending_receipt';

  const [savingReceipt, setSavingReceipt] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const handleManualReceipt = async (url) => {
    if (!url) return;
    setUploadError('');
    setSavingReceipt(true);
    try {
      await updateOrderReceipt(order.id, shopId, url);
      onReceiptSaved(order.id, url);
    } catch (err) {
      console.error(err);
      setUploadError('\u0630\u062E\u06CC\u0631\u0647 \u0641\u06CC\u0634 \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F');
    } finally {
      setSavingReceipt(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-slate-800">جزئیات سفارش</h2>
            <StatusBadge status={order.status} />
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-100">
          <div className="flex-1 p-6 flex flex-col items-center justify-center min-h-[280px] bg-slate-50 gap-3">
            {order.receipt_url ? (
              <img
                src={order.receipt_url}
                alt="رسید بانکی"
                className="max-w-full max-h-[360px] rounded-xl object-contain shadow-sm"
                onError={(e) => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex'; }}
              />
            ) : null}
            <div className={`flex-col items-center justify-center text-slate-400 gap-3 ${order.receipt_url ? 'hidden' : 'flex'}`}>
              <ImageIcon className="w-12 h-12" />
              <span className="text-sm">تصویر رسید موجود نیست</span>
            </div>
            {order.receipt_url && (
              <a
                href={order.receipt_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                باز کردن تصویر در تب جدید
              </a>
            )}
            <div className="w-full pt-2">
              <p className="text-xs text-slate-400 mb-1.5 text-center">{'\u0622\u067E\u0644\u0648\u062F/\u062C\u0627\u06CC\u06AF\u0632\u06CC\u0646\u06CC \u062F\u0633\u062A\u06CC \u0641\u06CC\u0634'}</p>
              <ImageUpload value="" onChange={handleManualReceipt} folder="receipts" />
              {savingReceipt ? (
                <p className="text-xs text-primary-600 mt-1.5 text-center">{'\u062F\u0631 \u062D\u0627\u0644 \u0630\u062E\u06CC\u0631\u0647...'}</p>
              ) : null}
              {uploadError ? (
                <p className="text-xs text-danger-600 mt-1.5 text-center">{uploadError}</p>
              ) : null}
            </div>
          </div>

          <div className="flex-1 p-6 space-y-5">
            <div className="space-y-3">
              <DetailRow icon={User} label="نام مشتری">{order.customer_name || '---'}</DetailRow>
              <DetailRow label="شناسه کاربر"><span className="font-mono" dir="ltr">{order.user_id}</span></DetailRow>
              {order.phone && (
                <DetailRow icon={Phone} label="تلفن"><span dir="ltr">{order.phone}</span></DetailRow>
              )}
              {order.shipping_address && (
                <DetailRow icon={MapPin} label="آدرس">{order.shipping_address}</DetailRow>
              )}
              <div className="border-t border-slate-50" />
              <DetailRow label="محصول">{order.products?.name || '---'}</DetailRow>
              <DetailRow label="تعداد">{order.quantity} عدد</DetailRow>
              {(Number(order.discount_amount) > 0 || Number(order.points_value) > 0) ? (
                <>
                  <DetailRow label="جمع جزئ">{formatToman(order.total_price)}</DetailRow>
                  {Number(order.discount_amount) > 0 && (
                    <DetailRow icon={Ticket} label="تخفیف کوپن">
                      <span className="text-emerald-600 font-medium">
                        −{formatToman(order.discount_amount)}{order.coupon_code ? ` (${order.coupon_code})` : ''}
                      </span>
                    </DetailRow>
                  )}
                  {Number(order.points_value) > 0 && (
                    <DetailRow icon={Gift} label="امتیاز وفاداری">
                      <span className="text-amber-600 font-medium">
                        −{formatToman(order.points_value)}{Number(order.points_redeemed) > 0 ? ` (${formatToman(order.points_redeemed)} امتیاز)` : ''}
                      </span>
                    </DetailRow>
                  )}
                  <DetailRow label="مبلغ قابل پرداخت"><span className="font-bold text-slate-800">{formatToman(Math.max(0, Number(order.total_price || 0) - Number(order.discount_amount || 0) - Number(order.points_value || 0)))}</span></DetailRow>
                </>
              ) : (
                <DetailRow label="مبلغ کل"><span className="font-bold text-slate-800">{formatToman(order.total_price)}</span></DetailRow>
              )}
              {order.tracking_code && (
                <DetailRow icon={Hash} label="کد پیگیری"><span className="font-mono" dir="ltr">{order.tracking_code}</span></DetailRow>
              )}
              <DetailRow label="تاریخ سفارش">{formatDate(order.created_at)}</DetailRow>
            </div>

            {isPending ? (
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-success-600 hover:bg-success-500 text-white rounded-xl font-medium text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
                >
                  {actionLoading === order.id + 'approve' ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      تایید فیش و ثبت نهایی
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onReject}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-white border-2 border-danger-500 text-danger-600 hover:bg-danger-50 rounded-xl font-medium text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
                >
                  {actionLoading === order.id + 'reject' ? (
                    <div className="w-5 h-5 border-2 border-danger-200 border-t-danger-600 rounded-full animate-spin" />
                  ) : (
                    <>
                      <XCircle className="w-5 h-5" />
                      رد فیش / مغایرت مالی
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="border-t border-slate-100 pt-4 space-y-4">
                <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-50 text-sm text-slate-500">
                  {order.status === 'approved' ? (
                    <CheckCircle2 className="w-4 h-4 text-success-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-danger-600" />
                  )}
                  این سفارش قبلاً {statusLabels[order.status] || order.status} است
                </div>
                {order.status === 'approved' && (
                  <ShipmentSection order={order} onShipment={onShipment} actionLoading={actionLoading} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
