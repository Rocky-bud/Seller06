/**
 * httpRetry — fetchWithRetry helper with exponential backoff + full jitter.
 *
 * PHASE 2 · STEP 2 (Retry / Backoff for outbound calls)
 *
 * Why: outbound calls to the Telegram Bot API and the Instagram (Meta) Graph
 * API can fail transiently — a momentary network blip, a 429 rate-limit, or a
 * 5xx on the provider side. Previously a single such failure silently dropped
 * a customer-facing message (order confirmation, receipt prompt, AI reply).
 * This helper retries only *transient* failures with capped exponential
 * backoff + jitter, and honors a `Retry-After` header when the provider sends
 * one. Non-retryable responses (e.g. 400/401/403) are returned immediately so
 * the caller's existing error handling still runs.
 *
 * Design notes:
 *  - Returns the final Response even if it is a retryable status but retries
 *    are exhausted, so callers that inspect `data.ok` keep working unchanged.
 *  - Re-throws the last network error only when every attempt threw; all
 *    existing call sites already wrap fetch in try/catch.
 *  - Stateless and side-effect free (besides logging) — safe to share.
 */

const DEFAULT_RETRIES = 3; // total attempts = retries + 1
const DEFAULT_BASE_DELAY = 300; // ms
const DEFAULT_MAX_DELAY = 8000; // ms — cap for any single wait

// Transient HTTP statuses worth retrying. 4xx (except 408/425/429) are caller
// errors and must NOT be retried.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Parse a Retry-After header: delta-seconds or an HTTP-date. Returns ms or null. */
function parseRetryAfter(header) {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

/** Capped exponential backoff with full jitter. */
function backoffDelay(attempt, baseDelay, maxDelay) {
  const ceiling = Math.min(maxDelay, baseDelay * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

/**
 * fetch() with automatic retry/backoff for transient failures.
 *
 * @param {string} url
 * @param {object} [options]            - standard fetch options
 * @param {object} [cfg]
 * @param {number} [cfg.retries=3]      - number of RETRIES (extra attempts)
 * @param {number} [cfg.baseDelay=300]  - base backoff in ms
 * @param {number} [cfg.maxDelay=8000]  - max single wait in ms
 * @param {string} [cfg.label='fetch']  - label for logs
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, cfg = {}) {
  const retries = cfg.retries ?? DEFAULT_RETRIES;
  const baseDelay = cfg.baseDelay ?? DEFAULT_BASE_DELAY;
  const maxDelay = cfg.maxDelay ?? DEFAULT_MAX_DELAY;
  const label = cfg.label || 'fetch';

  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);

      // Retryable status + attempts left -> wait and retry.
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        const headerWait = parseRetryAfter(
          res.headers && typeof res.headers.get === 'function'
            ? res.headers.get('retry-after')
            : null,
        );
        const wait =
          headerWait != null
            ? Math.min(headerWait, maxDelay)
            : backoffDelay(attempt, baseDelay, maxDelay);
        console.warn(
          `[httpRetry] ${label} -> HTTP ${res.status}; retry ${attempt + 1}/${retries} in ${wait}ms`,
        );
        await sleep(wait);
        continue;
      }

      // Success, or a non-retryable status, or retries exhausted: hand it back.
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = backoffDelay(attempt, baseDelay, maxDelay);
        console.warn(
          `[httpRetry] ${label} network error "${err.message}"; retry ${attempt + 1}/${retries} in ${wait}ms`,
        );
        await sleep(wait);
        continue;
      }
    }
  }

  throw lastErr || new Error(`[httpRetry] ${label} failed after ${retries + 1} attempts`);
}

export default fetchWithRetry;
