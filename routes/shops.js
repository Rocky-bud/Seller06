/**
 * Shop management API
 *
 * Handles CRUD for shops and Telegram webhook registration.
 * telegram_token is never returned in full — only masked (last 10 chars).
 */

import { Router } from 'express';
import {
  loadShops,
  setWebhookForShop,
  setWebhooksForAll,
  deleteWebhookForShop,
  getWebhookInfo,
} from '../services/botManager.js';
import { invalidateShopCache } from '../services/instagramService.js';
import { requireShopRole, requireSuperAdmin, isRbacEnforced } from '../middleware/auth.js';
import { recordAudit } from '../services/auditLog.js';
import { getRecoveryStats } from '../services/abandonedCart.js';
import { generateCode, createCodeUser } from '../services/accessCodes.js';

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase error (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

function maskToken(token) {
  if (!token) return null;
  // Show only the last 10 characters so the admin can confirm which bot it is
  return `...${token.slice(-10)}`;
}

function safeShop(shop) {
  return {
    ...shop,
    telegram_token: maskToken(shop.telegram_token),
    has_token: !!shop.telegram_token,
    instagram_access_token: maskToken(shop.instagram_access_token),
    has_instagram_token: !!shop.instagram_access_token,
  };
}

// ── GET /api/shops ──────────────────────────────────────────────────
// List all shops (tokens masked). Gracefully falls back if system_prompt column doesn't exist yet.
router.get('/', async (req, res) => {
  try {
    let shops;
    try {
      shops = await supaFetch(
        'shops?select=id,name,card_number,telegram_token,webhook_url,system_prompt,is_active,instagram_page_id,instagram_access_token,instagram_verify_token,cart_recovery_enabled,cart_recovery_delay_minutes,loyalty_enabled,loyalty_earn_per_1000,loyalty_redeem_value,created_at&order=created_at.asc'
      );
    } catch (colErr) {
      if (colErr.message.includes('system_prompt') || colErr.message.includes('column')) {
        shops = await supaFetch(
          'shops?select=id,name,card_number,telegram_token,webhook_url,created_at&order=created_at.asc'
        );
      } else {
        throw colErr;
      }
    }
    res.json({ success: true, data: (shops || []).map(safeShop) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/shops/:shopId ──────────────────────────────────────────
router.get('/:shopId', requireShopRole('viewer'), async (req, res) => {
  try {
    // Try with system_prompt; fall back without it if the column doesn't exist yet
    let shops;
    try {
      shops = await supaFetch(
        `shops?id=eq.${encodeURIComponent(req.params.shopId)}&select=id,name,card_number,telegram_token,webhook_url,system_prompt,is_active,instagram_page_id,instagram_access_token,instagram_verify_token,cart_recovery_enabled,cart_recovery_delay_minutes,loyalty_enabled,loyalty_earn_per_1000,loyalty_redeem_value,created_at`
      );
    } catch (colErr) {
      if (colErr.message.includes('system_prompt') || colErr.message.includes('column')) {
        shops = await supaFetch(
          `shops?id=eq.${encodeURIComponent(req.params.shopId)}&select=id,name,card_number,telegram_token,webhook_url,created_at`
        );
      } else {
        throw colErr;
      }
    }
    if (!shops?.length) return res.status(404).json({ success: false, error: 'Shop not found' });
    res.json({ success: true, data: safeShop(shops[0]) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/shops ─────────────────────────────────────────────────
// Create a new shop. Provisioning shops is a platform-level action, so it is
// restricted to super-admins.
router.post('/', requireSuperAdmin, async (req, res) => {
  try {
    const { id, name, card_number, telegram_token } = req.body;
    if (!id || !name) {
      return res.status(400).json({ success: false, error: 'id and name are required' });
    }
    const data = await supaFetch('shops', {
      method: 'POST',
      body: JSON.stringify({
        id,
        name,
        card_number: card_number || '',
        telegram_token: telegram_token || null,
      }),
    });
    // Reload BotManager so the new token is available immediately
    await loadShops();
    const created = Array.isArray(data) ? data[0] : data;

    // Auto-provision an OWNER access code so the admin can hand the shop off to
    // its owner with a single code (no manual Supabase user creation). Best-
    // effort: if it fails, the shop is still created.
    let ownerCode = null;
    try {
      let codeUser = null;
      let candidate = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        candidate = generateCode(8);
        try {
          codeUser = await createCodeUser({ code: candidate, shopId: id, role: 'owner', label: 'Owner' });
          break;
        } catch (e) {
          if (!/registered|duplicate|exists/i.test(e.message)) throw e;
          codeUser = null;
        }
      }
      if (codeUser) {
        await supaFetch('shop_members', {
          method: 'POST',
          body: JSON.stringify({
            shop_id: id,
            user_id: codeUser.id,
            email: codeUser.email,
            auth_email: codeUser.email,
            access_code: candidate,
            label: 'Owner',
            role: 'owner',
          }),
        });
        ownerCode = candidate;
      }
    } catch (codeErr) {
      console.warn('[shops] owner access-code provisioning failed:', codeErr.message);
    }

    await recordAudit(req, { action: 'shop.create', targetType: 'shop', targetId: id, shopId: id, metadata: { name } });
    res.status(201).json({ success: true, data: { ...safeShop(created), ownerCode } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/shops/:shopId ────────────────────────────────────────
// Update name, card_number, or telegram_token.
router.patch('/:shopId', requireShopRole('owner'), async (req, res) => {
  try {
    const { shopId } = req.params;
    const allowed = ['name', 'card_number', 'telegram_token', 'system_prompt', 'is_active', 'instagram_page_id', 'instagram_access_token', 'instagram_verify_token', 'cart_recovery_enabled', 'cart_recovery_delay_minutes', 'loyalty_enabled', 'loyalty_earn_per_1000', 'loyalty_redeem_value'];
    const updates = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field] === '' ? null : req.body[field];
      }
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }
    // If system_prompt column doesn't exist yet, remove it and still save the rest
    let data;
    try {
      data = await supaFetch(`shops?id=eq.${encodeURIComponent(shopId)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    } catch (colErr) {
      const msg = colErr.message || '';
      if (msg.includes('column') || msg.includes('system_prompt') || msg.includes('loyalty')) {
        // Strip columns that may not exist yet (pending SQL migration) and retry with the rest.
        const { system_prompt: _sp, loyalty_enabled: _le, loyalty_earn_per_1000: _lp, loyalty_redeem_value: _lr, ...rest } = updates;
        if (!Object.keys(rest).length) return res.status(400).json({ success: false, error: 'این ستون‌ها هنوز ساخته نشده‌اند — لطفاً مایگریشن SQL را در داشبورد Supabase اجرا کنید.' });
        data = await supaFetch(`shops?id=eq.${encodeURIComponent(shopId)}`, {
          method: 'PATCH',
          body: JSON.stringify(rest),
        });
      } else {
        throw colErr;
      }
    }
    // Reload BotManager to reflect token changes
    await loadShops();

    // Flush Instagram shop cache so new credentials take effect immediately
    // (avoids waiting up to 5 min for the TTL to expire)
    try {
      const oldPageId = updates.instagram_page_id;   // new value being saved
      // Also fetch the current row to get the *existing* page_id before the update,
      // in case the merchant changed the Page ID itself
      if (oldPageId) invalidateShopCache(oldPageId);
      // Always invalidate by shopId as a safe fallback key (no-op if not cached)
      invalidateShopCache(shopId);
    } catch (cacheErr) {
      // Non-fatal — cache miss just means the next request hits Supabase
      console.warn('[shops] Instagram cache invalidation skipped:', cacheErr.message);
    }

    const updated = Array.isArray(data) ? data[0] : data;
    await recordAudit(req, { action: 'shop.update', targetType: 'shop', targetId: shopId, shopId, metadata: { fields: Object.keys(updates) } });
    res.json({ success: true, data: safeShop(updated || {}) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/shops/:shopId/webhook ────────────────────────────────
// Register this shop's Telegram webhook.
// Body: { baseUrl?: string }  — multiple automatic fallbacks if omitted.
router.post('/:shopId/webhook', requireShopRole('owner'), async (req, res) => {
  try {
    const { shopId } = req.params;

    // Priority order for resolving the public base URL:
    //   1. Explicit value sent by the client (most reliable)
    //   2. REPLIT_DEV_DOMAIN env var  (set by Replit on most plans)
    //   3. x-forwarded-host header    (set by Replit's reverse proxy)
    //   4. Host header                (last resort)
    const forwardedHost = req.headers['x-forwarded-host'] || req.headers['host'];
    const proto =
      req.headers['x-forwarded-proto']?.split(',')[0]?.trim() ||
      req.protocol ||
      'https';

    const baseUrl =
      req.body.baseUrl ||
      (process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : null) ||
      (forwardedHost ? `${proto}://${forwardedHost}` : null);

    if (!baseUrl) {
      return res.status(400).json({
        success: false,
        error: 'Could not detect the public domain. Pass baseUrl in the request body.',
      });
    }

    console.log(`[shops] Registering webhook for shop "${shopId}" using baseUrl: ${baseUrl}`);

    // Reload in case the token was just saved
    await loadShops();

    const result = await setWebhookForShop(shopId, baseUrl);
    await recordAudit(req, { action: 'shop.webhook_register', targetType: 'shop', targetId: shopId, shopId });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/shops/:shopId/webhook ──────────────────────────────
// Deregister the Telegram webhook for this shop.
router.delete('/:shopId/webhook', requireShopRole('owner'), async (req, res) => {
  try {
    await loadShops();
    const result = await deleteWebhookForShop(req.params.shopId);
    await recordAudit(req, { action: 'shop.webhook_delete', targetType: 'shop', targetId: req.params.shopId, shopId: req.params.shopId });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/shops/:shopId/webhook ─────────────────────────────────
// Fetch current webhook info from Telegram (useful for debugging).
router.get('/:shopId/webhook', requireShopRole('viewer'), async (req, res) => {
  try {
    await loadShops();
    const info = await getWebhookInfo(req.params.shopId);
    res.json({ success: true, data: info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/shops/webhooks/register-all ──────────────────────────
// Batch-register webhooks for every shop that has a token.
router.post('/webhooks/register-all', requireSuperAdmin, async (req, res) => {
  try {
    // Bug-fix #14: the Telegram webhook target must come from a SERVER-trusted
    // source, never an arbitrary request body. Otherwise any caller reaching
    // this route could repoint EVERY shop's webhook at their own server and
    // intercept all customers' messages (cross-tenant webhook hijack). We now
    // (a) gate the route to super-admins (requireSuperAdmin) and (b) resolve a
    // trusted base URL from env, only honoring a body baseUrl when it matches.
    const trustedBase = (
      process.env.PUBLIC_BASE_URL ||
      process.env.WEBHOOK_BASE_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '')
    ).replace(/\/+$/, '');

    const normalize = (u) => String(u || '').trim().replace(/\/+$/, '');
    const bodyBase = normalize(req.body.baseUrl);

    let baseUrl = trustedBase;
    if (bodyBase) {
      if (trustedBase && bodyBase === trustedBase) {
        baseUrl = bodyBase;
      } else if (!trustedBase && !isRbacEnforced()) {
        console.warn('[shops/register-all] Using request-body baseUrl with no server-trusted base configured — set PUBLIC_BASE_URL to harden.');
        baseUrl = bodyBase;
      } else {
        return res.status(400).json({
          success: false,
          error: 'baseUrl غیرمجاز است؛ PUBLIC_BASE_URL را روی سرور تنظیم کنید.',
        });
      }
    }

    if (!baseUrl) {
      return res.status(400).json({
        success: false,
        error: 'آدرس پایهٔ سرور تنظیم نشده است (PUBLIC_BASE_URL).',
      });
    }

    await loadShops();
    const results = await setWebhooksForAll(baseUrl);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/shops/:shopId/cart-recovery/stats ───────────────────────────
// Abandoned-cart recovery widget data: enabled flag + recovery totals.
router.get('/:shopId/cart-recovery/stats', requireShopRole('viewer'), async (req, res) => {
  try {
    const stats = await getRecoveryStats(req.params.shopId);
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
