import { Router } from 'express';
import dotenv from 'dotenv';
import { requireShopRole } from '../middleware/auth.js';
import { recordAudit } from '../services/auditLog.js';
dotenv.config();

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...BASE_HEADERS, ...(options.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase error (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

// ── GET /api/products?shopId=SHOP-XXX ────────────────────────────────────────
router.get('/', requireShopRole('viewer'), async (req, res) => {
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });
  try {
    const products = await supaFetch(
      `products?shop_id=eq.${encodeURIComponent(shopId)}&select=*&order=created_at.asc`
    );
    res.json({ success: true, data: products || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/products ────────────────────────────────────────────────────────
router.post('/', requireShopRole('staff'), async (req, res) => {
  const { shopId, name, price, stock, description, image_url } = req.body;
  if (!shopId || !name?.trim()) {
    return res.status(400).json({ success: false, error: 'shopId و نام محصول الزامی هستند' });
  }
  try {
    const body = {
      shop_id: shopId,
      name: name.trim(),
      price: Math.max(0, Number(price) || 0),
      stock: Math.max(0, Math.floor(Number(stock) || 0)),
    };
    if (description !== undefined) body.description = description?.trim() || null;
    if (image_url !== undefined) body.image_url = image_url?.trim() || null;

    const data = await supaFetch('products', { method: 'POST', body: JSON.stringify(body) });
    const created = Array.isArray(data) ? data[0] : data;
    await recordAudit(req, { action: 'product.create', targetType: 'product', targetId: created?.id, shopId, metadata: { name: body.name } });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/products/:id ───────────────────────────────────────────────────
// shop_id is required in body — enforces strict ownership via DB filter.
router.patch('/:id', requireShopRole('staff'), async (req, res) => {
  const { id } = req.params;
  const { shopId, name, price, stock, description, image_url } = req.body;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (price !== undefined) updates.price = Math.max(0, Number(price) || 0);
  if (stock !== undefined) updates.stock = Math.max(0, Math.floor(Number(stock) || 0));
  if (description !== undefined) updates.description = description?.trim() || null;
  if (image_url !== undefined) updates.image_url = image_url?.trim() || null;

  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: 'هیچ فیلدی برای بروزرسانی ارسال نشده' });
  }

  try {
    // Double filter: id AND shop_id — cross-shop edits silently fail (no rows matched)
    const data = await supaFetch(
      `products?id=eq.${encodeURIComponent(id)}&shop_id=eq.${encodeURIComponent(shopId)}`,
      { method: 'PATCH', body: JSON.stringify(updates) }
    );
    const updated = Array.isArray(data) ? data[0] : data;
    await recordAudit(req, { action: 'product.update', targetType: 'product', targetId: id, shopId, metadata: { fields: Object.keys(updates) } });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/products/:id ──────────────────────────────────────────────────
router.delete('/:id', requireShopRole('owner'), async (req, res) => {
  const { id } = req.params;
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });
  try {
    await supaFetch(
      `products?id=eq.${encodeURIComponent(id)}&shop_id=eq.${encodeURIComponent(shopId)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    );
    await recordAudit(req, { action: 'product.delete', targetType: 'product', targetId: id, shopId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
