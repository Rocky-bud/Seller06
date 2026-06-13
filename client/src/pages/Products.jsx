import { useState, useEffect, useCallback } from 'react';
import { useShop } from '../contexts/ShopContext';
import {
  fetchProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../hooks/useApi';
import { formatToman } from '../utils/helpers';
import ImageUpload from '../components/ImageUpload';
import {
  Package,
  RefreshCw,
  AlertTriangle,
  Box,
  Plus,
  Trash2,
  Check,
  X,
  Loader2,
} from 'lucide-react';

// Inline editor for a single numeric field (price / stock). Click the value to
// switch to an input; Enter or the check button saves, Escape cancels.
function InlineEdit({ value, type, display, displayClassName, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVal(value);
  }, [value]);

  const commit = async () => {
    const num =
      type === 'stock'
        ? Math.max(0, Math.floor(Number(val) || 0))
        : Math.max(0, Number(val) || 0);
    if (num === Number(value)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(num);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setVal(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={displayClassName}
        title="برای ویرایش کلیک کنید"
      >
        {display}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min="0"
        value={val}
        autoFocus
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
        className="w-24 px-2 py-1 text-xs border border-primary-200 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-primary-200"
        dir="ltr"
      />
      <button
        type="button"
        onClick={commit}
        disabled={saving}
        className="text-success-600 hover:text-success-700 p-1 disabled:opacity-50"
      >
        {saving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Check className="w-3.5 h-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={cancel}
        className="text-slate-400 hover:text-slate-600 p-1"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function ProductCard({ product, onDelete, onUpdate }) {
  const p = product;
  const iconWrap =
    p.stock > 3 ? 'bg-success-50' : p.stock > 0 ? 'bg-warning-50' : 'bg-danger-50';
  const iconColor =
    p.stock > 3
      ? 'text-success-600'
      : p.stock > 0
        ? 'text-warning-600'
        : 'text-danger-600';
  const badge =
    p.stock > 3
      ? 'bg-success-50 text-success-600'
      : p.stock > 0
        ? 'bg-warning-50 text-warning-600'
        : 'bg-danger-50 text-danger-600';

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {p.image_url ? (
        <img src={p.image_url} alt="" className="w-full h-36 object-cover" />
      ) : null}
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconWrap}`}>
              <Box className={`w-5 h-5 ${iconColor}`} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{p.name}</h3>
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                {p.description || 'بدون توضیحات'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDelete(p.id)}
            className="text-slate-300 hover:text-danger-600 transition-colors p-1"
            title="حذف محصول"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2.5 pt-3 border-t border-slate-50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">قیمت</span>
            <InlineEdit
              value={p.price}
              type="price"
              display={formatToman(p.price)}
              displayClassName="text-sm font-bold text-slate-800 hover:text-primary-600 transition-colors cursor-pointer"
              onSave={(v) => onUpdate(p.id, 'price', v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">موجودی انبار</span>
            <div className="flex items-center gap-1.5">
              {p.stock <= 3 && p.stock > 0 && (
                <AlertTriangle className="w-3.5 h-3.5 text-warning-500" />
              )}
              <InlineEdit
                value={p.stock}
                type="stock"
                display={p.stock > 0 ? `${p.stock} عدد` : 'ناموجود'}
                displayClassName={`text-xs font-medium px-2 py-1 rounded-lg cursor-pointer hover:opacity-80 ${badge}`}
                onSave={(v) => onUpdate(p.id, 'stock', v)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddProductModal({ shopId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('نام محصول الزامی است');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await createProduct(shopId, {
        name: name.trim(),
        price: Math.max(0, Number(price) || 0),
        stock: Math.max(0, Math.floor(Number(stock) || 0)),
        description: description.trim() || null,
        image_url: imageUrl || null,
      });
      onCreated(created);
    } catch (err) {
      console.error(err);
      setError('ثبت محصول ناموفق بود');
      setSaving(false);
    }
  };

  const field =
    'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-600';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-slate-800">افزودن محصول جدید</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">نام محصول *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={field}
              placeholder="مثلاً تیشرت نخی"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">قیمت (تومان)</label>
              <input
                type="number"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={field}
                placeholder="0"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">موجودی انبار</label>
              <input
                type="number"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className={field}
                placeholder="0"
                dir="ltr"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">توضیحات</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${field} resize-none`}
              rows={3}
              placeholder="توضیحات اختیاری محصول"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{'\u062A\u0635\u0648\u06CC\u0631 \u0645\u062D\u0635\u0648\u0644 (\u0627\u062E\u062A\u06CC\u0627\u0631\u06CC)'}</label>
            <ImageUpload value={imageUrl} onChange={setImageUrl} folder="products" />
          </div>

          {error && <p className="text-xs text-danger-600">{error}</p>}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              ثبت محصول
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-xl transition-all"
            >
              انصراف
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Products() {
  const { shopId } = useShop();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchProducts(shopId);
      setProducts(data || []);
    } catch (err) {
      console.error(err);
      setError('خطا در دریافت لیست محصولات');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreated = (product) => {
    if (product) setProducts((prev) => [...prev, product]);
    setShowAdd(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('این محصول حذف شود؟')) return;
    const prev = products;
    setProducts((list) => list.filter((x) => x.id !== id));
    try {
      await deleteProduct(id, shopId);
    } catch (err) {
      console.error(err);
      setProducts(prev);
      window.alert('حذف محصول ناموفق بود');
    }
  };

  const handleQuickUpdate = async (id, field, value) => {
    const prev = products;
    setProducts((list) =>
      list.map((x) => (x.id === id ? { ...x, [field]: value } : x))
    );
    try {
      const updated = await updateProduct(id, shopId, { [field]: value });
      if (updated) {
        setProducts((list) =>
          list.map((x) => (x.id === id ? { ...x, ...updated } : x))
        );
      }
    } catch (err) {
      console.error(err);
      setProducts(prev);
      window.alert('بروزرسانی ناموفق بود');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">مدیریت محصولات</h1>
          <p className="text-sm text-slate-500 mt-1">لیست محصولات و موجودی انبار</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            بروزرسانی
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-medium transition-all"
          >
            <Plus className="w-4 h-4" />
            افزودن محصول
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger-50 text-danger-600 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {products.length === 0 && !loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-slate-600 font-medium mb-1">محصولی ثبت نشده است</h3>
          <p className="text-sm text-slate-400 mb-5">
            اولین محصول فروشگاه خود را اضافه کنید
          </p>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-medium transition-all"
          >
            <Plus className="w-4 h-4" />
            افزودن محصول
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onDelete={handleDelete}
              onUpdate={handleQuickUpdate}
            />
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}

      {showAdd && (
        <AddProductModal
          shopId={shopId}
          onClose={() => setShowAdd(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
