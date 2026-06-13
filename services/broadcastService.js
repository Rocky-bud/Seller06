/**
 * broadcastService — rate-safe marketing broadcasts to a shop's customers.
 *
 * PHASE 4 · STEP 1 (Broadcast core)
 *
 * - Audience is derived from the `chats` table (distinct customers), optionally
 *   filtered to buyers / leads via approved orders, minus anyone who opted out.
 * - Sends sequentially with a small inter-send delay; every outbound call goes
 *   through fetchWithRetry (honors 429 Retry-After + backoff from Phase 2).
 * - Per-recipient failures never abort the run (fail-open) and are counted.
 * - Each campaign is recorded in `broadcasts` with delivery stats.
 *
 * All technical machinery (delays, retries, opt-out filtering) is invisible to
 * the merchant, who only writes a message and taps "Send".
 */
import { fetchWithRetry } from './httpRetry.js';
import { getTokenForShop } from './botManager.js';
import { sendInstagramMessage } from './instagramService.js';
import { supaFetch, getOptedOutUserIds } from './marketingConsent.js';

const SEND_DELAY_MS = 40; // ~25 msgs/sec, comfortably under Telegram's ~30/sec
const UNSUB_FOOTER_TG = '\n\n—\nبرای لغو دریافت پیام‌های تبلیغاتی، /stop را بفرستید.';
const UNSUB_FOOTER_IG = '\n\nبرای لغو دریافت پیام‌ها، کلمه‌ی stop را بفرستید.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Segments that require order history to evaluate.
const ORDER_SEGMENTS = ['buyers', 'leads', 'vip', 'recent', 'dormant', 'product'];
const RECENT_DAYS = 30; // "recent buyers" window
const DORMANT_DAYS = 60; // "dormant" = bought, but not within this window
const VIP_MIN_ORDERS = 2; // "loyal" = repeat buyers

/**
 * Resolve the list of recipients for a shop given a segment.
 *
 * Segments (audience):
 *   all      — everyone who ever chatted with the bot
 *   buyers   — ≥ 1 approved order
 *   leads    — chatted but no approved order yet
 *   vip      — loyal/repeat buyers (≥ VIP_MIN_ORDERS approved orders)
 *   recent   — last approved purchase within RECENT_DAYS
 *   dormant  — has bought before, but not within DORMANT_DAYS
 *   product  — ordered a specific product (options.productId), any status
 *
 * Opted-out customers are always removed at the end.
 */
async function buildAudience(shopId, audience, options = {}) {
  const productId = options.productId || null;

  const chats =
    (await supaFetch(
      `chats?shop_id=eq.${encodeURIComponent(shopId)}&select=user_id,platform&order=created_at.desc`,
    )) || [];

  // Distinct customers, remembering each one's most-recent platform.
  const seen = new Map();
  for (const c of chats) {
    if (!c.user_id) continue;
    const uid = String(c.user_id);
    if (!seen.has(uid)) seen.set(uid, c.platform || 'telegram');
  }

  if (ORDER_SEGMENTS.includes(audience)) {
    const orders =
      (await supaFetch(
        `orders?shop_id=eq.${encodeURIComponent(shopId)}&select=user_id,status,total_price,product_id,created_at`,
      )) || [];

    // Per-customer aggregates over APPROVED orders + product-interest set.
    const stats = new Map(); // uid -> { orderCount, totalSpend, lastApprovedAt }
    const productInterest = new Set();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    for (const o of orders) {
      const uid = o.user_id ? String(o.user_id) : null;
      if (!uid) continue;
      if (productId && String(o.product_id) === String(productId)) productInterest.add(uid);
      if (o.status !== 'approved') continue;
      const s = stats.get(uid) || { orderCount: 0, totalSpend: 0, lastApprovedAt: 0 };
      s.orderCount += 1;
      s.totalSpend += Number(o.total_price) || 0;
      const t = o.created_at ? Date.parse(o.created_at) : 0;
      if (t > s.lastApprovedAt) s.lastApprovedAt = t;
      stats.set(uid, s);
    }

    for (const uid of [...seen.keys()]) {
      const s = stats.get(uid);
      const isBuyer = !!s;
      let keep = true;
      switch (audience) {
        case 'buyers':
          keep = isBuyer;
          break;
        case 'leads':
          keep = !isBuyer;
          break;
        case 'vip':
          keep = isBuyer && s.orderCount >= VIP_MIN_ORDERS;
          break;
        case 'recent':
          keep = isBuyer && now - s.lastApprovedAt <= RECENT_DAYS * DAY;
          break;
        case 'dormant':
          keep = isBuyer && now - s.lastApprovedAt > DORMANT_DAYS * DAY;
          break;
        case 'product':
          keep = productId ? productInterest.has(uid) : false;
          break;
        default:
          keep = true;
      }
      if (!keep) seen.delete(uid);
    }
  }

  const optedOut = await getOptedOutUserIds(shopId);
  const recipients = [];
  for (const [uid, platform] of seen.entries()) {
    if (optedOut.has(uid)) continue;
    recipients.push({ userId: uid, platform });
  }
  return recipients;
}

export async function getAudienceCount(shopId, audience = 'all', options = {}) {
  try {
    const recipients = await buildAudience(shopId, audience, options);
    return recipients.length;
  } catch (err) {
    console.error('[broadcast] getAudienceCount failed:', err.message);
    return 0;
  }
}

async function sendTelegram(token, chatId, text, imageUrl, replyMarkup) {
  const base = `https://api.telegram.org/bot${token}`;
  try {
    if (imageUrl) {
      const body = { chat_id: chatId, photo: imageUrl, caption: text };
      if (replyMarkup) body.reply_markup = replyMarkup;
      const res = await fetchWithRetry(
        `${base}/sendPhoto`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        { label: 'tg-broadcast-photo' },
      );
      const data = await res.json().catch(() => ({}));
      if (data.ok) return true;
      // Photo failed (e.g. bad URL) — fall back to a plain text message.
    }
    const body = { chat_id: chatId, text };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await fetchWithRetry(
      `${base}/sendMessage`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { label: 'tg-broadcast' },
    );
    const data = await res.json().catch(() => ({}));
    return !!data.ok;
  } catch (err) {
    console.error('[broadcast] telegram send error:', err.message);
    return false;
  }
}

export async function sendBroadcast({
  shopId,
  message,
  imageUrl = null,
  buttonLabel = null,
  buttonUrl = null,
  audience = 'all',
  productId = null,
  sentBy = null,
}) {
  if (!shopId) throw new Error('shopId required');
  const trimmed = (message || '').trim();
  if (!trimmed) throw new Error('message required');

  const recipients = await buildAudience(shopId, audience, { productId });
  const total = recipients.length;

  let shop = null;
  try {
    const rows = await supaFetch(
      `shops?id=eq.${encodeURIComponent(shopId)}&select=id,instagram_access_token,instagram_page_id&limit=1`,
    );
    shop = Array.isArray(rows) ? rows[0] : null;
  } catch {
    shop = null;
  }

  const token = getTokenForShop(shopId);
  const tgMarkup =
    buttonLabel && buttonUrl
      ? { inline_keyboard: [[{ text: buttonLabel, url: buttonUrl }]] }
      : null;

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of recipients) {
    try {
      if (r.platform === 'instagram') {
        if (!shop || !shop.instagram_access_token) {
          skipped += 1;
        } else {
          const out = await sendInstagramMessage(
            shop.instagram_access_token,
            r.userId,
            trimmed + UNSUB_FOOTER_IG,
            shop.instagram_page_id || '?',
          );
          if (out && out.success) sent += 1;
          else failed += 1;
        }
      } else if (!token) {
        skipped += 1;
      } else {
        const ok = await sendTelegram(token, r.userId, trimmed + UNSUB_FOOTER_TG, imageUrl, tgMarkup);
        if (ok) sent += 1;
        else failed += 1;
      }
    } catch (err) {
      failed += 1;
      console.error('[broadcast] recipient send error:', err.message);
    }
    await sleep(SEND_DELAY_MS);
  }

  let record = null;
  try {
    const rows = await supaFetch('broadcasts', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        shop_id: shopId,
        message: trimmed,
        image_url: imageUrl,
        button_label: buttonLabel,
        button_url: buttonUrl,
        audience,
        platform: 'telegram',
        status: 'sent',
        total_recipients: total,
        sent_count: sent,
        failed_count: failed,
        skipped_count: skipped,
        sent_by: sentBy,
      }),
    });
    record = Array.isArray(rows) ? rows[0] : rows;
  } catch (err) {
    console.error('[broadcast] record failed:', err.message);
  }

  return {
    id: record && record.id ? record.id : null,
    total,
    sent,
    failed,
    skipped,
    audience,
  };
}

export async function getBroadcasts(shopId, limit = 20) {
  try {
    const rows =
      (await supaFetch(
        `broadcasts?shop_id=eq.${encodeURIComponent(shopId)}&select=*&order=created_at.desc&limit=${limit}`,
      )) || [];
    return rows;
  } catch (err) {
    console.error('[broadcast] getBroadcasts failed:', err.message);
    return [];
  }
}
