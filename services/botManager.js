/**
 * BotManager — Multi-tenant Telegram bot registry + message helpers
 */

import crypto from 'crypto';
import { fetchWithRetry } from './httpRetry.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const shopTokenMap = new Map();
const tokenShopMap = new Map();

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

// ─── Persistent Keyboard Constants ───────────────────────────────────────────

/** Permanent bottom menu — shown in IDLE state */
export const MAIN_MENU = {
  keyboard: [
    [{ text: '🛒 سبد خرید' }, { text: '🔍 پیگیری سفارش' }],
  ],
  resize_keyboard: true,
  persistent: true,
};

/** Phone-request keyboard — shown during GETTING_PHONE state */
export const PHONE_KEYBOARD = {
  keyboard: [
    [{ text: '📱 ارسال شماره موبایل', request_contact: true }],
    [{ text: '❌ لغو سفارش' }],
  ],
  resize_keyboard: true,
  one_time_keyboard: true,
};

/** Minimal checkout keyboard — shown during GETTING_NAME / GETTING_ADDRESS */
export const CANCEL_KEYBOARD = {
  keyboard: [[{ text: '❌ لغو سفارش' }]],
  resize_keyboard: true,
};

// ─── Shop Registry ────────────────────────────────────────────────────────────

export async function loadShops() {
  try {
    const shops = await supaFetch(
      'shops?select=id,name,telegram_token&telegram_token=not.is.null'
    );
    shopTokenMap.clear();
    tokenShopMap.clear();
    for (const shop of shops || []) {
      if (shop.telegram_token) {
        shopTokenMap.set(shop.id, shop.telegram_token);
        tokenShopMap.set(shop.telegram_token, shop.id);
      }
    }
    console.log(
      `[BotManager] Loaded ${shopTokenMap.size} shop(s) with Telegram token(s):`,
      [...shopTokenMap.keys()]
    );
    return shops || [];
  } catch (err) {
    console.error('[BotManager] Failed to load shops:', err.message);
    return [];
  }
}

export function getTokenForShop(shopId) { return shopTokenMap.get(shopId) || null; }
export function getShopForToken(token) { return tokenShopMap.get(token) || null; }
export function hasShop(shopId) { return shopTokenMap.has(shopId); }
export function getAllShopIds() { return [...shopTokenMap.keys()]; }

// ─── Webhook secret (Phase 1.1) ──────────────────────────────────────────────
// Telegram echoes a per-webhook secret_token back on every update via the
// `X-Telegram-Bot-Api-Secret-Token` header. We set it at setWebhook time and
// verify it in routes/webhook.js so forged POSTs are rejected before any work.
// secret_token charset is limited to A-Z a-z 0-9 _ - (1..256 chars).
export function getWebhookSecret(token) {
  const envSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (envSecret) {
    const cleaned = envSecret.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 256);
    return cleaned || 'invalid_secret';
  }
  if (!token) return '';
  // Deterministic per-shop fallback: unguessable without the bot token itself.
  return 'wh_' + crypto.createHash('sha256').update(String(token)).digest('hex');
}

// True when an explicit global secret is configured -> strict (header REQUIRED).
export function isWebhookSecretEnforced() {
  return Boolean((process.env.TELEGRAM_WEBHOOK_SECRET || '').trim());
}

// ─── Webhook Management ───────────────────────────────────────────────────────

export async function setWebhookForShop(shopId, baseUrl) {
  const token = shopTokenMap.get(shopId);
  if (!token) throw new Error(`No token registered for shop: ${shopId}`);
  const webhookUrl = `${baseUrl}/api/webhook/telegram/${encodeURIComponent(shopId)}`;
  const secretToken = getWebhookSecret(token);
  const response = await fetchWithRetry(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, secret_token: secretToken }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram setWebhook failed for ${shopId}: ${data.description}`);
  try {
    await supaFetch(`shops?id=eq.${encodeURIComponent(shopId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ webhook_url: webhookUrl }),
    });
  } catch (_) {}
  console.log(`[BotManager] Webhook registered for shop "${shopId}": ${webhookUrl}`);
  return { ok: true, webhookUrl };
}

export async function setWebhooksForAll(baseUrl) {
  const results = [];
  for (const shopId of shopTokenMap.keys()) {
    try {
      const result = await setWebhookForShop(shopId, baseUrl);
      results.push({ shopId, success: true, webhookUrl: result.webhookUrl });
    } catch (err) {
      results.push({ shopId, success: false, error: err.message });
    }
  }
  return results;
}

export async function deleteWebhookForShop(shopId) {
  const token = shopTokenMap.get(shopId);
  if (!token) throw new Error(`No token registered for shop: ${shopId}`);
  const response = await fetchWithRetry(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: 'POST' });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram deleteWebhook failed: ${data.description}`);
  try {
    await supaFetch(`shops?id=eq.${encodeURIComponent(shopId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ webhook_url: null }),
    });
  } catch (_) {}
  console.log(`[BotManager] Webhook deleted for shop "${shopId}"`);
  return { ok: true };
}

export async function getWebhookInfo(shopId) {
  const token = shopTokenMap.get(shopId);
  if (!token) throw new Error(`No token registered for shop: ${shopId}`);
  const response = await fetchWithRetry(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  return response.json();
}

// ─── Message Sending ──────────────────────────────────────────────────────────

/**
 * Send a text message.
 * @param {string} shopId
 * @param {number|string} chatId
 * @param {string} text
 * @param {object|null} replyMarkup  — ReplyKeyboardMarkup, InlineKeyboardMarkup, or null
 * @param {string} parseMode         — 'Markdown' | 'HTML' | '' (none)
 */
export async function sendTelegramMessage(shopId, chatId, text, replyMarkup = null, parseMode = 'Markdown') {
  const token = shopTokenMap.get(shopId);
  if (!token) {
    console.warn(`[BotManager] sendMessage: no token for shop "${shopId}"`);
    return;
  }

  const MAX = 4000;
  const chunks = [];
  let remaining = text || '';
  while (remaining.length > MAX) {
    const cut = remaining.lastIndexOf('\n', MAX);
    chunks.push(cut > 0 ? remaining.slice(0, cut) : remaining.slice(0, MAX));
    remaining = cut > 0 ? remaining.slice(cut + 1) : remaining.slice(MAX);
  }
  if (remaining.length > 0) chunks.push(remaining);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    const body = {
      chat_id: chatId,
      text: chunk,
    };
    if (parseMode) body.parse_mode = parseMode;
    // Only attach keyboard on the last chunk
    if (isLast && replyMarkup) body.reply_markup = replyMarkup;

    try {
      const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        // Retry without parse_mode on format errors
        if (data.description?.includes('parse') || data.description?.includes('can\'t parse')) {
          const fallback = { chat_id: chatId, text: chunk };
          if (isLast && replyMarkup) fallback.reply_markup = replyMarkup;
          await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fallback),
          });
        } else {
          console.warn(`[BotManager] sendMessage failed for shop "${shopId}": ${data.description}`);
        }
      }
    } catch (err) {
      console.error(`[BotManager] sendMessage error for shop "${shopId}":`, err.message);
    }
  }
}

/**
 * Send a photo with an optional caption and keyboard.
 * Falls back to a text message if the photo URL is unavailable.
 */
export async function sendTelegramPhoto(shopId, chatId, photoUrl, caption = '', replyMarkup = null, parseMode = 'HTML') {
  const token = shopTokenMap.get(shopId);
  if (!token) return;

  const body = { chat_id: chatId, photo: photoUrl };
  if (caption) { body.caption = caption.slice(0, 1024); }
  if (parseMode) body.parse_mode = parseMode;
  if (replyMarkup) body.reply_markup = replyMarkup;

  try {
    const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      // Photo failed — send as text fallback
      console.warn(`[BotManager] sendPhoto failed (${data.description}), sending text fallback`);
      await sendTelegramMessage(shopId, chatId, caption || photoUrl, replyMarkup, '');
    }
  } catch (err) {
    console.error(`[BotManager] sendPhoto error for shop "${shopId}":`, err.message);
    await sendTelegramMessage(shopId, chatId, caption || photoUrl, replyMarkup, '').catch(() => {});
  }
}

/**
 * Edit an existing message text + keyboard in place (no new message bubble).
 * Uses Telegram editMessageText API.
 */
export async function editTelegramMessage(shopId, chatId, messageId, text, replyMarkup = null, parseMode = 'Markdown') {
  const token = shopTokenMap.get(shopId);
  if (!token || !messageId) return;
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, 4096),
  };
  if (parseMode) body.parse_mode = parseMode;
  if (replyMarkup) body.reply_markup = replyMarkup;
  try {
    const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`[BotManager] editMessageText failed for shop "${shopId}": ${data.description}`);
    }
  } catch (err) {
    console.error(`[BotManager] editMessageText error for shop "${shopId}":`, err.message);
  }
}

/**
 * Answer an inline query (floating search results panel).
 * results: array of InlineQueryResult objects
 * cacheTime: seconds Telegram caches the result (0 = no cache for dynamic results)
 */
export async function answerInlineQuery(shopId, inlineQueryId, results = [], cacheTime = 0) {
  const token = shopTokenMap.get(shopId);
  if (!token || !inlineQueryId) return;
  try {
    const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/answerInlineQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inline_query_id: inlineQueryId,
        results,
        cache_time: cacheTime,
        is_personal: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) console.warn(`[BotManager] answerInlineQuery failed: ${data.description}`);
  } catch (err) {
    console.error(`[BotManager] answerInlineQuery error:`, err.message);
  }
}

/**
 * Answer an inline button callback query.
 * text = toast notification shown to user (max 200 chars)
 * showAlert = true shows a popup instead of a toast
 */
export async function answerCallbackQuery(shopId, callbackQueryId, text = '', showAlert = false) {
  const token = shopTokenMap.get(shopId);
  if (!token || !callbackQueryId) return;
  try {
    await fetchWithRetry(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text.slice(0, 200),
        show_alert: showAlert,
      }),
    });
  } catch (err) {
    console.error(`[BotManager] answerCallbackQuery error:`, err.message);
  }
}

/**
 * Resolve a Telegram file_id to a publicly accessible download URL.
 */
export async function getTelegramFileUrl(shopId, fileId) {
  const token = shopTokenMap.get(shopId);
  if (!token || !fileId) return null;
  try {
    const res = await fetchWithRetry(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const data = await res.json();
    if (!data.ok || !data.result?.file_path) return null;
    return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
  } catch (err) {
    console.error(`[BotManager] getFile error for shop "${shopId}":`, err.message);
    return null;
  }
}
