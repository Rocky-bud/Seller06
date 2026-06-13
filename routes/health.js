/**
 * health — liveness & readiness probes.
 *
 * PHASE 2 · STEP 3 (Health/Readiness + structured logging)
 *
 *  GET /api/healthz  — LIVENESS. Cheap, no external deps. 200 as long as the
 *                      process can answer. Used to decide "restart me?".
 *  GET /api/readyz   — READINESS. Verifies the process can actually serve
 *                      traffic: Supabase reachable (+ bot registry status).
 *                      Returns 503 when a hard dependency is down so load
 *                      balancers / orchestrators hold traffic until healthy.
 *
 * Mounted BEFORE the global rate limiter so monitoring probes are never
 * throttled or counted against API budgets.
 */

import express from 'express';
import { getAllShopIds } from '../services/botManager.js';

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

const START_TIME = Date.now();

// ─── Liveness ────────────────────────────────────────────────────────────────
router.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// ─── Readiness ───────────────────────────────────────────────────────────────
router.get('/readyz', async (req, res) => {
  const checks = {};
  let ready = true;

  // 1. Supabase connectivity — the one hard dependency. Short timeout so the
  //    probe can never hang waiting on a dead upstream.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let r;
    try {
      r = await fetch(`${SUPABASE_URL}/rest/v1/products?select=id&limit=1`, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    checks.supabase = r.ok ? 'ok' : `error_${r.status}`;
    if (!r.ok) ready = false;
  } catch (err) {
    checks.supabase = `unreachable: ${err.message}`;
    ready = false;
  }

  // 2. Bot registry — informational. An empty registry is NOT fatal (a fresh
  //    deploy may simply have no Telegram shops configured yet).
  const shopCount = getAllShopIds().length;
  checks.botRegistry = shopCount > 0 ? 'ok' : 'empty';

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks,
    shops: shopCount,
    timestamp: new Date().toISOString(),
  });
});

export default router;
