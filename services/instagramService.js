/**
 * Instagram Service
 *
 * Handles all Instagram-specific logic:
 *   - Shop resolution by page_id (with short-lived in-memory cache)
 *   - Message deduplication by Meta message_id (mid)
 *   - Sending replies via Graph API v19.0
 *   - Main DM orchestration → analyzeInstagramMessage → reply
 */

import { analyzeInstagramMessage } from './aiService.js';
import { fetchWithRetry } from './httpRetry.js';

// ─── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const GRAPH_API    = 'https://graph.facebook.com/v19.0';
const TAG          = '[Instagram]';

// Welcome reply when the shop is found but the AI returns empty
const FALLBACK_REPLY = 'سلام! پیام شما دریافت شد. به زودی پاسخ داده خواهد شد 🙏';

// ─── In-memory shop cache (keyed by instagram_page_id) ───────────────────────
// TTL: 5 minutes — avoids a Supabase round-trip on every message burst
const shopCache   = new Map();   // pageId → { shop, expiresAt }
const CACHE_TTL   = 5 * 60 * 1000;

// ─── Deduplication set (keyed by Meta message_id) ────────────────────────────
// Prevents double-processing when Meta retries the same event
const seenMids    = new Set();
const MID_MAX     = 2000;        // cap to avoid unbounded memory growth

// ─── Supabase helper ─────────────────────────────────────────────────────────
async function supaFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ─── resolveShopByPageId ─────────────────────────────────────────────────────
/**
 * Look up a shop row whose instagram_page_id matches pageId.
 * Returns { id, instagram_access_token } or null.
 * Results are cached for CACHE_TTL ms.
 */
export async function resolveShopByPageId(pageId) {
  const now = Date.now();

  const cached = shopCache.get(pageId);
  if (cached && cached.expiresAt > now) {
    return cached.shop;
  }

  const rows = await supaFetch(
    `shops?select=id,name,instagram_access_token&instagram_page_id=eq.${encodeURIComponent(pageId)}&limit=1`
  );

  const shop = rows?.[0] ?? null;
  shopCache.set(pageId, { shop, expiresAt: now + CACHE_TTL });

  if (shop) {
    console.log(`${TAG} Cache miss — resolved page_id "${pageId}" → shop "${shop.id}" ("${shop.name}")`);
  }

  return shop;
}

/** Call this when credentials change so the stale cached token isn't used. */
export function invalidateShopCache(pageId) {
  shopCache.delete(pageId);
  console.log(`${TAG} Cache invalidated for page_id "${pageId}"`);
}

// ─── sendInstagramMessage ────────────────────────────────────────────────────
/**
 * Send a text reply to a user via the Instagram Messaging API.
 *
 * @param {string} accessToken  - Shop's Meta Page Access Token
 * @param {string} recipientId  - Instagram-scoped user ID to reply to
 * @param {string} text         - Message text (truncated to 1 000 chars)
 * @param {string} [pageId]     - Used in logs only
 * @returns {{ success: boolean, messageId?: string, error?: string }}
 */
export async function sendInstagramMessage(accessToken, recipientId, text, pageId = '?') {
  if (!accessToken) {
    console.warn(`${TAG} [page:${pageId}] Cannot send — no access_token`);
    return { success: false, error: 'no_access_token' };
  }
  if (!recipientId) {
    console.warn(`${TAG} [page:${pageId}] Cannot send — no recipientId`);
    return { success: false, error: 'no_recipient_id' };
  }

  const truncated = text.slice(0, 1000);
  const t0 = Date.now();

  try {
    const res = await fetchWithRetry(`${GRAPH_API}/me/messages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient:    { id: recipientId },
        message:      { text: truncated },
        access_token: accessToken,
      }),
    });

    const data = await res.json();
    const ms   = Date.now() - t0;

    if (data.message_id) {
      console.log(`${TAG} [page:${pageId}] ✅ Sent to ${recipientId} in ${ms}ms — mid:${data.message_id}`);
      return { success: true, messageId: data.message_id };
    }

    // Graph API returned an error object
    const errMsg = data.error?.message || JSON.stringify(data);
    console.warn(`${TAG} [page:${pageId}] ⚠️ Graph API error after ${ms}ms:`, errMsg);
    return { success: false, error: errMsg };

  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`${TAG} [page:${pageId}] ❌ Network error after ${ms}ms:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── handleInstagramDM ───────────────────────────────────────────────────────
/**
 * Full pipeline for one Instagram DM event:
 *   1. Deduplicate by mid
 *   2. Resolve shop from recipient page_id
 *   3. Pass text to analyzeInstagramMessage (shared AI engine)
 *   4. Send reply back to sender
 *
 * @param {object} params
 * @param {string} params.senderId      - Instagram-scoped ID of the user who sent the DM
 * @param {string} params.recipientId   - Our Instagram Page ID (recipient.id from Meta)
 * @param {string} params.text          - The DM text
 * @param {string} [params.mid]         - Meta message_id for deduplication
 * @param {number} [params.timestamp]   - Event timestamp (ms) for logging
 */
export async function handleInstagramDM({ senderId, recipientId, text, mid, timestamp, imageUrl = null }) {
  const t0    = Date.now();
  const tsStr = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();

  console.log(
    `${TAG} [page:${recipientId}] ▶ DM received` +
    ` | sender:${senderId}` +
    ` | mid:${mid || 'none'}` +
    ` | ts:${tsStr}` +
    ` | text:"${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`
  );

  // ── 1. Deduplicate ──────────────────────────────────────────────────────────
  if (mid) {
    if (seenMids.has(mid)) {
      console.warn(`${TAG} [page:${recipientId}] Duplicate mid:${mid} — skipping`);
      return;
    }
    seenMids.add(mid);
    if (seenMids.size > MID_MAX) {
      // Evict the oldest entry to keep memory bounded
      seenMids.delete(seenMids.values().next().value);
    }
  }

  // ── 2. Resolve shop ─────────────────────────────────────────────────────────
  let shop;
  try {
    shop = await resolveShopByPageId(recipientId);
  } catch (err) {
    console.error(`${TAG} [page:${recipientId}] DB lookup failed:`, err.message);
    return;
  }

  if (!shop) {
    console.warn(`${TAG} [page:${recipientId}] No shop found — message dropped`);
    return;
  }

  if (!shop.instagram_access_token) {
    console.warn(`${TAG} [shop:${shop.id}] No access_token stored — cannot reply`);
    return;
  }

  console.log(`${TAG} [shop:${shop.id}] Routing to analyzeInstagramMessage (platform=instagram)`);

  // ── 3. Process through shared AI engine ─────────────────────────────────────
  let aiReply = null;
  try {
    const result = await analyzeInstagramMessage(
      senderId,                            // userId (Instagram-scoped sender id / IGSID)
      text,                                // message text (may be empty for image-only DMs)
      shop.id,                             // resolved shopId
      imageUrl ? { url: imageUrl } : null  // STAGE 21: attached image (payment receipt, etc.)
    );

    if (result?.success && result?.response) {
      aiReply = result.response;
      console.log(
        `${TAG} [shop:${shop.id}] AI replied in ${Date.now() - t0}ms` +
        ` — "${aiReply.slice(0, 60)}${aiReply.length > 60 ? '…' : ''}"`
      );
    } else {
      console.warn(`${TAG} [shop:${shop.id}] analyzeInstagramMessage returned no response — using fallback`);
    }
  } catch (err) {
    console.error(`${TAG} [shop:${shop.id}] analyzeInstagramMessage threw:`, err.message);
  }

  // ── 4. Send reply ────────────────────────────────────────────────────────────
  const replyText = aiReply || FALLBACK_REPLY;

  const sendResult = await sendInstagramMessage(
    shop.instagram_access_token,   // Page access token for this shop
    senderId,                      // recipient = the customer who sent the DM
    replyText,                     // AI-generated reply text
    recipientId                    // our page id (logs only)
  );

  if (sendResult?.success) {
    console.log(`${TAG} [shop:${shop.id}] ✔ Reply delivered to ${senderId} — mid:${sendResult.messageId} | ${Date.now() - t0}ms`);
  } else {
    console.error(`${TAG} [shop:${shop.id}] ✖ Failed to deliver reply to ${senderId} — error:${sendResult?.error || 'unknown'}`);
  }

  console.log(`${TAG} [shop:${shop.id}] ✔ Pipeline complete in ${Date.now() - t0}ms`);
}
