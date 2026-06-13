/**
 * Telegram Webhook router — handles messages, photos, contacts, and callback queries
 *
 * POST /api/webhook/telegram/:shopId
 */

import express from 'express';
import crypto from 'crypto';
import {
  sendTelegramMessage,
  sendTelegramPhoto,
  editTelegramMessage,
  answerCallbackQuery,
  answerInlineQuery,
  getTelegramFileUrl,
  getTokenForShop,
  getWebhookSecret,
  isWebhookSecretEnforced,
  loadShops,
  MAIN_MENU,
} from '../services/botManager.js';
import { processMessage, processCallback, processInlineQuery } from '../services/aiService.js';
import { claimEvent } from '../services/idempotency.js';

const router = express.Router();

// Phase 2.1: durable de-duplication now lives in services/idempotency.js
// (claim_event RPC backed by the idempotency_keys table), which survives
// restarts and works across multiple instances — unlike the old in-memory Set.
// We still ACK 200 immediately so processing latency never triggers a retry.

// ─── Startup webhook registration ─────────────────────────────────────────────
export async function registerWebhooksOnStartup(baseUrl) {
  if (!baseUrl) return;
  const { setWebhooksForAll } = await import('../services/botManager.js');
  try {
    const results = await setWebhooksForAll(baseUrl);
    results.forEach(r => {
      if (r.success) console.log(`[Webhook] Registered: ${r.shopId} → ${r.webhookUrl}`);
      else console.warn(`[Webhook] Failed for ${r.shopId}: ${r.error}`);
    });
  } catch (err) {
    console.error('[Webhook] Registration error:', err.message);
  }
}

// ─── Delay helper (preserve Telegram message ordering) ────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Constant-time secret comparison ─────────────────────────────────────────
// Bug-fix #4: the Telegram secret_token was compared with a plain `===`, which
// short-circuits on the first differing byte and leaks the secret's length /
// prefix via timing. Mirror the Instagram webhook (crypto.timingSafeEqual) so
// both webhook entry points compare secrets in constant time. Returns false
// (never throws) on length mismatch or bad input.
function safeEqualSecret(a, b) {
  const ab = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (ab.length === 0 || ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

// ─── Main webhook endpoint ────────────────────────────────────────────────────
router.post('/telegram/:shopId', async (req, res) => {
  const shopId = req.params.shopId;

  // ── Phase 1.1 security gate: verify Telegram's secret_token BEFORE any work ──
  // Telegram echoes the secret we set at setWebhook time in this header. A
  // forged POST from anyone who guessed the URL won't carry it, so reject it.
  const presentedSecret = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
  const expectedSecret = getWebhookSecret(getTokenForShop(shopId));
  const secretMatches = Boolean(expectedSecret) && safeEqualSecret(presentedSecret, expectedSecret);
  if (!secretMatches) {
    if (presentedSecret || isWebhookSecretEnforced()) {
      // Wrong/absent secret while enforcement is active -> reject the forgery.
      console.warn(`[Webhook] Rejected update for shop "${shopId}": invalid secret token`);
      return res.sendStatus(401);
    }
    // Backward-compat: webhook not yet re-registered with a secret. Warn loudly
    // but keep processing so existing live deployments don't go dark.
    console.warn(`[Webhook] Missing secret token for shop "${shopId}" — processing in legacy mode. Re-run setWebhook to enable verification.`);
  }

  // Always respond 200 immediately to avoid Telegram retries
  res.sendStatus(200);

  const update = req.body;

  if (!update) return;

  // STAGE 35 + Phase 2.1: durably drop duplicate / retried deliveries.
  const eventKey = update.update_id != null ? `tg:${shopId}:${update.update_id}` : null;
  if (eventKey && !(await claimEvent(eventKey, { scope: 'telegram', shopId }))) {
    console.warn(`[Webhook] Duplicate update_id:${update.update_id} for shop "${shopId}" — skipping`);
    return;
  }

  // ── A. Inline button callback query ──────────────────────────────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    const userId = String(cb.from?.id || '');
    const chatId = cb.message?.chat?.id || cb.from?.id;
    const callbackData = cb.data || '';

    const messageId = cb.message?.message_id;

    try {
      const result = await processCallback(userId, shopId, callbackData, chatId, messageId);

      // Answer the callback (shows toast / alert in Telegram)
      await answerCallbackQuery(shopId, cb.id, result.alertText || '', result.showAlert ?? false);

      // Edit existing message in place (qty adjustment, etc.)
      if (result.editMessage) {
        const em = result.editMessage;
        await editTelegramMessage(shopId, chatId, messageId, em.text, em.markup, em.parseMode || 'Markdown');
      }

      // Send any follow-up messages
      if (result.messages?.length) {
        for (const msg of result.messages) {
          await sleep(120);
          if (msg.photo) {
            await sendTelegramPhoto(shopId, chatId, msg.photo, msg.caption || '', msg.markup, msg.parseMode || 'HTML');
          } else if (msg.text) {
            await sendTelegramMessage(shopId, chatId, msg.text, msg.markup, msg.parseMode || 'Markdown');
          }
        }
      }
    } catch (err) {
      console.error(`[Webhook] callback_query error for shop "${shopId}":`, err.message);
    }
    return;
  }

  // ── B. Inline query (user typed @BotName … in chat) ──────────────────────────
  if (update.inline_query) {
    const iq = update.inline_query;
    const shopId_iq = shopId; // already from req.params
    try {
      const results = await processInlineQuery(shopId_iq, iq.query || '');
      await answerInlineQuery(shopId_iq, iq.id, results);
    } catch (err) {
      console.error(`[Webhook] inline_query error for shop "${shopId}":`, err.message);
      await answerInlineQuery(shopId, iq.id, []).catch(() => {});
    }
    return;
  }

  // ── C. Regular message ────────────────────────────────────────────────────────
  const message = update.message;
  if (!message) return;

  const chatId = message.chat?.id;
  const userId = String(message.from?.id || chatId || '');

  // Extract text (message text or photo caption)
  const text = message.text || message.caption || '';

  // ── Resolve image payload (compressed photo or uncompressed document) ─────
  let imagePayload = null;

  if (message.photo?.length > 0) {
    const photo = message.photo[message.photo.length - 1]; // largest resolution
    const fileUrl = await getTelegramFileUrl(shopId, photo.file_id);
    imagePayload = fileUrl
      ? { file_id: photo.file_id, url: fileUrl }
      : { file_id: photo.file_id };
  } else if (message.document?.mime_type?.startsWith('image/')) {
    const doc = message.document;
    const fileUrl = await getTelegramFileUrl(shopId, doc.file_id);
    imagePayload = fileUrl
      ? { file_id: doc.file_id, url: fileUrl }
      : { file_id: doc.file_id };
  }

  // ── Extract contact (from request_contact button) ─────────────────────────
  const contact = message.contact || null;

  // Ignore updates with no processable content
  if (!text && !imagePayload && !contact) return;

  try {
    const result = await processMessage(userId, 'telegram', text, shopId, imagePayload, contact);

    if (!result.success) return;

    if (result.multiMessages?.length) {
      // Send multiple messages (e.g. product catalog)
      for (const msg of result.multiMessages) {
        await sleep(120); // slight delay to preserve ordering
        if (msg.photo) {
          await sendTelegramPhoto(shopId, chatId, msg.photo, msg.caption || '', msg.markup, msg.parseMode || 'HTML');
        } else if (msg.text) {
          await sendTelegramMessage(shopId, chatId, msg.text, msg.markup, msg.parseMode || 'HTML');
        }
      }
    } else if (result.response) {
      await sendTelegramMessage(shopId, chatId, result.response, result.markup);
    }
  } catch (err) {
    console.error(`[Webhook] processMessage error for shop "${shopId}":`, err.message);
    // Best-effort error reply
    try {
      await sendTelegramMessage(shopId, chatId,
        '⚠️ خطایی رخ داد. لطفاً مجدداً تلاش کنید.', MAIN_MENU, '');
    } catch (_) {}
  }
});

export default router;
