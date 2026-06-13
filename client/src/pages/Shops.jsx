import { useState, useEffect, useCallback } from 'react';
import {
  Store, Plus, Bot, Webhook, Trash2, RefreshCw, Eye, EyeOff,
  CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp,
  CreditCard, X, Save, ExternalLink, Loader2, Globe, Power,
  KeyRound, Copy, UserPlus, Users
} from 'lucide-react';

// ── API helpers (all through Express, tokens never touch the client raw) ──────

async function apiGet(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data.data;
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data.data;
}

async function apiPatch(path, body) {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data.data;
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE' });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Request failed');
  return data.data;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Shops() {
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const loadShops = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('/api/shops');
      setShops(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadShops(); }, [loadShops]);

  const handleShopUpdated = (updated) => {
    setShops(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s));
  };

  const handleShopAdded = (newShop) => {
    setShops(prev => [...prev, newShop]);
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">مدیریت فروشگاه‌ها</h1>
          <p className="text-sm text-slate-500 mt-1">
            توکن ربات تلگرام هر فروشگاه را ثبت کنید و وب‌هوک را در یک کلیک فعال کنید
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-all active:scale-[0.98] shadow-sm"
        >
          <Plus className="w-4 h-4" />
          فروشگاه جدید
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-danger-50 border border-danger-200 rounded-2xl text-sm text-danger-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-primary-400 animate-spin" />
        </div>
      ) : shops.length === 0 ? (
        <EmptyState onAdd={() => setShowAddModal(true)} />
      ) : (
        <div className="space-y-4">
          {shops.map(shop => (
            <ShopCard
              key={shop.id}
              shop={shop}
              onUpdated={handleShopUpdated}
              onReload={loadShops}
            />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddShopModal
          onClose={() => setShowAddModal(false)}
          onAdded={handleShopAdded}
        />
      )}
    </div>
  );
}

// ── Shop card ─────────────────────────────────────────────────────────────────

function ShopCard({ shop, onUpdated, onReload }) {
  const [expanded, setExpanded] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState(null);
  const [webhookInfoLoading, setWebhookInfoLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [baseUrl, setBaseUrl] = useState(() => window.location.origin);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const [togglingActive, setTogglingActive] = useState(false);
  const isActive = shop.is_active !== false;

  const handleToggleActive = async () => {
    setTogglingActive(true);
    try {
      const updated = await apiPatch(`/api/shops/${shop.id}`, { is_active: !isActive });
      onUpdated({ ...shop, is_active: updated && updated.is_active !== undefined ? updated.is_active : !isActive });
      showToast(!isActive ? '\u0641\u0631\u0648\u0634\u06af\u0627\u0647 \u0641\u0639\u0627\u0644 \u0634\u062f' : '\u0641\u0631\u0648\u0634\u06af\u0627\u0647 \u063a\u06cc\u0631\u0641\u0639\u0627\u0644 \u0634\u062f');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setTogglingActive(false);
    }
  };

  const handleSaveToken = async () => {
    if (!token.trim()) return;
    setSavingToken(true);
    try {
      const updated = await apiPatch(`/api/shops/${shop.id}`, { telegram_token: token.trim() });
      onUpdated({ ...shop, has_token: true, telegram_token: updated.telegram_token, webhook_url: shop.webhook_url });
      setEditingToken(false);
      setToken('');
      showToast('توکن با موفقیت ذخیره شد');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingToken(false);
    }
  };

  const handleRemoveToken = async () => {
    setSavingToken(true);
    try {
      await apiPatch(`/api/shops/${shop.id}`, { telegram_token: '' });
      onUpdated({ ...shop, has_token: false, telegram_token: null, webhook_url: null });
      showToast('توکن حذف شد');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingToken(false);
    }
  };

  const handleRegisterWebhook = async () => {
    setWebhookLoading(true);
    try {
      const result = await apiPost(`/api/shops/${shop.id}/webhook`, { baseUrl });
      onUpdated({ ...shop, webhook_url: result.webhookUrl });
      showToast('وب‌هوک با موفقیت ثبت شد ✓');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleDeleteWebhook = async () => {
    setWebhookLoading(true);
    try {
      await apiDelete(`/api/shops/${shop.id}/webhook`);
      onUpdated({ ...shop, webhook_url: null });
      setWebhookInfo(null);
      showToast('وب‌هوک حذف شد');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleCheckWebhook = async () => {
    setWebhookInfoLoading(true);
    try {
      const info = await apiGet(`/api/shops/${shop.id}/webhook`);
      setWebhookInfo(info.result || info);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setWebhookInfoLoading(false);
    }
  };

  const botStatus = !shop.has_token
    ? { label: 'بدون توکن', color: 'bg-slate-100 text-slate-500', dot: 'bg-slate-300' }
    : shop.webhook_url
      ? { label: 'فعال', color: 'bg-emerald-50 text-emerald-600 border border-emerald-200', dot: 'bg-emerald-400 animate-pulse' }
      : { label: 'توکن ثبت شده', color: 'bg-amber-50 text-amber-600 border border-amber-200', dot: 'bg-amber-400' };

  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden transition-opacity ${isActive ? '' : 'opacity-60'}`}>
      {/* Card header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 bg-primary-50 rounded-xl flex items-center justify-center shrink-0">
            <Store className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-800">{shop.name}</h3>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${isActive ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                <Power className="w-3 h-3" />
                {isActive ? '\u0641\u0639\u0627\u0644' : '\u063a\u06cc\u0631\u0641\u0639\u0627\u0644'}
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${botStatus.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${botStatus.dot}`} />
                {botStatus.label}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 font-mono" dir="ltr">{shop.id}</p>
          </div>
        </div>

        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-2 px-3 py-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-all text-sm"
        >
          {expanded ? 'بستن' : 'مدیریت'}
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-slate-100 px-6 py-5 space-y-5 bg-slate-50/40">

          {/* Toast */}
          {toast && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${
              toast.type === 'error'
                ? 'bg-danger-50 text-danger-700 border border-danger-200'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}>
              {toast.type === 'error'
                ? <XCircle className="w-4 h-4 shrink-0" />
                : <CheckCircle2 className="w-4 h-4 shrink-0" />}
              {toast.msg}
            </div>
          )}

          {/* ── Section: Telegram Token ── */}
          <Section icon={Power} title={'\u0648\u0636\u0639\u06cc\u062a \u0641\u0631\u0648\u0634\u06af\u0627\u0647'}>
            <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
              <p className="text-xs text-slate-500 flex-1">{'\u0641\u0639\u0627\u0644 \u06cc\u0627 \u063a\u06cc\u0631\u0641\u0639\u0627\u0644 \u0628\u0648\u062f\u0646 \u0641\u0631\u0648\u0634\u06af\u0627\u0647 \u0631\u0627 \u06a9\u0646\u062a\u0631\u0644 \u06a9\u0646\u06cc\u062f'}</p>
              <button
                onClick={handleToggleActive}
                disabled={togglingActive}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 ${isActive ? 'bg-white border border-danger-200 text-danger-600 hover:bg-danger-50' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
              >
                {togglingActive ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                {isActive ? '\u063a\u06cc\u0631\u0641\u0639\u0627\u0644 \u06a9\u0631\u062f\u0646' : '\u0641\u0639\u0627\u0644 \u06a9\u0631\u062f\u0646'}
              </button>
            </div>
          </Section>

          <Section icon={Bot} title="توکن ربات تلگرام">
            {shop.has_token && !editingToken ? (
              <div className="flex items-center gap-3">
                <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2.5">
                  <Bot className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-sm font-mono text-slate-600 flex-1" dir="ltr">
                    {showToken ? shop.telegram_token : '●●●●●●●●●●' + (shop.telegram_token || '')}
                  </span>
                  <button onClick={() => setShowToken(v => !v)} className="text-slate-400 hover:text-slate-600">
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={() => setEditingToken(true)}
                  className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-all"
                >
                  تغییر
                </button>
                <button
                  onClick={handleRemoveToken}
                  disabled={savingToken}
                  className="px-3 py-2.5 bg-white border border-danger-200 text-danger-500 rounded-xl text-sm hover:bg-danger-50 transition-all disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">
                  توکن را از BotFather بگیرید — شکل آن مانند{' '}
                  <span dir="ltr" className="font-mono">7123456789:AAH...</span> است
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="123456789:AAH..."
                    dir="ltr"
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
                    onKeyDown={e => e.key === 'Enter' && handleSaveToken()}
                  />
                  <button onClick={() => setShowToken(v => !v)} className="text-slate-400 hover:text-slate-600 p-2">
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  {editingToken && (
                    <button
                      onClick={() => { setEditingToken(false); setToken(''); }}
                      className="p-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={handleSaveToken}
                    disabled={savingToken || !token.trim()}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-all disabled:opacity-50"
                  >
                    {savingToken ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    ذ��یره
                  </button>
                </div>
              </div>
            )}
          </Section>

          {/* ── Section: Webhook ── */}
          <Section icon={Webhook} title="ثبت وب‌هوک تلگرام">
            {!shop.has_token ? (
              <p className="text-sm text-slate-400 bg-slate-100 rounded-xl px-4 py-3">
                ابتدا توکن ربات را ذخیره کنید، سپس وب‌هوک را ثبت کنید.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500">آدرس پایه اپلیکیشن</label>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2">
                      <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                      <input
                        type="text"
                        value={baseUrl}
                        onChange={e => setBaseUrl(e.target.value)}
                        dir="ltr"
                        className="flex-1 text-sm font-mono text-slate-700 outline-none bg-transparent"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    وب‌هوک در{' '}
                    <span className="font-mono" dir="ltr">{baseUrl}/api/webhook/telegram/{shop.id}</span>
                    {' '}ثبت خواهد شد
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRegisterWebhook}
                    disabled={webhookLoading}
                    className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-all disabled:opacity-50 active:scale-[0.98]"
                  >
                    {webhookLoading
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Webhook className="w-4 h-4" />}
                    {shop.webhook_url ? 'به‌روزرسانی وب‌هوک' : 'ثبت وب‌هوک'}
                  </button>

                  {shop.webhook_url && (
                    <>
                      <button
                        onClick={handleCheckWebhook}
                        disabled={webhookInfoLoading}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50"
                      >
                        {webhookInfoLoading
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <RefreshCw className="w-4 h-4" />}
                        بررسی وضعیت
                      </button>
                      <button
                        onClick={handleDeleteWebhook}
                        disabled={webhookLoading}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-danger-200 text-danger-600 rounded-xl text-sm hover:bg-danger-50 transition-all disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        حذف وب‌هوک
                      </button>
                    </>
                  )}
                </div>

                {/* Registered webhook URL */}
                {shop.webhook_url && (
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="text-xs font-mono text-emerald-700 flex-1 break-all" dir="ltr">
                      {shop.webhook_url}
                    </span>
                    <a
                      href={`https://t.me/${shop.webhook_url.split('/').pop()}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-500 hover:text-emerald-700"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}

                {/* Webhook info panel */}
                {webhookInfo && (
                  <WebhookInfoPanel info={webhookInfo} onClose={() => setWebhookInfo(null)} />
                )}
              </div>
            )}
          </Section>

          {/* ── Section: Card number ── */}
          <Section icon={CreditCard} title="شماره کارت بانکی">
            <CardNumberEditor shopId={shop.id} current={shop.card_number} onUpdated={onUpdated} shopData={shop} />
          </Section>

          <Section icon={Users} title="اعضا و کدهای دسترسی">
            <MembersManager shopId={shop.id} />
          </Section>

        </div>
      )}
    </div>
  );
}

// ── Webhook info panel ────────────────────────────────────────────────────────

function WebhookInfoPanel({ info, onClose }) {
  const isActive = !!info.url;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs relative">
      <button onClick={onClose} className="absolute top-3 left-3 text-slate-400 hover:text-slate-600">
        <X className="w-3.5 h-3.5" />
      </button>
      <p className="font-semibold text-slate-600 mb-2">وضعیت وب‌هوک از تلگرام</p>
      <Row label="وضعیت" value={isActive ? '✅ فعال' : '⛔ ثبت نشده'} />
      {info.url && <Row label="آدرس" value={info.url} mono dir="ltr" />}
      {info.pending_update_count !== undefined && (
        <Row label="آپدیت‌های در صف" value={String(info.pending_update_count)} />
      )}
      {info.last_error_message && (
        <Row label="آخرین خطا" value={info.last_error_message} error />
      )}
      {info.last_error_date && (
        <Row label="تاریخ خطا" value={new Date(info.last_error_date * 1000).toLocaleString('fa-IR')} />
      )}
    </div>
  );
}

function Row({ label, value, mono, error }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-400 w-32 shrink-0">{label}:</span>
      <span className={`break-all ${mono ? 'font-mono' : ''} ${error ? 'text-danger-600' : 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  );
}

// ── Card number editor ────────────────────────────────────────────────────────

function CardNumberEditor({ shopId, current, onUpdated, shopData }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPatch(`/api/shops/${shopId}`, { card_number: value });
      onUpdated({ ...shopData, card_number: value });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      // silent
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-700" dir="ltr">
          {current || '—'}
        </div>
        <button
          onClick={() => setEditing(true)}
          className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-all"
        >
          {saved ? '✓ ذخیره شد' : 'ویرایش'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="6037-xxxx-xxxx-xxxx"
        dir="ltr"
        className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
        onKeyDown={e => e.key === 'Enter' && handleSave()}
      />
      <button onClick={() => setEditing(false)} className="p-2.5 text-slate-400 hover:text-slate-600">
        <X className="w-4 h-4" />
      </button>
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-all disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        ذخیره
      </button>
    </div>
  );
}

// ── Add shop modal ────────────────────────────────────────────────────────────

function AddShopModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ id: '', name: '', card_number: '', telegram_token: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [createdShop, setCreatedShop] = useState(null);
  const [ownerCode, setOwnerCode] = useState('');
  const [copied, setCopied] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.id.trim() || !form.name.trim()) {
      setError('شناسه و نام فروشگاه اجباری هستند');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const shop = await apiPost('/api/shops', form);
      if (shop && shop.ownerCode) {
        // Show the generated owner access code before closing so it can be copied.
        setCreatedShop(shop);
        setOwnerCode(shop.ownerCode);
      } else {
        onAdded(shop);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(ownerCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const handleFinish = () => {
    if (createdShop) onAdded(createdShop);
    else onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg"
        onClick={e => e.stopPropagation()}
      >
        {ownerCode ? (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800">فروشگاه ساخته شد ✓</h2>
              <button onClick={handleFinish} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              این «کد دسترسی مالک» را به صاحب فروشگاه بدهید. او با همین کد در صفحه ورود وارد می‌شود — نیازی به ساخت حساب در Supabase نیست.
            </p>
            <div className="flex items-center gap-2 bg-slate-900 rounded-2xl px-5 py-4 mb-3">
              <KeyRound className="w-5 h-5 text-indigo-400 shrink-0" />
              <span className="flex-1 text-2xl font-mono font-bold tracking-widest text-white text-center" dir="ltr">{ownerCode}</span>
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition-all"
              >
                {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'کپی شد' : 'کپی'}
              </button>
            </div>
            <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 mb-5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>این کد را ذخیره کنید. بعداً هم از بخش «اعضا و کدهای دسترسی» همان فروشگاه قابل مشاهده است.</span>
            </div>
            <button
              onClick={handleFinish}
              className="w-full py-3 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-all"
            >
              تمام
            </button>
          </div>
        ) : (
        <>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">افزودن فروشگاه جدید</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <Field label="شناسه فروشگاه" hint="مثال: shop-tehran-01 — بعد از ایجاد قابل تغییر نیست">
            <input
              value={form.id}
              onChange={e => set('id', e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="shop-tehran-01"
              dir="ltr"
              className="input-base font-mono"
            />
          </Field>

          <Field label="نام فروشگاه">
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="فروشگاه تهران"
              className="input-base"
            />
          </Field>

          <Field label="شماره کارت بانکی" hint="اختیاری — بعداً قابل ویرایش است">
            <input
              value={form.card_number}
              onChange={e => set('card_number', e.target.value)}
              placeholder="6037-xxxx-xxxx-xxxx"
              dir="ltr"
              className="input-base font-mono"
            />
          </Field>

          <Field label="توکن ربات تلگرام" hint="اختیاری — بعداً از صفحه مدیریت قابل افزودن است">
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={form.telegram_token}
                onChange={e => set('telegram_token', e.target.value)}
                placeholder="123456789:AAH..."
                dir="ltr"
                className="input-base font-mono pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 rounded-xl transition-all">
            انصراف
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            ایجاد فروشگاه
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function MembersManager({ shopId }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState('staff');
  const [newLabel, setNewLabel] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const ROLE_FA = { owner: 'صاحب فروشگاه', staff: 'کارمند', viewer: 'مشاهده‌گر' };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet(`/api/members?shopId=${encodeURIComponent(shopId)}`);
      setMembers(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const member = await apiPost('/api/members/code', { shopId, role: newRole, label: newLabel.trim() || null });
      setMembers(prev => [...prev, member]);
      setNewLabel('');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id) => {
    try {
      await apiDelete(`/api/members/${id}?shopId=${encodeURIComponent(shopId)}`);
      setMembers(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopy = async (member) => {
    try {
      await navigator.clipboard.writeText(member.access_code || '');
      setCopiedId(member.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        برای هر فرد یک کد بسازید و کد را به او بدهید. او با همان کد در صفحه ورود وارد می‌شود — بدون ساخت حساب در Supabase.
      </p>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-danger-50 border border-danger-200 rounded-xl text-xs text-danger-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-2">
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          placeholder="نام فرد (اختیاری)"
          className="flex-1 px-3 py-2 text-sm text-slate-700 outline-none bg-transparent"
        />
        <select
          value={newRole}
          onChange={e => setNewRole(e.target.value)}
          className="px-3 py-2 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg outline-none"
        >
          <option value="staff">کارمند</option>
          <option value="owner">صاحب فروشگاه</option>
        </select>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-all disabled:opacity-50"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          ساخت کد
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
        </div>
      ) : members.length === 0 ? (
        <p className="text-xs text-slate-400 bg-slate-100 rounded-xl px-4 py-3 text-center">هنوز عضوی اضافه نشده است</p>
      ) : (
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.id} className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-700 truncate">{m.label || ROLE_FA[m.role] || m.role}</span>
                  <span className="text-xs px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500">{ROLE_FA[m.role] || m.role}</span>
                </div>
                {m.access_code ? (
                  <span className="text-xs font-mono text-slate-500 tracking-wider" dir="ltr">{m.access_code}</span>
                ) : (
                  <span className="text-xs text-slate-400" dir="ltr">{m.email || '—'}</span>
                )}
              </div>
              {m.access_code && (
                <button
                  onClick={() => handleCopy(m)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg text-xs transition-all"
                >
                  {copiedId === m.id ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedId === m.id ? 'کپی شد' : 'کپی کد'}
                </button>
              )}
              <button
                onClick={() => handleRevoke(m.id)}
                className="p-1.5 text-danger-500 hover:bg-danger-50 rounded-lg transition-all"
                title="حذف دسترسی"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary-500" />
        <h4 className="text-sm font-semibold text-slate-700">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      {children}
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
      <div className="w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <Store className="w-8 h-8 text-primary-300" />
      </div>
      <h3 className="text-slate-600 font-medium mb-1">هنوز فروشگاهی ثبت نشده</h3>
      <p className="text-sm text-slate-400 mb-5">اولین فروشگاه را اضافه کنید و ربات تلگرام آن را متصل کنید</p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-all"
      >
        <Plus className="w-4 h-4" />
        افزودن فروشگاه
      </button>
    </div>
  );
}
