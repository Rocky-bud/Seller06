// Centralised rate limiters — Phase 1 · Step 4 (granular rate limiting)
//
// The app previously had only two coarse limiters (global 100/15m + a single
// 20/min "strict" limiter shared by chat AND webhooks). That meant one noisy
// IP/shop could exhaust the budget for everyone, and cheap reads shared the
// same ceiling as expensive LLM calls.
//
// These purpose-built limiters key on IP + (shop|user) so abuse is isolated,
// and expensive/sensitive endpoints get tighter ceilings. IPv6 is handled
// safely via the official `ipKeyGenerator` helper.
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

const msg = (error) => ({ success: false, error });

// ─── scope helpers ──────────────────────────────────────────────
function shopFromReq(req) {
  return req.params?.shopId || req.query?.shopId || req.body?.shopId || 'noshop';
}

// Webhook routers are mounted before route params are parsed, so pull the shop
// id straight from the URL (e.g. /api/webhook/telegram/SHOP-XXX).
function shopFromUrl(req) {
  const m = (req.originalUrl || '').match(/\/(?:telegram|instagram)\/([^/?#]+)/i);
  return m ? m[1] : 'noshop';
}

function userFromReq(req) {
  return req.user?.id || req.user?.email || 'anon';
}

// IP + scope composite key (IPv6-safe).
const ipScope = (req, scope) => `${ipKeyGenerator(req.ip)}:${scope}`;

// 1) AI chat — each request can trigger an LLM call, so keep it tight. IP+shop.
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipScope(req, shopFromReq(req)),
  message: msg('\u062F\u0631\u062E\u0648\u0627\u0633\u062A\u200C\u0647\u0627\u06CC \u06AF\u0641\u062A\u06AF\u0648 \u0628\u06CC\u0634 \u0627\u0632 \u062D\u062F \u0645\u062C\u0627\u0632 \u0627\u0633\u062A. \u0686\u0646\u062F \u0644\u062D\u0638\u0647 \u0635\u0628\u0631 \u06A9\u0646\u06CC\u062F.'),
});

// 2) Inbound webhooks (Telegram/Instagram). Providers share a few IPs across
//    many shops, so key per shop (parsed from the URL) to isolate noisy shops.
//    keyGeneratorIpFallback is disabled on purpose: we intentionally key by shop.
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `wh:${shopFromUrl(req)}`,
  validate: { keyGeneratorIpFallback: false },
  message: msg('Too many webhook requests'),
});

// 3) Admin writes (POST/PATCH/DELETE on orders/shops/products). Reads skipped.
//    Keyed by IP + authenticated user.
export const adminWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  keyGenerator: (req) => ipScope(req, userFromReq(req)),
  message: msg('\u062A\u0639\u062F\u0627\u062F \u062A\u063A\u06CC\u06CC\u0631\u0627\u062A \u0628\u06CC\u0634 \u0627\u0632 \u062D\u062F \u0645\u062C\u0627\u0632 \u0627\u0633\u062A. \u06A9\u0645\u06CC \u0635\u0628\u0631 \u06A9\u0646\u06CC\u062F.'),
});

// 4) Member management — highly sensitive (grants/revokes shop access).
export const memberLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET',
  keyGenerator: (req) => ipScope(req, userFromReq(req)),
  message: msg('\u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0639\u0636\u0627: \u062A\u0639\u062F\u0627\u062F \u062F\u0631\u062E\u0648\u0627\u0633\u062A\u200C\u0647\u0627 \u0628\u06CC\u0634 \u0627\u0632 \u062D\u062F \u0645\u062C\u0627\u0632 \u0627\u0633\u062A.'),
});
