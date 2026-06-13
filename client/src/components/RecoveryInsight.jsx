import { useState, useEffect, useCallback } from 'react';
import { useShop } from '../contexts/ShopContext';
import { fetchCartRecoveryStats } from '../hooks/useApi';
import { ShoppingCart, TrendingUp, Loader2 } from 'lucide-react';

function faNum(n) {
  return (Number(n) || 0).toLocaleString('fa-IR');
}

/**
 * Dark-themed "recovered revenue" insight for the merchant dashboard.
 * Surfaces the ROI of abandoned-cart recovery front-and-center (total returned
 * revenue, carts recovered, success rate, last-7-days momentum) without any
 * technical jargon. Read-only — the on/off switch lives in Settings.
 */
export default function RecoveryInsight() {
  const { shopId } = useShop();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    try {
      const d = await fetchCartRecoveryStats(shopId);
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-2xl p-5 bg-[#0f1929] border border-white/10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/15">
            <ShoppingCart className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">بازگرداندن سبدهای ناتمام</h2>
            <p className="text-[11px] mt-0.5 text-white/50">درآمدی که با یادآوری خودکار به فروشگاه بازگشته است</p>
          </div>
        </div>
        {!loading && data && (
          <span
            className={`text-[11px] font-medium px-2.5 py-1 rounded-lg ${
              data.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-white/40'
            }`}
          >
            {data.enabled ? 'فعال' : 'غیرفعال'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-white/40">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : !data ? (
        <p className="text-xs text-white/40 py-4 text-center">اطلاعاتی برای نمایش نیست</p>
      ) : (
        <>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-extrabold text-white">{faNum(data.recoveredRevenue)}</span>
            <span className="text-xs text-white/50 mb-1">تومان بازگشته</span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl p-3 bg-white/[0.03] border border-white/10 text-center">
              <p className="text-base font-bold text-white">{faNum(data.recovered)}</p>
              <p className="text-[11px] text-white/45 mt-0.5">خرید بازگشته</p>
            </div>
            <div className="rounded-xl p-3 bg-white/[0.03] border border-white/10 text-center">
              <p className="text-base font-bold text-white">٪{faNum(data.recoveryRate)}</p>
              <p className="text-[11px] text-white/45 mt-0.5">نرخ موفقیت</p>
            </div>
            <div className="rounded-xl p-3 bg-white/[0.03] border border-white/10 text-center">
              <p className="inline-flex items-center justify-center gap-1 text-base font-bold text-emerald-400">
                <TrendingUp className="w-3.5 h-3.5" />
                {faNum(data.recoveredRevenue7d)}
              </p>
              <p className="text-[11px] text-white/45 mt-0.5">۷ روز اخیر (تومان)</p>
            </div>
          </div>

          {!data.enabled && (
            <p className="text-[11px] text-white/40 mt-4">
              برای روشن کردن این قابلیت، از صفحه‌ی «تنظیمات» کلید بازگرداندن سبد را فعال کنید.
            </p>
          )}
        </>
      )}
    </div>
  );
}
