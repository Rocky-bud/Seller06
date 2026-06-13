import { useState, useEffect, useCallback } from 'react';
import { useShop } from '../contexts/ShopContext';
import ImageUpload from '../components/ImageUpload';
import {
  fetchBroadcastAudienceCount,
  fetchBroadcasts,
  sendBroadcast,
  fetchProducts,
} from '../hooks/useApi';
import {
  Megaphone,
  Send,
  Users,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Image as ImageIcon,
  Link2,
} from 'lucide-react';

// Plain-language audience segments. No technical jargon — each option reads like
// a sentence a shopkeeper would say about their own customers.
const SEGMENTS = [
  { id: 'all', label: 'همه‌ی مخاطبان', hint: 'هر کسی که تا کنون با ربات گفتگو کرده' },
  { id: 'buyers', label: 'همه‌ی خریداران', hint: 'حداقل یک سفارش تأییدشده دارند' },
  { id: 'vip', label: 'مشتریان وفادار', hint: 'دو خرید تأییدشده یا بیشتر' },
  { id: 'recent', label: 'خریداران اخیر', hint: 'خرید در ۳۰ روز گذشته' },
  { id: 'dormant', label: 'مشتریان غیرفعال', hint: 'خرید داشته‌اند ولی نه در ۶۰ روز اخیر' },
  { id: 'leads', label: 'علاقه‌مندان بدون خرید', hint: 'پیام داده‌اند ولی هنوز خرید نکرده‌اند' },
  { id: 'product', label: 'علاقه‌مندان به یک محصول', hint: 'کسانی که آن محصول را سفارش داده‌اند' },
];

function faNum(n) {
  return (Number(n) || 0).toLocaleString('fa-IR');
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fa-IR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Broadcast() {
  const { shopId, role } = useShop();
  const canSend = role !== 'viewer';

  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [buttonLabel, setButtonLabel] = useState('');
  const [buttonUrl, setButtonUrl] = useState('');
  const [audience, setAudience] = useState('all');
  const [productId, setProductId] = useState('');

  const [products, setProducts] = useState([]);
  const [audienceCount, setAudienceCount] = useState(null);
  const [countLoading, setCountLoading] = useState(false);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const [history, setHistory] = useState([]);

  const isProductSegment = audience === 'product';
  const needsProduct = isProductSegment && !productId;

  const loadCount = useCallback(async () => {
    if (!shopId) return;
    if (audience === 'product' && !productId) {
      setAudienceCount(null);
      return;
    }
    setCountLoading(true);
    try {
      const data = await fetchBroadcastAudienceCount(
        shopId,
        audience,
        audience === 'product' ? productId : null,
      );
      setAudienceCount(data.count);
    } catch {
      setAudienceCount(null);
    } finally {
      setCountLoading(false);
    }
  }, [shopId, audience, productId]);

  const loadHistory = useCallback(async () => {
    if (!shopId) return;
    try {
      const rows = await fetchBroadcasts(shopId);
      setHistory(rows || []);
    } catch {
      setHistory([]);
    }
  }, [shopId]);

  const loadProducts = useCallback(async () => {
    if (!shopId) return;
    try {
      const rows = await fetchProducts(shopId);
      setProducts(rows || []);
    } catch {
      setProducts([]);
    }
  }, [shopId]);

  useEffect(() => {
    loadCount();
  }, [loadCount]);

  useEffect(() => {
    loadHistory();
    loadProducts();
  }, [loadHistory, loadProducts]);

  const handleSend = async () => {
    setError('');
    setResult(null);
    if (!message.trim()) {
      setError('متن پیام را وارد کنید.');
      return;
    }
    if (isProductSegment && !productId) {
      setError('یک محصول را برای هدف‌گیری انتخاب کنید.');
      return;
    }
    if (buttonUrl && !/^https?:\/\//i.test(buttonUrl)) {
      setError('آدرس دکمه باید با http یا https شروع شود.');
      return;
    }
    setSending(true);
    try {
      const data = await sendBroadcast(shopId, {
        message: message.trim(),
        imageUrl: imageUrl || null,
        buttonLabel: buttonLabel.trim() || null,
        buttonUrl: buttonUrl.trim() || null,
        audience,
        productId: isProductSegment ? productId : null,
      });
      setResult(data);
      setMessage('');
      setImageUrl('');
      setButtonLabel('');
      setButtonUrl('');
      loadHistory();
      loadCount();
    } catch (err) {
      setError(err.message || 'ارسال پیام ناموفق بود.');
    } finally {
      setSending(false);
    }
  };

  const segmentMeta = SEGMENTS.find((s) => s.id === audience) || SEGMENTS[0];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-primary-600 flex items-center justify-center">
          <Megaphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-800">پیام همگانی</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            یک پیام بنویسید و گروه دلخواه از مشتریان را هدف بگیرید
          </p>
        </div>
      </div>

      {/* Composer */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">متن پیام</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="مثلاً: سلام! تخفیف ویژه‌ی این هفته فعال شد 🎉 همین حالا محصولات جدید را ببینید."
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 resize-y"
          />
          <p className="text-xs text-slate-400 mt-1">
            یک خط «لغو دریافت پیام» به‌صورت خودکار به انتهای پیام افزوده می‌شود.
          </p>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
            <ImageIcon className="w-4 h-4 text-slate-400" />
            تصویر (اختیاری)
          </label>
          <ImageUpload value={imageUrl} onChange={setImageUrl} folder="broadcasts" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">متن دکمه (اختیاری)</label>
            <input
              type="text"
              value={buttonLabel}
              onChange={(e) => setButtonLabel(e.target.value)}
              placeholder="مثلاً: مشاهده‌ی فروشگاه"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
              <Link2 className="w-4 h-4 text-slate-400" />
              آدرس دکمه (اختیاری)
            </label>
            <input
              type="url"
              dir="ltr"
              value={buttonUrl}
              onChange={(e) => setButtonUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
            />
          </div>
        </div>

        {/* Audience segments */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">مخاطبان</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setAudience(s.id)}
                className={[
                  'text-right rounded-xl border px-4 py-3 transition-all',
                  audience === s.id
                    ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-100'
                    : 'border-slate-200 hover:border-slate-300 bg-white',
                ].join(' ')}
              >
                <span className="block text-sm font-semibold text-slate-800">{s.label}</span>
                <span className="block text-[11px] text-slate-400 mt-0.5 leading-relaxed">{s.hint}</span>
              </button>
            ))}
          </div>

          {/* Product picker (only for the product-interest segment) */}
          {isProductSegment && (
            <div className="mt-3">
              <label className="block text-sm font-semibold text-slate-700 mb-2">انتخاب محصول</label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
              >
                <option value="">— یک محصول انتخاب کنید —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Audience count + send */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Users className="w-4 h-4 text-slate-400" />
            {needsProduct ? (
              <span className="text-slate-400">ابتدا یک محصول را انتخاب کنید</span>
            ) : countLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            ) : (
              <span>
                <span className="font-bold text-slate-800">
                  {audienceCount == null ? '—' : faNum(audienceCount)}
                </span>{' '}
                گیرنده ({segmentMeta.label})
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={
              sending ||
              !canSend ||
              !message.trim() ||
              needsProduct ||
              audienceCount === 0
            }
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? 'در حال ارسال...' : 'ارسال پیام همگانی'}
          </button>
        </div>

        {!canSend && (
          <p className="text-xs text-amber-600">
            برای ارسال پیام همگانی به نقش «کارمند» یا «مالک» نیاز دارید.
          </p>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              پیام ارسال شد — {faNum(result.sent)} موفق
              {result.failed ? `، ${faNum(result.failed)} ناموفق` : ''}
              {result.skipped ? `، ${faNum(result.skipped)} رد‌شده` : ''} از مجموع{' '}
              {faNum(result.total)} گیرنده.
            </span>
          </div>
        )}
      </div>

      {/* History */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-sm font-bold text-slate-800 mb-4">پیام‌های ارسال‌شده‌ی اخیر</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">هنوز پیام همگانی ارسال نشده است.</p>
        ) : (
          <div className="space-y-3">
            {history.map((b) => (
              <div key={b.id} className="rounded-xl border border-slate-100 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-700 line-clamp-2 flex-1">{b.message}</p>
                  <span className="text-[11px] text-slate-400 shrink-0">{formatDate(b.created_at)}</span>
                </div>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                  <span className="text-emerald-600 font-medium">{faNum(b.sent_count)} موفق</span>
                  {b.failed_count > 0 && (
                    <span className="text-red-500">{faNum(b.failed_count)} ناموفق</span>
                  )}
                  <span className="text-slate-400">از {faNum(b.total_recipients)} گیرنده</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
