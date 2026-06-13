/**
 * abandonedCart — PHASE 3 · STEP 1: Abandoned-cart recovery.
 *
 * A background sweep finds shoppers who began checkout (GETTING_NAME / ADDRESS /
 * PHONE or AWAITING_RECEIPT) but went quiet, and sends ONE gentle reminder on
 * the channel they used (Telegram or Instagram). When they later complete an
 * approved order, the nudge is flagged "recovered" so the dashboard can show
 * recovered revenue.
 *
 * Merchants never see cron schedules or TTL timers — they only flip a single
 * switch (shops.cart_recovery_enabled). All timing constants live here.
 */

import dotenv from 'dotenv';
import { sendTelegramMessage, MAIN_MENU } from './botManager.js';
import { sendInstagramMessage } from './instagramService.js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

// ── Tuning (all hidden from merchants) ──────────────────────────────────
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // run every 5 minutes
const BOOT_DELAY_MS = 30 * 1000; // first sweep 30s after boot
const DEFAULT_DELAY_MINUTES = 60; // nudge after 60 min of silence
const MAX_AGE_HOURS = 24; // never nudge checkouts older than 24h
const RENUDGE_GUARD_HOURS = 24; // at most one nudge per shopper / 24h
const CHECKOUT_STATES = ['GETTING_NAME', 'GETTING_ADDRESS', 'GETTING_PHONE', 'AWAITING_RECEIPT'];

const NUDGE_TEXT =
  'سلام 👋\nسفارش شما هنوز تکمیل نشده است. هر وقت آماده بودید، از همین‌جا می‌توانید ادامه دهید. اگر سؤالی دارید همین‌جا بپرسید 🙏';

async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase error (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

// Shops that switched recovery ON.
async function getEnabledShops() {
  try {
    const rows = await supaFetch(
      'shops?cart_recovery_enabled=eq.true&select=id,cart_recovery_delay_minutes,instagram_access_token',
    );
    return rows || [];
  } catch (err) {
    // Columns not migrated yet → feature simply stays inactive.
    console.warn('[cart-recovery] getEnabledShops skipped:', err.message);
    return [];
  }
}

// Latest checkout state per shopper, filtered to "stalled but not ancient".
async function getStalledCheckouts(shopId, delayMinutes) {
  const rows = await supaFetch(
    `chats?shop_id=eq.${encodeURIComponent(shopId)}` +
      '&select=user_id,platform,state,pending_order_id,created_at' +
      '&order=created_at.desc&limit=1000',
  );
  if (!rows || !rows.length) return [];

  const latestByUser = new Map();
  for (const r of rows) {
    if (!r.user_id) continue;
    if (!latestByUser.has(r.user_id)) latestByUser.set(r.user_id, r);
  }

  const now = Date.now();
  const minSilenceMs = (delayMinutes || DEFAULT_DELAY_MINUTES) * 60 * 1000;
  const maxAgeMs = MAX_AGE_HOURS * 60 * 60 * 1000;

  const stalled = [];
  for (const r of latestByUser.values()) {
    if (!CHECKOUT_STATES.includes(r.state)) continue;
    const age = now - Date.parse(r.created_at);
    if (Number.isNaN(age)) continue;
    if (age >= minSilenceMs && age <= maxAgeMs) {
      stalled.push({
        userId: r.user_id,
        platform: r.platform || 'telegram',
        state: r.state,
        pendingOrderId: r.pending_order_id || null,
        createdAt: r.created_at,
      });
    }
  }
  return stalled;
}

// Has this shopper already been nudged within the guard window?
async function alreadyNudged(shopId, userId) {
  try {
    const sinceIso = new Date(Date.now() - RENUDGE_GUARD_HOURS * 60 * 60 * 1000).toISOString();
    const rows = await supaFetch(
      `cart_recovery_log?shop_id=eq.${encodeURIComponent(shopId)}` +
        `&user_id=eq.${encodeURIComponent(userId)}` +
        `&nudged_at=gte.${encodeURIComponent(sinceIso)}` +
        '&select=id&limit=1',
    );
    return !!(rows && rows.length);
  } catch {
    return false;
  }
}

async function logNudge(shop, checkout) {
  try {
    await supaFetch('cart_recovery_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        shop_id: shop.id,
        user_id: checkout.userId,
        platform: checkout.platform,
        state_at_nudge: checkout.state,
        pending_order_id: checkout.pendingOrderId,
      }),
    });
  } catch (err) {
    console.warn('[cart-recovery] logNudge failed:', err.message);
  }
}

async function sendNudge(shop, checkout) {
  try {
    if (checkout.platform === 'instagram') {
      if (!shop.instagram_access_token) return false;
      const r = await sendInstagramMessage(
        shop.instagram_access_token,
        checkout.userId,
        NUDGE_TEXT,
        shop.id,
      );
      return !!(r && r.success !== false);
    }
    // default channel: telegram
    const r = await sendTelegramMessage(shop.id, checkout.userId, NUDGE_TEXT, MAIN_MENU);
    return !!(r && r.ok !== false);
  } catch (err) {
    console.warn(`[cart-recovery] sendNudge failed (${checkout.platform}):`, err.message);
    return false;
  }
}

// Flip un-recovered nudges to recovered when the shopper later completed an order.
async function markRecoveries(shopId) {
  let logs;
  try {
    logs = await supaFetch(
      `cart_recovery_log?shop_id=eq.${encodeURIComponent(shopId)}` +
        '&recovered=eq.false&select=id,user_id,nudged_at&order=nudged_at.desc&limit=200',
    );
  } catch {
    return;
  }
  if (!logs || !logs.length) return;

  for (const log of logs) {
    try {
      const orders = await supaFetch(
        `orders?shop_id=eq.${encodeURIComponent(shopId)}` +
          `&user_id=eq.${encodeURIComponent(log.user_id)}` +
          `&status=eq.approved&created_at=gte.${encodeURIComponent(log.nudged_at)}` +
          '&select=id,total_price,created_at&order=created_at.asc&limit=1',
      );
      const order = orders && orders[0];
      if (!order) continue;
      await supaFetch(`cart_recovery_log?id=eq.${encodeURIComponent(log.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          recovered: true,
          recovered_at: new Date().toISOString(),
          recovered_order_id: order.id,
          recovered_amount: order.total_price != null ? order.total_price : null,
        }),
      });
    } catch (err) {
      console.warn('[cart-recovery] markRecoveries item failed:', err.message);
    }
  }
}

export async function runRecoverySweep() {
  const shops = await getEnabledShops();
  if (!shops.length) return { shops: 0, nudges: 0 };

  let nudges = 0;
  for (const shop of shops) {
    try {
      await markRecoveries(shop.id);
      const stalled = await getStalledCheckouts(shop.id, shop.cart_recovery_delay_minutes);
      for (const checkout of stalled) {
        if (await alreadyNudged(shop.id, checkout.userId)) continue;
        const sent = await sendNudge(shop, checkout);
        if (sent) {
          await logNudge(shop, checkout);
          nudges += 1;
        }
      }
    } catch (err) {
      console.warn(`[cart-recovery] sweep failed for shop ${shop.id}:`, err.message);
    }
  }
  if (nudges) {
    console.log(`[cart-recovery] sweep sent ${nudges} nudge(s) across ${shops.length} shop(s)`);
  }
  return { shops: shops.length, nudges };
}

// Dashboard widget data: enabled flag + recovery totals (robust if not migrated).
export async function getRecoveryStats(shopId) {
  let enabled = false;
  try {
    const rows = await supaFetch(
      `shops?id=eq.${encodeURIComponent(shopId)}&select=cart_recovery_enabled`,
    );
    enabled = !!(rows && rows[0] && rows[0].cart_recovery_enabled);
  } catch {
    enabled = false;
  }

  let logs = [];
  try {
    logs =
      (await supaFetch(
        `cart_recovery_log?shop_id=eq.${encodeURIComponent(shopId)}` +
          '&select=recovered,recovered_amount,recovered_at&order=recovered_at.desc.nullslast',
      )) || [];
  } catch {
    logs = [];
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const nudgesSent = logs.length;
  const recoveredLogs = logs.filter((l) => l.recovered);
  const recovered = recoveredLogs.length;
  const recoveredRevenue = recoveredLogs.reduce(
    (sum, l) => sum + (l.recovered_amount ? Number(l.recovered_amount) : 0),
    0,
  );

  // Last-7-days slice gives the merchant a "recent momentum" read.
  const recent = recoveredLogs.filter(
    (l) => l.recovered_at && Date.parse(l.recovered_at) >= sevenDaysAgo,
  );
  const recoveredCount7d = recent.length;
  const recoveredRevenue7d = recent.reduce(
    (sum, l) => sum + (l.recovered_amount ? Number(l.recovered_amount) : 0),
    0,
  );

  const recoveryRate = nudgesSent > 0 ? Math.round((recovered / nudgesSent) * 100) : 0;

  return {
    enabled,
    nudgesSent,
    recovered,
    recoveredRevenue,
    recoveredCount7d,
    recoveredRevenue7d,
    recoveryRate,
  };
}

let timer = null;
export function startAbandonedCartScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    runRecoverySweep().catch((err) => console.warn('[cart-recovery] sweep error:', err.message));
  }, SWEEP_INTERVAL_MS);
  if (timer.unref) timer.unref();
  setTimeout(() => {
    runRecoverySweep().catch((err) => console.warn('[cart-recovery] boot sweep error:', err.message));
  }, BOOT_DELAY_MS);
  console.log('[cart-recovery] scheduler started (sweep every 5m)');
}

export default { runRecoverySweep, getRecoveryStats, startAbandonedCartScheduler };
