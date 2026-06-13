/**
 * requestLogger — structured request logging + request-id propagation.
 *
 * PHASE 2 · STEP 3 (Health/Readiness + structured logging)
 *
 * - Reuses an inbound `X-Request-Id` (e.g. set by an upstream proxy/CDN) or
 *   generates a fresh UUID, so a single request can be traced end-to-end.
 * - Exposes `req.id` for downstream handlers and echoes `X-Request-Id` back on
 *   the response.
 * - Emits exactly ONE structured (JSON) log line per request on `finish`,
 *   with method, path, status, and duration — easy to ship to any log
 *   aggregator.
 * - Skips high-frequency health probes so monitoring doesn't flood the logs.
 */

import crypto from 'crypto';

// Health/diagnostic probes are hit very frequently by orchestrators; don't log
// them on every poll.
const SKIP_PATHS = new Set(['/api/healthz', '/api/readyz', '/api/status']);

export function requestLogger(req, res, next) {
  const inbound = req.headers['x-request-id'];
  req.id =
    typeof inbound === 'string' && inbound.trim()
      ? inbound.trim().slice(0, 200)
      : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);

  // Still assign an id (above) for skipped paths, but don't emit a log line.
  if (SKIP_PATHS.has(req.path)) return next();

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    const level =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    const line = {
      t: new Date().toISOString(),
      level,
      reqId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durMs: Math.round(durMs),
    };
    console.log(JSON.stringify(line));
  });

  next();
}

export default requestLogger;
