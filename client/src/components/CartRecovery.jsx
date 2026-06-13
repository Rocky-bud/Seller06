import { useState, useEffect, useCallback } from 'react';
import { useShop } from '../contexts/ShopContext';
import { fetchCartRecoveryStats, updateShop } from '../hooks/useApi';
import {
  ShoppingCart,
  Loader2,
  TrendingUp,
  BellRing,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

function formatFa(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('fa-IR');
}

/**
 * One-click "Abandoned-cart recovery" card.
 * Hides ALL background complexity (sweeps, delays, TTLs) behind a single switch
 * and shows three plain numbers: reminders sent, carts recovered, toman returned.
 */
export default function CartRecovery() {
  const { shopId, role } = useShop();
  const [enabled, setEnabled] = useState(false);
  const [stats, setStats] = useState({ nudgesSent: 0, recovered: 0, recoveredRevenue: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Only an owner can change settings; viewers/staff see it read-only.
  const canToggle = role === 'owner' || role == null;

  const load = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchCartRecoveryStats(shopId);
      setEnabled(!!data.enabled);
      setStats({
        nudgesSent: data.nudgesSent || 0,
        recovered: data.recovered || 0,
        recoveredRevenue: data.recoveredRevenue || 0,
      });
    } catch (err) {
      setError(err.message || 'خطا در دریافت وضعیت');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async () => {
    if (!shopId || saving || !canToggle) return;
    const next = !enabled;
    setSaving(true);
    setError('');
    setEnabled(next); // optimistic
    try {
      await updateShop(shopId, { cart_recovery_enabled: next });
    } catch (err) {
      setEnabled(!next); // revert on failure
      setError(err.message || 'خطا در ذخیره تغییرات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-50 rounded-xl flex items-center justify-center">
            <ShoppingCart className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-700">بازگرداندن سبدهای ناتمام</h3>
            <p className="text-xs text-slate-400 leading-5">
              اگر مشتری خرید را نیمه‌کاره رها کند، ربات خودکار یک یادآوری دوستانه برایش می‌فرستد.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={toggle}
          disabled={saving || loading || !canToggle}
          aria-pressed={enabled}
          title={canToggle ? '' : 'فقط مالک فروشگاه می‌تواند تغییر دهد'}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            enabled ? 'bg-success-600' : 'bg-slate-300'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? '-translate-x-6' : '-translate-x-1'
            }`}
          />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <>
          <div className="mt-4 text-xs">
            {enabled ? (
              <span className="inline-flex items-center gap-1.5 text-success-600 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                فعال است — یادآوری‌ها خودکار ارسال می‌شوند
              </span>
            ) : (
              <span className="text-slate-400">غیرفعال — برای روشن کردن، کلید را بزنید</span>
            )}
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 p-3 bg-danger-50 text-danger-600 rounded-xl text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <div className="flex items-center justify-center text-primary-600 mb-1">
                <BellRing className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-slate-800">{formatFa(stats.nudgesSent)}</p>
              <p className="text-[11px] text-slate-400">یادآوری ارسال‌شده</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <div className="flex items-center justify-center text-success-600 mb-1">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-slate-800">{formatFa(stats.recovered)}</p>
              <p className="text-[11px] text-slate-400">خرید بازگشته</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <div className="flex items-center justify-center text-warning-600 mb-1">
                <TrendingUp className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-slate-800">{formatFa(stats.recoveredRevenue)}</p>
              <p className="text-[11px] text-slate-400">تومان بازگشته</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
