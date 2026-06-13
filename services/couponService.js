/**
 * couponService — discount-coupon engine.
 *
 * PHASE 6 · STEP 1 (Coupon engine + admin management)
 *
 * Pure, dependency-light helpers shared by the admin routes (and, in a later
 * step, the checkout flow in aiService). Reads use the service-role key so the
 * bot can validate a code without a logged-in user.
 *
 * A coupon is valid when ALL of the following hold:
 *   - it exists for the shop and is_active
 *   - now is within [starts_at, expires_at] (either bound may be null/open)
 *   - cart total >= min_cart_total
 *   - max_uses is null (unlimited) OR used_count < max_uses
 *
 * Discount is clamped so the final total can never go below zero.
 */
import { fetchWithRetry } from './httpRetry.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

export const DISCOUNT_TYPES = ['percent', 'fixed'];

async function supaFetch(pathAndQuery, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${pathAndQuery}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const res = await fetchWithRetry(url, { ...options, headers }, { label: 'supabase-coupons' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

/**
 * Compute the discount amount (in Toman) for a coupon against a cart total.
 * Always returns a non-negative integer no larger than the cart total.
 */
export function computeDiscount(coupon, cartTotal) {
  const total = Math.max(0, Number(cartTotal) || 0);
  if (!coupon) return 0;
  const value = Math.max(0, Number(coupon.discount_value) || 0);
  let discount = 0;
  if (coupon.discount_type === 'percent') {
    discount = Math.round((total * value) / 100);
  } else {
    discount = Math.round(value);
  }
  return Math.min(discount, total);
}

/**
 * Look up a single coupon by shop + code (case-insensitive).
 * Returns the row or null.
 */
export async function findCoupon(shopId, code) {
  if (!shopId || !code) return null;
  const rows =
    (await supaFetch(
      `coupons?shop_id=eq.${encodeURIComponent(shopId)}` +
        `&code=ilike.${encodeURIComponent(String(code).trim())}` +
        `&select=*&limit=1`,
    )) || [];
  return rows[0] || null;
}

/**
 * Validate a coupon code for a shop against a cart total.
 * @returns {Promise<{valid:boolean, reason?:string, coupon?:object, discount:number, finalTotal:number}>}
 */
export async function validateCoupon(shopId, code, cartTotal) {
  const total = Math.max(0, Number(cartTotal) || 0);
  const base = { valid: false, discount: 0, finalTotal: total };

  const coupon = await findCoupon(shopId, code);
  if (!coupon) {
    return { ...base, reason: 'کد تخفیف یافت نشد' };
  }
  if (!coupon.is_active) {
    return { ...base, reason: 'این کد تخفیف غیرفعال است' };
  }

  const now = Date.now();
  if (coupon.starts_at && now < new Date(coupon.starts_at).getTime()) {
    return { ...base, reason: 'هنوز زمان استفاده از این کد نرسیده است' };
  }
  if (coupon.expires_at && now > new Date(coupon.expires_at).getTime()) {
    return { ...base, reason: 'این کد تخفیف منقضی شده است' };
  }
  if (coupon.max_uses != null && Number(coupon.used_count) >= Number(coupon.max_uses)) {
    return { ...base, reason: 'ظرفیت استفاده از این کد به پایان رسیده است' };
  }
  if (total < Number(coupon.min_cart_total || 0)) {
    return {
      ...base,
      reason: `حداقل مبلغ سفارش برای این کد ${Number(coupon.min_cart_total).toLocaleString('fa-IR')} تومان است`,
    };
  }

  const discount = computeDiscount(coupon, total);
  if (discount <= 0) {
    return { ...base, coupon, reason: 'این کد روی این سفارش تخفیفی اعمال نمی‌کند' };
  }

  return {
    valid: true,
    coupon,
    discount,
    finalTotal: Math.max(0, total - discount),
  };
}

/**
 * Atomically bump used_count after a coupon is redeemed at checkout.
 * Fail-open: a counting error must never block an order.
 */
export async function incrementCouponUsage(couponId) {
  if (!couponId) return false;
  // Atomic, capped increment via RPC (migration 031): the DB enforces the
  // max_uses cap inside one guarded UPDATE, so concurrent checkouts can never
  // push used_count past the limit (lost-update safe). Falls back to the legacy
  // read-modify-write only when the RPC isn't installed yet (pre-migration).
  try {
    const result = await supaFetch('rpc/increment_coupon_usage', {
      method: 'POST',
      body: JSON.stringify({ p_coupon_id: couponId }),
    });
    const row = Array.isArray(result) ? result[0] : result;
    // ok:false (capacity_reached / not_found) is a benign no-op for the caller.
    return !!(row && row.ok === true);
  } catch (err) {
    const missingRpc = /increment_coupon_usage|PGRST202|404|could not find/i.test(err.message);
    if (!missingRpc) {
      console.warn('[couponService] incrementCouponUsage failed:', err.message);
      return false;
    }
    console.warn('[couponService] increment_coupon_usage RPC unavailable — using legacy path:', err.message);
    try {
      const rows =
        (await supaFetch(`coupons?id=eq.${encodeURIComponent(couponId)}&select=used_count`)) || [];
      const current = Number(rows[0]?.used_count || 0);
      await supaFetch(`coupons?id=eq.${encodeURIComponent(couponId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ used_count: current + 1 }),
      });
      return true;
    } catch (legacyErr) {
      console.warn('[couponService] incrementCouponUsage legacy fallback failed:', legacyErr.message);
      return false;
    }
  }
}

/**
 * Bug-fix #12 — atomically RELEASE a coupon use, e.g. when a merchant rejects an
 * order that had a coupon applied. Without this a rejected order permanently
 * burns a use, so the coupon hits max_uses early and blocks legitimate buyers.
 * Clamped at 0 (server-side GREATEST) so it can never go negative. Fail-open:
 * a counting error must never block the status change.
 */
export async function decrementCouponUsage(couponId) {
  if (!couponId) return false;
  // Atomic, clamped decrement via RPC (migration 032). Falls back to the legacy
  // read-modify-write (clamped at 0) only when the RPC isn't installed yet.
  try {
    const result = await supaFetch('rpc/decrement_coupon_usage', {
      method: 'POST',
      body: JSON.stringify({ p_coupon_id: couponId }),
    });
    const row = Array.isArray(result) ? result[0] : result;
    return !!(row && row.ok === true);
  } catch (err) {
    const missingRpc = /decrement_coupon_usage|PGRST202|404|could not find/i.test(err.message);
    if (!missingRpc) {
      console.warn('[couponService] decrementCouponUsage failed:', err.message);
      return false;
    }
    console.warn('[couponService] decrement_coupon_usage RPC unavailable — using legacy path:', err.message);
    try {
      const rows =
        (await supaFetch(`coupons?id=eq.${encodeURIComponent(couponId)}&select=used_count`)) || [];
      const current = Number(rows[0]?.used_count || 0);
      const next = Math.max(0, current - 1);
      await supaFetch(`coupons?id=eq.${encodeURIComponent(couponId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ used_count: next }),
      });
      return true;
    } catch (legacyErr) {
      console.warn('[couponService] decrementCouponUsage legacy fallback failed:', legacyErr.message);
      return false;
    }
  }
}
