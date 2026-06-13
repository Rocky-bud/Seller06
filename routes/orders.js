import { Router } from 'express';
import dotenv from 'dotenv';
import { restoreStock } from '../services/aiService.js';
import { persistImageFromUrl } from '../services/storageService.js';
import { requireShopRole } from '../middleware/auth.js';
import { recordAudit } from '../services/auditLog.js';
import { updateShipment, SHIPMENT_STATES } from '../services/shipmentService.js';
import { accruePointsForOrder, refundRedeemedPoints } from '../services/loyaltyService.js';
import { findCoupon, decrementCouponUsage } from '../services/couponService.js'; // Bug-fix #12: reverse coupon usage on reject

dotenv.config();

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase error (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

// Phase 6 / Step 3a: grant loyalty points when a paid order is confirmed.
// Best-effort + idempotent (ledger unique 'earn'-per-order index); a failure
// here must NEVER block the confirmation that already succeeded.
async function accrueOrderLoyalty(orderId, shopId) {
  try {
    const rows = await supaFetch(
      `orders?id=eq.${encodeURIComponent(orderId)}&shop_id=eq.${encodeURIComponent(shopId)}&select=user_id,total_price,discount_amount,points_value&limit=1`
    );
    const order = rows?.[0];
    if (!order?.user_id) return;
    // Bug-fix #3: earn points only on the CASH actually paid. Subtract BOTH the
    // coupon discount AND the value covered by redeemed points — otherwise the
    // customer earns points on the portion they paid WITH points (points on
    // points), which slowly inflates balances. points_value is 0 for orders
    // without redemption, so this is a no-op for the common case.
    const amountPaid = Math.max(
      0,
      Number(order.total_price || 0) - Number(order.discount_amount || 0) - Number(order.points_value || 0)
    );
    const result = await accruePointsForOrder({ shopId, userId: order.user_id, orderId, amountPaid });
    if (result?.accrued) {
      console.log(`[orders/confirm] loyalty +${result.points} pts → user ${order.user_id} (balance ${result.balance})`);
    }
  } catch (err) {
    console.warn('[orders/confirm] loyalty accrual failed (non-fatal):', err.message);
  }
}

// ── GET /api/orders/shop?shopId=SHOP-XXX ─────────────────────────────────────
// Lists ALL orders for a shop — used by merchant dashboard
router.get('/shop', requireShopRole('viewer'), async (req, res) => {
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });
  try {
    const data = await supaFetch(
      `orders?shop_id=eq.${encodeURIComponent(shopId)}&select=id,user_id,customer_name,shipping_address,phone,product_id,quantity,total_price,coupon_code,discount_amount,points_redeemed,points_value,status,receipt_url,shipment_status,postal_tracking_code,platform,created_at,products(name,price)&order=created_at.desc`
    );
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/orders/user/:userId ──────────────────────────────────────────────
// Gets orders for a specific customer (used by bot)
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const shopId = req.query.shopId;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'Missing userId parameter' });
    }

    let url = `${SUPABASE_URL}/rest/v1/orders?select=*,products(name,price)&user_id=eq.${userId}`;
    if (shopId) url += `&shop_id=eq.${shopId}`;
    url += '&order=created_at.desc';

    const response = await fetch(url, { headers: HEADERS });
    const orders = await response.json();

    if (!response.ok) {
      return res.status(500).json({ success: false, error: orders.message || 'Failed to fetch orders' });
    }

    return res.json({ success: true, userId, count: orders.length, data: orders });
  } catch (err) {
    console.error('Error in orders/user/:userId:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/orders/:orderId/confirm ────────────────────────────────────────
// Confirms payment: sets status → approved AND decreases product stock
router.patch('/:orderId/confirm', requireShopRole('staff'), async (req, res) => {
  const { orderId } = req.params;
  const { shopId } = req.body;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });

  try {
    // STAGE 35: atomic + idempotent confirmation via the confirm_order() RPC
    // (migration 019). It locks the order + product rows and decrements stock
    // inside ONE transaction, so concurrent approvals from Telegram + Instagram
    // can never oversell the last unit or double-deduct the same order.
    let rpc = null;
    let rpcAvailable = true;
    try {
      rpc = await supaFetch('rpc/confirm_order', {
        method: 'POST',
        body: JSON.stringify({ p_order_id: orderId, p_shop_id: shopId }),
      });
    } catch (rpcErr) {
      // If the function isn't installed yet (migration 019 not run), gracefully
      // fall back to the legacy path so the dashboard keeps working pre-migration.
      if (/confirm_order|PGRST202|404|could not find/i.test(rpcErr.message)) {
        rpcAvailable = false;
        console.warn('[orders/confirm] confirm_order RPC unavailable — using legacy path:', rpcErr.message);
      } else {
        throw rpcErr;
      }
    }

    if (rpcAvailable) {
      const result = Array.isArray(rpc) ? rpc[0] : rpc;
      if (!result || result.ok !== true) {
        const code = result?.code;
        if (code === 'not_found') {
          return res.status(404).json({ success: false, error: 'سفارش یافت نشد یا متعلق به این فروشگاه نیست' });
        }
        if (code === 'already_approved') {
          return res.status(409).json({ success: false, error: 'این سفارش قبلاً تأیید شده است' });
        }
        if (code === 'insufficient_stock') {
          return res.status(409).json({ success: false, error: 'موجودی این محصول کافی نیست (احتمالاً آخرین واحد فروخته شده است)' });
        }
        return res.status(400).json({ success: false, error: 'تأیید سفارش ناموفق بود' });
      }
      await recordAudit(req, { action: 'order.confirm', targetType: 'order', targetId: orderId, shopId, metadata: { via: 'rpc', stock: result.stock } });
      await accrueOrderLoyalty(orderId, shopId);
      return res.json({ success: true, orderId, status: 'approved', stock: result.stock });
    }

    // ── Legacy fallback (best-effort, guarded) — only used until migration 019 is run ──
    // Bug-fix #13: true atomicity requires the confirm_order() RPC (migration 019).
    // This hardened path (a) refuses to approve when stock is insufficient instead
    // of silently clamping to 0, and (b) uses an optimistic compare-and-swap on
    // products.stock so two concurrent confirms can no longer oversell the last
    // unit or double-deduct. Stock is decremented FIRST; the order is approved
    // only AFTER a successful deduction.
    const orders = await supaFetch(
      `orders?id=eq.${encodeURIComponent(orderId)}&shop_id=eq.${encodeURIComponent(shopId)}&select=id,product_id,quantity,status&limit=1`
    );
    if (!orders?.length) {
      return res.status(404).json({ success: false, error: 'سفارش یافت نشد یا متعلق به این فروشگاه نیست' });
    }
    const order = orders[0];
    if (order.status === 'approved') {
      return res.status(409).json({ success: false, error: 'این سفارش قبلاً تأیید شده است' });
    }

    // Bug-fix #13: guarded optimistic-concurrency (CAS) stock decrement.
    const needQty = Number(order.quantity) || 0;
    let productExists = false;
    let stockDeducted = false;
    let finalStock = null;
    for (let attempt = 0; attempt < 3 && !stockDeducted; attempt++) {
      const products = await supaFetch(
        `products?id=eq.${encodeURIComponent(order.product_id)}&select=id,stock&limit=1`
      );
      if (!products?.length) { productExists = false; break; }
      productExists = true;
      const curStock = Number(products[0].stock) || 0;
      if (curStock < needQty) {
        return res.status(409).json({ success: false, error: 'موجودی این محصول کافی نیست (احتمالاً آخرین واحد فروخته شده است)' });
      }
      // Compare-and-swap: the PATCH only matches while stock is still exactly
      // what we read, so a racing confirm that already moved stock makes this
      // a no-op (empty array) and we retry with a fresh read.
      const swapped = await supaFetch(
        `products?id=eq.${encodeURIComponent(order.product_id)}&stock=eq.${curStock}`,
        { method: 'PATCH', body: JSON.stringify({ stock: curStock - needQty }) }
      );
      if (Array.isArray(swapped) && swapped.length) {
        stockDeducted = true;
        finalStock = curStock - needQty;
      }
    }
    if (productExists && !stockDeducted) {
      return res.status(409).json({ success: false, error: 'تأیید همزمان دیگری در حال انجام است؛ لطفاً دوباره تلاش کنید' });
    }

    const updated = await supaFetch(
      `orders?id=eq.${encodeURIComponent(orderId)}&shop_id=eq.${encodeURIComponent(shopId)}`,
      { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) }
    );
    const result = Array.isArray(updated) ? updated[0] : updated;
    await recordAudit(req, { action: 'order.confirm', targetType: 'order', targetId: orderId, shopId, metadata: { via: 'legacy', stock: finalStock } });
    await accrueOrderLoyalty(orderId, shopId);
    return res.json({ success: true, orderId, status: 'approved', stock: finalStock, data: result });
  } catch (err) {
    console.error('Error in orders/:orderId/confirm:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/orders/:orderId/status ─────────────────────────────────────────
// Generic status update — restores stock automatically when rejecting
router.patch('/:orderId/status', requireShopRole('staff'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, shopId } = req.body;
    if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });

    const allowed = ['approved', 'rejected', 'awaiting_approval', 'pending_receipt'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${allowed.join(', ')}` });
    }

    // Bug-fix #7 (security / cross-shop IDOR): scope the update to the caller's
    // shop. requireShopRole('staff') only verifies the role for req.body.shopId,
    // so without a shop_id filter a staffer of one shop could flip the status of
    // ANY order in the database just by knowing its orderId. Bind the PATCH to
    // shop_id (matching /confirm) and 404 when nothing matched.
    // Bug-fix #12: capture the order's prior state BEFORE flipping it, so the
    // reject-side reversals (stock, loyalty points, coupon usage) each run at
    // most once. Re-rejecting an already-rejected order must not double-restore
    // stock or double-reverse a coupon. coupon_code is read here too (it is not
    // changed by the status PATCH).
    let prevStatus = null;
    let couponCode = null;
    try {
      const prevRows = await supaFetch(
        `orders?id=eq.${encodeURIComponent(orderId)}&shop_id=eq.${encodeURIComponent(shopId)}&select=status,coupon_code&limit=1`
      );
      prevStatus = prevRows?.[0]?.status ?? null;
      couponCode = prevRows?.[0]?.coupon_code ?? null;
    } catch (prevErr) {
      console.warn('[orders/status] prior-state read failed (non-fatal):', prevErr.message);
    }

    const url = `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&shop_id=eq.${encodeURIComponent(shopId)}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ status })
    });
    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ success: false, error: data.message || 'Failed to update order status' });
    }
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ success: false, error: 'سفارش یافت نشد یا متعلق به این فروشگاه نیست' });
    }

    // Restore stock when an order is rejected — Bug-fix #12: only when the order
    // was not ALREADY rejected, so a re-reject can't double-restore stock or
    // double-reverse the coupon. (null prevStatus = read failed → fail-open.)
    if (status === 'rejected' && prevStatus !== 'rejected') {
      await restoreStock(orderId);
      // Bug-fix #2: also return any loyalty points the customer spent on this
      // order. A rejected order must never silently consume the points debited
      // at checkout. Best-effort + idempotent (per-order 'adjust' ledger guard),
      // so it can never block the status change.
      try {
        const rows = await supaFetch(
          `orders?id=eq.${encodeURIComponent(orderId)}&select=user_id,shop_id,points_redeemed&limit=1`
        );
        const ord = rows?.[0];
        const reserved = Number(ord?.points_redeemed || 0);
        if (ord?.user_id && ord?.shop_id && reserved > 0) {
          await refundRedeemedPoints({ shopId: ord.shop_id, userId: ord.user_id, orderId, points: reserved });
        }
      } catch (refundErr) {
        console.warn('[orders/status] loyalty refund on reject failed (non-fatal):', refundErr.message);
      }
      // Bug-fix #12: release the coupon use this order consumed. used_count is
      // bumped when the order reaches awaiting_approval (receipt uploaded), so we
      // only reverse it when the prior state was a post-increment one
      // (awaiting_approval / approved). Otherwise the coupon was never counted
      // for this order and decrementing would wrongly free a use from the shared
      // counter. Best-effort + clamped at 0 server-side.
      try {
        if (couponCode && (prevStatus === 'awaiting_approval' || prevStatus === 'approved')) {
          const coupon = await findCoupon(shopId, couponCode);
          if (coupon?.id) await decrementCouponUsage(coupon.id);
        }
      } catch (couponErr) {
        console.warn('[orders/status] coupon usage reversal on reject failed (non-fatal):', couponErr.message);
      }
    }

    await recordAudit(req, { action: 'order.status_change', targetType: 'order', targetId: orderId, shopId: req.body?.shopId || null, metadata: { status } });
    return res.json({ success: true, orderId, status, data });
  } catch (err) {
    console.error('Error in orders/:orderId/status:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ---- PATCH /api/orders/:orderId/shipment ----
// Phase 5 Step 1: update shipment status (packed -> shipped -> delivered) and
// an optional postal tracking code. The customer is notified automatically on
// their original channel (Telegram / Instagram) for shipped + delivered.
router.patch('/:orderId/shipment', requireShopRole('staff'), async (req, res) => {
  const { orderId } = req.params;
  const { shopId, shipment_status, tracking_code } = req.body || {};
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A' });
  if (!SHIPMENT_STATES.includes(shipment_status)) {
    return res.status(400).json({ success: false, error: `\u0648\u0636\u0639\u06CC\u062A \u0627\u0631\u0633\u0627\u0644 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A. \u0628\u0627\u06CC\u062F \u06CC\u06A9\u06CC \u0627\u0632 \u0627\u06CC\u0646 \u0645\u0648\u0627\u0631\u062F \u0628\u0627\u0634\u062F: ${SHIPMENT_STATES.join(', ')}` });
  }
  try {
    const result = await updateShipment(shopId, orderId, shipment_status, tracking_code || null);
    await recordAudit(req, { action: 'order.shipment_update', targetType: 'order', targetId: orderId, shopId, metadata: { shipment_status, tracking_code: tracking_code || null, notified: result.notified } });
    return res.json({ success: true, orderId, shipment_status, notified: result.notified, data: result.order });
  } catch (err) {
    const code = err.code === 'not_found' ? 404 : 500;
    return res.status(code).json({ success: false, error: err.message });
  }
});

// ---- PATCH /api/orders/:orderId/receipt ----
// STAGE 31: save/update an order's receipt image. External (expiring) links are
// first copied into the permanent merchant-files bucket, then the durable URL
// is stored on the order so proof of payment is never lost.
router.patch('/:orderId/receipt', requireShopRole('staff'), async (req, res) => {
  const { orderId } = req.params;
  const { shopId, receipt_url } = req.body;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A' });
  if (!receipt_url) return res.status(400).json({ success: false, error: 'receipt_url \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A' });

  try {
    const permanentUrl = await persistImageFromUrl(receipt_url, 'receipts', shopId);
    const data = await supaFetch(
      `orders?id=eq.${encodeURIComponent(orderId)}&shop_id=eq.${encodeURIComponent(shopId)}`,
      { method: 'PATCH', body: JSON.stringify({ receipt_url: permanentUrl }) }
    );
    const updated = Array.isArray(data) ? data[0] : data;
    await recordAudit(req, { action: 'order.receipt_update', targetType: 'order', targetId: orderId, shopId, metadata: { receipt_url: permanentUrl } });
    return res.json({ success: true, orderId, receipt_url: permanentUrl, data: updated });
  } catch (err) {
    console.error('Error in orders/:orderId/receipt:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
