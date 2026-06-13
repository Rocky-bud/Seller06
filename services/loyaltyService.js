/**
 * loyaltyService — customer loyalty-points engine.
 *
 * PHASE 6 / STEP 3a (Loyalty foundation + earning)
 *
 * Pure, dependency-light helpers shared by the admin routes, the order-confirm
 * accrual hook (routes/orders.js) and — in step 3b — the checkout redemption
 * flow in aiService. Reads/writes use the service-role key so the server and
 * bot can move points without a logged-in user.
 *
 * Earning rule: when a PAID order is confirmed, the customer earns
 *   floor(amountPaid / 1000) * loyalty_earn_per_1000   points
 * where amountPaid = order.total_price - order.discount_amount.
 *
 * All mutations are best-effort and fail-open: a loyalty error must NEVER block
 * an order from being confirmed. A unique index on the ledger (one 'earn' row
 * per order) makes accrual idempotent even if confirm is retried.
 */
import { fetchWithRetry } from './httpRetry.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

export const LEDGER_REASONS = ['earn', 'redeem', 'adjust'];

const DEFAULT_CONFIG = {
  loyalty_enabled: true,
  loyalty_earn_per_1000: 1,
  loyalty_redeem_value: 1000,
};

async function supaFetch(pathAndQuery, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${pathAndQuery}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const res = await fetchWithRetry(url, { ...options, headers }, { label: 'supabase-loyalty' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

/**
 * Read a shop's loyalty configuration, falling back to sane defaults when the
 * columns/row are missing (e.g. migration 029 not yet run).
 * @returns {Promise<{loyalty_enabled:boolean, loyalty_earn_per_1000:number, loyalty_redeem_value:number}>}
 */
export async function getLoyaltyConfig(shopId) {
  if (!shopId) return { ...DEFAULT_CONFIG };
  try {
    const rows =
      (await supaFetch(
        `shops?id=eq.${encodeURIComponent(shopId)}` +
          `&select=loyalty_enabled,loyalty_earn_per_1000,loyalty_redeem_value&limit=1`,
      )) || [];
    const row = rows[0];
    if (!row) return { ...DEFAULT_CONFIG };
    return {
      loyalty_enabled: row.loyalty_enabled !== false,
      loyalty_earn_per_1000:
        row.loyalty_earn_per_1000 != null ? Number(row.loyalty_earn_per_1000) : DEFAULT_CONFIG.loyalty_earn_per_1000,
      loyalty_redeem_value:
        row.loyalty_redeem_value != null ? Number(row.loyalty_redeem_value) : DEFAULT_CONFIG.loyalty_redeem_value,
    };
  } catch (err) {
    console.warn('[loyaltyService] getLoyaltyConfig failed, using defaults:', err.message);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * How many points a given paid amount earns for a shop.
 */
export function pointsForAmount(amountPaid, earnPer1000) {
  const paid = Math.max(0, Number(amountPaid) || 0);
  const rate = Math.max(0, Number(earnPer1000) || 0);
  return Math.floor((paid / 1000) * rate);
}

/**
 * Fetch the loyalty account row for a (shop, user), or null.
 */
export async function getAccount(shopId, userId) {
  if (!shopId || !userId) return null;
  try {
    const rows =
      (await supaFetch(
        `loyalty_accounts?shop_id=eq.${encodeURIComponent(shopId)}` +
          `&user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
      )) || [];
    return rows[0] || null;
  } catch (err) {
    console.warn('[loyaltyService] getAccount failed:', err.message);
    return null;
  }
}

/**
 * Current points balance for a (shop, user). Returns 0 on any error.
 */
export async function getBalance(shopId, userId) {
  const acct = await getAccount(shopId, userId);
  return Number(acct?.points_balance || 0);
}

// Ensure an account row exists; returns the (possibly freshly created) row.
async function ensureAccount(shopId, userId) {
  const existing = await getAccount(shopId, userId);
  if (existing) return existing;
  try {
    const created =
      (await supaFetch('loyalty_accounts', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ shop_id: shopId, user_id: userId, points_balance: 0, total_earned: 0, total_redeemed: 0 }),
      })) || [];
    return (Array.isArray(created) ? created[0] : created) || (await getAccount(shopId, userId));
  } catch (err) {
    // A concurrent insert may have won the unique index; re-read.
    console.warn('[loyaltyService] ensureAccount insert race/err:', err.message);
    return await getAccount(shopId, userId);
  }
}

// Write an append-only ledger row. Best-effort.
async function writeLedger({ shopId, userId, orderId = null, delta, reason, balanceAfter, note = null }) {
  return supaFetch('loyalty_ledger', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      shop_id: shopId,
      user_id: userId,
      order_id: orderId,
      delta,
      reason,
      balance_after: balanceAfter,
      note,
    }),
  });
}

/**
 * Accrue loyalty points for a confirmed, paid order. Idempotent per order via
 * the ledger's unique 'earn'-per-order index. Fail-open.
 *
 * @returns {Promise<{accrued:boolean, points:number, balance:number, reason?:string}>}
 */
export async function accruePointsForOrder({ shopId, userId, orderId, amountPaid }) {
  const out = { accrued: false, points: 0, balance: 0 };
  if (!shopId || !userId) return { ...out, reason: 'missing shop/user' };

  const config = await getLoyaltyConfig(shopId);
  if (!config.loyalty_enabled) return { ...out, reason: 'loyalty disabled' };

  const points = pointsForAmount(amountPaid, config.loyalty_earn_per_1000);
  if (points <= 0) return { ...out, reason: 'amount earns no points' };

  try {
    const acct = await ensureAccount(shopId, userId);
    const currentBalance = Number(acct?.points_balance || 0);
    const currentEarned = Number(acct?.total_earned || 0);
    const newBalance = currentBalance + points;

    // Ledger first: its unique 'earn'-per-order index enforces idempotency. If
    // this order already accrued, the insert fails and we skip the balance bump.
    try {
      await writeLedger({
        shopId, userId, orderId, delta: points, reason: 'earn',
        balanceAfter: newBalance, note: 'order confirmed',
      });
    } catch (ledgerErr) {
      if (/duplicate|unique|23505/i.test(ledgerErr.message)) {
        console.log(`[loyaltyService] order ${orderId} already accrued — skipping`);
        return { accrued: false, points: 0, balance: currentBalance, reason: 'already accrued' };
      }
      throw ledgerErr;
    }

    await supaFetch(`loyalty_accounts?id=eq.${encodeURIComponent(acct.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        points_balance: newBalance,
        total_earned: currentEarned + points,
        updated_at: new Date().toISOString(),
      }),
    });

    return { accrued: true, points, balance: newBalance };
  } catch (err) {
    console.warn('[loyaltyService] accruePointsForOrder failed (non-fatal):', err.message);
    return { ...out, reason: err.message };
  }
}

/**
 * Redeem points for a (shop, user). Used by the checkout flow in step 3b.
 * Clamps to the available balance. Fail-closed for spending (returns redeemed:0
 * on any error so a customer is never over-credited a discount they didn't have).
 *
 * @returns {Promise<{redeemed:number, value:number, balance:number, reason?:string}>}
 */
export async function redeemPoints({ shopId, userId, points, orderId = null }) {
  const want = Math.max(0, Math.floor(Number(points) || 0));
  const out = { redeemed: 0, value: 0, balance: 0 };
  if (!shopId || !userId || want <= 0) return { ...out, reason: 'nothing to redeem' };

  const config = await getLoyaltyConfig(shopId);
  if (!config.loyalty_enabled) return { ...out, reason: 'loyalty disabled' };

  try {
    const acct = await getAccount(shopId, userId);
    const balance = Number(acct?.points_balance || 0);
    if (!acct || balance <= 0) return { ...out, balance, reason: 'no points' };

    const redeemed = Math.min(want, balance);
    const newBalance = balance - redeemed;
    const value = Math.round(redeemed * Number(config.loyalty_redeem_value || 0));

    await writeLedger({
      shopId, userId, orderId, delta: -redeemed, reason: 'redeem',
      balanceAfter: newBalance, note: 'redeemed at checkout',
    });
    await supaFetch(`loyalty_accounts?id=eq.${encodeURIComponent(acct.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        points_balance: newBalance,
        total_redeemed: Number(acct?.total_redeemed || 0) + redeemed,
        updated_at: new Date().toISOString(),
      }),
    });

    return { redeemed, value, balance: newBalance };
  } catch (err) {
    console.warn('[loyaltyService] redeemPoints failed:', err.message);
    return { ...out, reason: err.message };
  }
}

/**
 * Refund points that were redeemed on an order — e.g. when a merchant REJECTS an
 * order whose customer had already spent points at checkout. Without this, a
 * rejected order silently swallows the customer's points (real monetary value).
 *
 * Idempotent per order: a positive 'adjust' ledger row for the order means it was
 * already refunded, so a double-rejection never double-credits. Fail-open: a
 * refund problem must never block the status change (logs + returns refunded:0).
 *
 * @returns {Promise<{refunded:number, balance:number, reason?:string}>}
 */
export async function refundRedeemedPoints({ shopId, userId, orderId, points }) {
  const want = Math.max(0, Math.floor(Number(points) || 0));
  const out = { refunded: 0, balance: 0 };
  if (!shopId || !userId || want <= 0) return { ...out, reason: 'nothing to refund' };

  try {
    // Idempotency guard: skip if this order already has a positive 'adjust' row.
    if (orderId) {
      const prior =
        (await supaFetch(
          `loyalty_ledger?order_id=eq.${encodeURIComponent(orderId)}` +
            `&reason=eq.adjust&delta=gt.0&select=id&limit=1`,
        )) || [];
      if (prior.length) return { ...out, reason: 'already refunded' };
    }

    const acct = await ensureAccount(shopId, userId);
    if (!acct) return { ...out, reason: 'no account' };
    const balance = Number(acct.points_balance || 0);
    const newBalance = balance + want;

    await writeLedger({
      shopId, userId, orderId, delta: want, reason: 'adjust',
      balanceAfter: newBalance, note: 'refund: order rejected',
    });
    await supaFetch(`loyalty_accounts?id=eq.${encodeURIComponent(acct.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        points_balance: newBalance,
        total_redeemed: Math.max(0, Number(acct.total_redeemed || 0) - want),
        updated_at: new Date().toISOString(),
      }),
    });

    return { refunded: want, balance: newBalance };
  } catch (err) {
    console.warn('[loyaltyService] refundRedeemedPoints failed (non-fatal):', err.message);
    return { ...out, reason: err.message };
  }
}
