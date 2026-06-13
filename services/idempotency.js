// Durable idempotency — Phase 2 · Step 1
//
// Records processed event keys in the idempotency_keys table via the atomic
// claim_event RPC (migration 022), so a redelivered webhook/order is processed
// at most once — even across multiple server instances or after a restart.
// (The previous guard was an in-memory Set: single-instance, lost on restart.)
//
// Design choices:
//  - A small in-memory LRU acts as a fast first-line guard on a single instance.
//  - If the DB is unreachable we FAIL OPEN (process the event) rather than risk
//    silently dropping a legitimate update; duplicates are the lesser evil and
//    downstream unique constraints (e.g. orders.tracking_code) still protect us.
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

// In-memory LRU fallback / fast path.
const seen = new Set();
const SEEN_MAX = 5000;
function firstSeenLocally(key) {
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
  return true;
}

/**
 * Claim an event key.
 * @returns {Promise<boolean>} true if this is the FIRST time we've seen the key
 *   (caller should process it); false if it's a duplicate (caller should skip).
 */
export async function claimEvent(key, { scope = null, shopId = null } = {}) {
  if (!key) return true; // nothing to dedupe on -> process

  // Fast local guard: if we've already seen it on this instance, it's a dup.
  if (!firstSeenLocally(key)) return false;

  // No DB configured -> rely on the local guard only (fail open).
  if (!SUPABASE_URL || !SUPABASE_KEY) return true;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_event`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_key: key, p_scope: scope, p_shop_id: shopId }),
    });

    if (!res.ok) {
      console.warn(`[idempotency] claim_event RPC ${res.status} — failing open for ${key}`);
      return true; // fail open
    }

    const data = await res.json();
    const claimed = Array.isArray(data) ? data[0] : data;
    return claimed === true || claimed === 'true';
  } catch (err) {
    console.warn(`[idempotency] claim_event error — failing open: ${err.message}`);
    return true; // fail open
  }
}
