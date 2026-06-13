/**
 * routes/coupons — admin endpoints for discount coupons.
 *
 * PHASE 6 · STEP 1 (Coupon engine + admin management)
 *
 *   GET    /api/coupons?shopId=SHOP-XXX     -> list coupons (viewer)
 *   POST   /api/coupons                     -> create a coupon (staff)
 *   PATCH  /api/coupons/:id                 -> edit / toggle a coupon (staff)
 *   DELETE /api/coupons/:id?shopId=SHOP-XXX -> delete a coupon (staff)
 *   POST   /api/coupons/validate            -> preview a code against a total (viewer)
 *
 * Mounted behind authenticateUser; each route is gated by requireShopRole.
 * Writes use the service-role key (bypasses RLS); shop scope is enforced by
 * requireShopRole + an explicit shop_id filter on every query.
 */
import { Router } from 'express';
import dotenv from 'dotenv';
import { requireShopRole } from '../middleware/auth.js';
import { recordAudit } from '../services/auditLog.js';
import { validateCoupon, DISCOUNT_TYPES } from '../services/couponService.js';
dotenv.config();

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

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

// Normalize + validate a coupon payload coming from the admin panel.
function sanitizeCouponInput(body = {}) {
  const code = String(body.code || '').trim();
  const discount_type = DISCOUNT_TYPES.includes(body.discount_type)
    ? body.discount_type
    : 'percent';
  let discount_value = Math.max(0, Number(body.discount_value) || 0);
  if (discount_type === 'percent') discount_value = Math.min(100, discount_value);

  return {
    code,
    discount_type,
    discount_value,
    min_cart_total: Math.max(0, Number(body.min_cart_total) || 0),
    max_uses:
      body.max_uses === '' || body.max_uses == null
        ? null
        : Math.max(1, parseInt(body.max_uses, 10) || 1),
    expires_at: body.expires_at ? new Date(body.expires_at).toISOString() : null,
    is_active: body.is_active === undefined ? true : !!body.is_active,
  };
}

// ── GET /api/coupons?shopId=SHOP-XXX ────────────────────────────────────
router.get('/', requireShopRole('viewer'), async (req, res) => {
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });
  try {
    const coupons = await supaFetch(
      `coupons?shop_id=eq.${encodeURIComponent(shopId)}&select=*&order=created_at.desc`,
    );
    res.json({ success: true, data: coupons || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/coupons ──────────────────────────────────────────
router.post('/', requireShopRole('staff'), async (req, res) => {
  const shopId = req.body?.shopId;
  const input = sanitizeCouponInput(req.body);
  if (!shopId || !input.code) {
    return res.status(400).json({ success: false, error: 'shopId و کد تخفیف الزامی هستند' });
  }
  if (input.discount_value <= 0) {
    return res.status(400).json({ success: false, error: 'مقدار تخفیف باید بزرگ‌تر از صفر باشد' });
  }
  try {
    const created = await supaFetch('coupons', {
      method: 'POST',
      body: JSON.stringify({ shop_id: shopId, ...input }),
    });
    const row = Array.isArray(created) ? created[0] : created;
    await recordAudit(req, {
      action: 'coupon.create',
      targetType: 'coupon',
      targetId: row?.id,
      shopId,
      metadata: { code: input.code, type: input.discount_type, value: input.discount_value },
    });
    res.json({ success: true, data: row });
  } catch (err) {
    if (/duplicate key|unique/i.test(err.message)) {
      return res.status(409).json({ success: false, error: 'یک کد تخفیف با همین نام وجود دارد' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/coupons/:id ──────────────────────────────────────
router.patch('/:id', requireShopRole('staff'), async (req, res) => {
  const shopId = req.body?.shopId;
  const { id } = req.params;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });

  // Allow partial updates: only fields present in the body are touched.
  const patch = {};
  if (req.body.code !== undefined) patch.code = String(req.body.code || '').trim();
  if (req.body.discount_type !== undefined && DISCOUNT_TYPES.includes(req.body.discount_type)) {
    patch.discount_type = req.body.discount_type;
  }
  if (req.body.discount_value !== undefined) {
    let v = Math.max(0, Number(req.body.discount_value) || 0);
    if ((patch.discount_type || req.body.discount_type) === 'percent') v = Math.min(100, v);
    patch.discount_value = v;
  }
  if (req.body.min_cart_total !== undefined) {
    patch.min_cart_total = Math.max(0, Number(req.body.min_cart_total) || 0);
  }
  if (req.body.max_uses !== undefined) {
    patch.max_uses =
      req.body.max_uses === '' || req.body.max_uses == null
        ? null
        : Math.max(1, parseInt(req.body.max_uses, 10) || 1);
  }
  if (req.body.expires_at !== undefined) {
    patch.expires_at = req.body.expires_at ? new Date(req.body.expires_at).toISOString() : null;
  }
  if (req.body.is_active !== undefined) patch.is_active = !!req.body.is_active;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ success: false, error: 'هیچ تغییری ارسال نشد' });
  }
  try {
    const updated = await supaFetch(
      `coupons?id=eq.${encodeURIComponent(id)}&shop_id=eq.${encodeURIComponent(shopId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
    const row = Array.isArray(updated) ? updated[0] : updated;
    if (!row) return res.status(404).json({ success: false, error: 'کد تخفیف یافت نشد' });
    await recordAudit(req, {
      action: 'coupon.update',
      targetType: 'coupon',
      targetId: id,
      shopId,
      metadata: { fields: Object.keys(patch) },
    });
    res.json({ success: true, data: row });
  } catch (err) {
    if (/duplicate key|unique/i.test(err.message)) {
      return res.status(409).json({ success: false, error: 'یک کد تخفیف با همین نام وجود دارد' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/coupons/:id?shopId=SHOP-XXX ────────────────────────────
router.delete('/:id', requireShopRole('staff'), async (req, res) => {
  const shopId = req.query.shopId;
  const { id } = req.params;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });
  try {
    await supaFetch(
      `coupons?id=eq.${encodeURIComponent(id)}&shop_id=eq.${encodeURIComponent(shopId)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
    );
    await recordAudit(req, {
      action: 'coupon.delete',
      targetType: 'coupon',
      targetId: id,
      shopId,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/coupons/validate ───────────────────────────────────
router.post('/validate', requireShopRole('viewer'), async (req, res) => {
  const { shopId, code, cartTotal } = req.body || {};
  if (!shopId || !code) {
    return res.status(400).json({ success: false, error: 'shopId و کد تخفیف الزامی هستند' });
  }
  try {
    const result = await validateCoupon(shopId, code, cartTotal);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
