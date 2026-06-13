/**
 * test-instagram-webhook.js  —  Roadmap Stage 16
 *
 * Internal Instagram webhook simulator / tester.
 *
 * Lets you exercise POST /api/webhooks/instagram WITHOUT any external tool
 * (no ngrok, no Meta dashboard). It builds a realistic Instagram DM payload,
 * signs it with the same HMAC-SHA256 / App Secret scheme Meta uses
 * (X-Hub-Signature-256), and fires it at your running server.
 *
 * It also runs negative tests (bad signature, missing signature, non-DM
 * events) and the GET verification handshake, so you can confirm Stage 14
 * (security) and Stage 15 (fast 200 ACK) behave correctly.
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 *   1. Start the server in one terminal:        npm start
 *   2. Run the tester in another terminal:      node test-instagram-webhook.js
 *
 *   Optional env / CLI overrides:
 *     BASE_URL        default http://localhost:3000
 *     META_APP_SECRET must match the server's secret (default 'test_secret')
 *     PAGE_ID         recipient page id        (default 17841400000000000)
 *     SENDER_ID       sender IGSID             (default 1234567890)
 *     VERIFY_TOKEN    for the GET handshake    (default my_verify_token)
 *
 *   Send a custom message text:
 *     node test-instagram-webhook.js "سلام، قیمت محصول چنده؟"
 * ───────────────────────────────────────────────────────────────────────
 */

import crypto from 'crypto';

// ─── Config ─────────────────────────────────────────────────────────────────
const BASE_URL     = process.env.BASE_URL     || 'http://localhost:3000';
const APP_SECRET   = process.env.META_APP_SECRET || 'test_secret';
const PAGE_ID      = process.env.PAGE_ID      || '17841400000000000';
const SENDER_ID    = process.env.SENDER_ID    || '1234567890';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_verify_token';
const ENDPOINT     = `${BASE_URL}/api/webhooks/instagram`;
const CUSTOM_TEXT  = process.argv[2] || 'سلام، قیمت محصول چنده؟';

// ─── Helpers ─────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m',
};

/** Sign a raw JSON string exactly like Meta does. */
function sign(rawBody, secret = APP_SECRET) {
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${digest}`;
}

/** Build a single-DM Instagram webhook payload. */
function buildDmPayload(text, { senderId = SENDER_ID, pageId = PAGE_ID } = {}) {
  return {
    object: 'instagram',
    entry: [{
      id: pageId,
      time: Math.floor(Date.now() / 1000),
      messaging: [{
        sender:    { id: senderId },
        recipient: { id: pageId },
        timestamp: Date.now(),
        message:   { mid: `m_${crypto.randomBytes(8).toString('hex')}`, text },
      }],
    }],
  };
}

/**
 * POST a payload. By default the signature is computed from the EXACT raw
 * string we send, so it is valid. Pass opts to deliberately break it.
 */
async function postEvent(label, payloadObj, opts = {}) {
  const raw = JSON.stringify(payloadObj);

  const headers = { 'Content-Type': 'application/json' };
  if (!opts.omitSignature) {
    headers['X-Hub-Signature-256'] = opts.badSignature
      ? 'sha256=deadbeef'                       // wrong digest
      : opts.wrongSecret
        ? sign(raw, 'the_wrong_secret')         // right shape, wrong key
        : sign(raw);                            // valid
  }

  const t0 = Date.now();
  let status, bodyText;
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers, body: raw });
    status   = res.status;
    bodyText = await res.text();
  } catch (err) {
    console.log(`${C.red}✗ ${label}: request failed — ${err.message}${C.reset}`);
    console.log(`${C.dim}  (is the server running at ${BASE_URL}? → npm start)${C.reset}`);
    return { status: 0 };
  }
  const ms = Date.now() - t0;

  const ok = opts.expectStatus ? status === opts.expectStatus : true;
  const mark = ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  const expStr = opts.expectStatus ? ` (expected ${opts.expectStatus})` : '';
  console.log(
    `${mark} ${label}: ` +
    `${ok ? C.green : C.red}HTTP ${status}${expStr}${C.reset} ` +
    `${C.dim}in ${ms}ms — "${bodyText.slice(0, 40)}"${C.reset}`
  );
  return { status, ms, ok };
}

/** Exercise the GET verification handshake (Meta subscribe). */
async function getHandshake() {
  const challenge = String(Math.floor(Math.random() * 1e9));
  const url =
    `${ENDPOINT}?hub.mode=subscribe` +
    `&hub.verify_token=${encodeURIComponent(VERIFY_TOKEN)}` +
    `&hub.challenge=${challenge}`;
  try {
    const res  = await fetch(url);
    const body = await res.text();
    const ok   = res.status === 200 && body === challenge;
    const mark = ok ? `${C.green}✓${C.reset}` : `${C.yellow}!${C.reset}`;
    console.log(
      `${mark} GET handshake: HTTP ${res.status} ` +
      `${C.dim}— echo "${body.slice(0, 20)}" (challenge was "${challenge}")${C.reset}`
    );
    if (!ok) {
      console.log(`${C.dim}  → Expected 200 + echoed challenge. A 403 means no shop`);
      console.log(`    row has instagram_verify_token = "${VERIFY_TOKEN}".${C.reset}`);
    }
  } catch (err) {
    console.log(`${C.red}✗ GET handshake: ${err.message}${C.reset}`);
  }
}

// ─── Test suite ──────────────────────────────────────────────────────
async function main() {
  console.log(`${C.cyan}═══ Instagram Webhook Tester (Stage 16) ═══${C.reset}`);
  console.log(`${C.dim}Endpoint : ${ENDPOINT}`);
  console.log(`App secret: ${APP_SECRET === 'test_secret' ? "'test_secret' (default — must match server!)" : '*** from env ***'}`);
  console.log(`Page id  : ${PAGE_ID}   Sender id: ${SENDER_ID}${C.reset}\n`);

  console.log(`${C.cyan}— Positive cases —${C.reset}`);
  await getHandshake();
  await postEvent('Valid signed DM', buildDmPayload(CUSTOM_TEXT), { expectStatus: 200 });
  await postEvent('Echo event (ignored downstream)',
    (() => { const p = buildDmPayload('echo'); p.entry[0].messaging[0].message.is_echo = true; return p; })(),
    { expectStatus: 200 });
  await postEvent('Read receipt (ignored downstream)',
    (() => { const p = buildDmPayload(''); delete p.entry[0].messaging[0].message; p.entry[0].messaging[0].read = { mid: 'm_x' }; return p; })(),
    { expectStatus: 200 });

  console.log(`\n${C.cyan}— Security / negative cases (Stage 14) —${C.reset}`);
  await postEvent('Missing signature',  buildDmPayload('no sig'),  { omitSignature: true, expectStatus: 401 });
  await postEvent('Bad signature',      buildDmPayload('bad sig'), { badSignature: true,  expectStatus: 401 });
  await postEvent('Wrong app secret',   buildDmPayload('wrong key'), { wrongSecret: true, expectStatus: 401 });

  console.log(`\n${C.cyan}— Stability check (Stage 15: fast ACK) —${C.reset}`);
  const burst = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      postEvent(`Burst #${i + 1}`, buildDmPayload(`burst ${i + 1}`), { expectStatus: 200 })
    )
  );
  const times = burst.filter(r => r.ms != null).map(r => r.ms);
  if (times.length) {
    const max = Math.max(...times);
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    console.log(`${C.dim}  → 10 concurrent events — avg ${avg}ms, max ${max}ms ACK latency${C.reset}`);
  }

  console.log(`\n${C.cyan}Done.${C.reset} Check the server console for the [Instagram Webhook] processing logs.`);
}

main().catch(err => {
  console.error(`${C.red}Tester crashed:${C.reset}`, err);
  process.exit(1);
});
