/**
 * Instagram Webhook Hub  (Roadmap Stages 13 + 14 + 15)
 *
 * GET  /api/webhooks/instagram  — Meta webhook verification handshake
 * POST /api/webhooks/instagram  — Incoming Instagram DM receiver  (Stage 13)
 *                                 protected by X-Hub-Signature-256 (Stage 14)
 *                                 with fast 200 OK ACK pattern       (Stage 15)
 *
 * Heavy logic lives in services/instagramService.js. This router's jobs are:
 *   STAGE 14 →  Verify the X-Hub-Signature-256 HMAC before trusting the body.
 *   STAGE 15 →  ACK Meta with 200 OK *before* any async work, so a slow AI /
 *               DB call can never cause Meta to time out (20 s) and retry.
 *   STAGE 13 →  1. Validate payload shape
 *               2. Skip non-DM events (echoes, reads, reactions, deliveries)
 *               3. Delegate each real text DM to handleInstagramDM()
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ⚠ REQUIRED server.js CHANGE (so we can read the *raw* bytes for the HMAC):
 *
 *   // BEFORE: app.use(express.json());
 *   app.use(express.json({
 *     verify: (req, _res, buf) => { req.rawBody = buf; },   // keep raw bytes
 *   }));
 *
 * Meta computes the signature over the EXACT raw payload it sent, so we must
 * hash the original buffer — never a re-serialized JSON.stringify(req.body).
 *
 * Also add to your .env (App Secret from Meta App Dashboard → Settings → Basic):
 *   META_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 * ───────────────────────────────────────────────────────────────────────────
 */

import express from 'express';
import crypto from 'crypto';
import { handleInstagramDM } from '../services/instagramService.js';
import { claimEvent } from '../services/idempotency.js';

const router = express.Router();
const TAG    = '[Instagram Webhook]';

const SUPABASE_URL   = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
// App-level secret shared by every Page under this Meta app (Stage 14)
const META_APP_SECRET = process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET;

async function supabaseFetch(path, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${query}`, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase error (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 14 — X-Hub-Signature-256 verification
// ═══════════════════════════════════════════════════════════════════════════
//
// Meta signs every POST body with HMAC-SHA256 keyed by the App Secret and
// sends it in the header:   X-Hub-Signature-256: sha256=<hex digest>
//
// We recompute the digest over the raw request bytes and compare in constant
// time. A mismatch (or missing header / secret) means the request is rejected.
//
function verifyRequestSignature(req, res, next) {
  // Fail closed: if no secret is configured we must not accept unverified data
  if (!META_APP_SECRET) {
    console.error(`${TAG} META_APP_SECRET not set — rejecting (cannot verify)`);
    return res.status(500).json({ error: 'Server signature secret not configured' });
  }

  const signatureHeader = req.get('x-hub-signature-256');
  if (!signatureHeader) {
    console.warn(`${TAG} ✋ Missing X-Hub-Signature-256 header — rejected`);
    return res.status(401).json({ error: 'Missing signature' });
  }

  const [algo, theirDigest] = signatureHeader.split('=');
  if (algo !== 'sha256' || !theirDigest) {
    console.warn(`${TAG} ✋ Malformed signature header "${signatureHeader}" — rejected`);
    return res.status(401).json({ error: 'Malformed signature' });
  }

  // The raw body buffer captured by express.json({ verify }) in server.js.
  // Fallback to a UTF-8 re-serialization only if rawBody is unavailable.
  const rawBody = req.rawBody
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body || {}), 'utf8');

  const ourDigest = crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to avoid timing attacks
  const a = Buffer.from(ourDigest,  'hex');
  const b = Buffer.from(theirDigest, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn(`${TAG} ✋ Signature mismatch — rejected (possible spoofed request)`);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Signature OK → continue to the POST handler
  return next();
}

// ═══════════════════════════════════════════════════════════════════════════
// GET — Meta webhook verification handshake
// ═══════════════════════════════════════════════════════════════════════════
//
// Meta sends:  GET ?hub.mode=subscribe&hub.verify_token=XXX&hub.challenge=YYY
// We look up which shop owns the verify_token and echo back the raw challenge.
//
router.get('/', async (req, res) => {
  const mode        = req.query['hub.mode'];
  const verifyToken = req.query['hub.verify_token'];
  const challenge   = req.query['hub.challenge'];

  if (!mode || !verifyToken || !challenge) {
    console.warn(`${TAG} GET missing hub params`);
    return res.status(400).json({ error: 'Missing hub parameters' });
  }

  if (mode !== 'subscribe') {
    console.warn(`${TAG} GET unexpected hub.mode="${mode}"`);
    return res.status(403).json({ error: 'hub.mode must be subscribe' });
  }

  try {
    const shops = await supabaseFetch(
      'shops',
      `?select=id,instagram_verify_token&instagram_verify_token=eq.${encodeURIComponent(verifyToken)}&limit=1`
    );

    if (!shops?.length) {
      console.warn(`${TAG} Verification FAILED — unknown verify_token`);
      return res.status(403).json({ error: 'Invalid verify token' });
    }

    console.log(`${TAG} ✅ Verified shop "${shops[0].id}" — challenge accepted`);
    return res.status(200).send(challenge);
  } catch (err) {
    console.error(`${TAG} Verification error:`, err.message);
    return res.status(500).json({ error: 'Internal error during verification' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 13 + 15 — POST: incoming Instagram DM events (signature-gated, fast ACK)
// ═══════════════════════════════════════════════════════════════════════════
//
// Payload shape (simplified):
// {
//   "object": "instagram",
//   "entry": [{
//     "id": "<PAGE_ID>",
//     "time": 1234567890,
//     "messaging": [{
//       "sender":    { "id": "<USER_IGSID>" },
//       "recipient": { "id": "<PAGE_ID>" },
//       "timestamp": 1234567890123,
//       "message": { "mid": "m_<hash>", "text": "Hello" }
//     }]
//   }]
// }
//
router.post('/', verifyRequestSignature, (req, res) => {
  // ── STAGE 15: fast 200 OK ACK BEFORE any async work ───────────────────────
  // Meta retries the delivery if it does not get a 2xx within ~20 s. By ACKing
  // first and processing afterwards, a slow AI/DB call can never trigger a
  // retry storm, and the event loop stays responsive under burst traffic.
  res.status(200).send('EVENT_RECEIVED');

  const body      = req.body;
  const requestId = `req_${Date.now()}`;

  // ── Validate object type ────────────────────────────────────────────────────
  if (body?.object !== 'instagram') {
    console.log(`${TAG} [${requestId}] Ignored — object="${body?.object}" (not instagram)`);
    return;
  }

  const entries = body?.entry || [];
  console.log(`${TAG} [${requestId}] Received ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);

  // ── Process entries asynchronously (non-blocking after ACK) ────────────────
  (async () => {
    for (const entry of entries) {
      const entryPageId  = String(entry.id || '');
      const entryTime    = entry.time;
      const messagingArr = entry.messaging || [];

      console.log(
        `${TAG} [${requestId}] Entry page_id:${entryPageId}` +
        ` | ${messagingArr.length} messaging event(s)` +
        (entryTime ? ` | entry_time:${new Date(entryTime * 1000).toISOString()}` : '')
      );

      for (const event of messagingArr) {
        // ── Extract core fields ─────────────────────────────────────────────
        const senderId    = String(event.sender?.id    || '');
        const recipientId = String(event.recipient?.id || '') || entryPageId;
        const timestamp   = event.timestamp;           // ms epoch
        const msg         = event.message || {};
        const mid         = msg.mid  || null;

        // Phase 2.1: durable, cross-instance dedup. Meta may redeliver the same
        // mid; process each Instagram message at most once.
        if (mid && !(await claimEvent(`ig:${recipientId}:${mid}`, { scope: 'instagram', shopId: recipientId }))) {
          console.log(`${TAG} [${requestId}] Duplicate mid:${mid} — skipping`);
          continue;
        }
        const text        = msg.text || '';
        // STAGE 21: extract the first image attachment URL (payment receipts, etc.)
        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        const imageAtt    = attachments.find(a => a?.type === 'image' && a?.payload?.url);
        const imageUrl    = imageAtt ? imageAtt.payload.url : null;

        // ── Log every event for traffic debugging ───────────────────────────
        console.log(
          `${TAG} [${requestId}]   Event` +
          ` | sender:${senderId || 'N/A'}` +
          ` | recipient(page):${recipientId || 'N/A'}` +
          ` | mid:${mid || 'N/A'}` +
          (timestamp ? ` | ts:${new Date(timestamp).toISOString()}` : '') +
          ` | text:${text ? `"${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"` : '(no text)'}` +
          ` | is_echo:${msg.is_echo ? 'yes' : 'no'}` +
          ` | has_read:${event.read ? 'yes' : 'no'}` +
          ` | has_delivery:${event.delivery ? 'yes' : 'no'}` +
          ` | has_reaction:${event.reaction ? 'yes' : 'no'}` +
          ` | has_image:${imageUrl ? 'yes' : 'no'}`
        );

        // ── Skip non-DM events ──────────────────────────────────────────────
        if (msg.is_echo)    { console.log(`${TAG} [${requestId}]   → Skipping echo message`);     continue; }
        if (event.read)     { console.log(`${TAG} [${requestId}]   → Skipping read receipt`);      continue; }
        if (event.delivery) { console.log(`${TAG} [${requestId}]   → Skipping delivery receipt`);  continue; }
        if (event.reaction) { console.log(`${TAG} [${requestId}]   → Skipping reaction event`);    continue; }
        if (!text && !imageUrl) { console.log(`${TAG} [${requestId}]   → Skipping — no text or image payload`); continue; }
        if (!senderId)      { console.warn(`${TAG} [${requestId}]   → Skipping — missing sender.id`);    continue; }
        if (!recipientId)   { console.warn(`${TAG} [${requestId}]   → Skipping — no recipient/page_id`); continue; }

        // ── Delegate to service layer ───────────────────────────────────────
        handleInstagramDM({ senderId, recipientId, text, mid, timestamp, imageUrl }).catch(err => {
          console.error(
            `${TAG} [${requestId}] Unhandled error in handleInstagramDM` +
            ` (sender:${senderId}, page:${recipientId}):`,
            err.message
          );
        });
      }
    }
  })();
});

export default router;
