/**
 * marketingConsent — opt-out (consent) storage for marketing broadcasts.
 *
 * PHASE 4 · STEP 1 (Broadcast core)
 *
 * Deliberately tiny and dependency-light (only httpRetry) so it can be imported
 * by BOTH the bot message handler (aiService) and the broadcast sender
 * (broadcastService) WITHOUT creating an import cycle
 * (instagramService -> aiService -> ...).
 *
 * Customers opt out by sending /stop (or "stop"/"لغو") to the bot; the row is
 * written here with the service-role key. Broadcasts always skip opted-out
 * users. Sending /start clears the opt-out (re-subscribe).
 */
import { fetchWithRetry } from './httpRetry.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

export async function supaFetch(pathAndQuery, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${pathAndQuery}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const res = await fetchWithRetry(url, { ...options, headers }, { label: 'supabase-consent' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

export async function getOptedOutUserIds(shopId) {
  try {
    const rows =
      (await supaFetch(
        `marketing_opt_out?shop_id=eq.${encodeURIComponent(shopId)}&select=user_id`,
      )) || [];
    return new Set(rows.map((r) => String(r.user_id)));
  } catch {
    return new Set();
  }
}

export async function recordOptOut(shopId, userId, platform = 'telegram') {
  if (!shopId || !userId) return false;
  try {
    await supaFetch('marketing_opt_out?on_conflict=shop_id,user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        shop_id: shopId,
        user_id: String(userId),
        platform: platform || 'telegram',
      }),
    });
    return true;
  } catch (err) {
    console.error('[marketingConsent] recordOptOut failed:', err.message);
    return false;
  }
}

export async function clearOptOut(shopId, userId) {
  if (!shopId || !userId) return false;
  try {
    await supaFetch(
      `marketing_opt_out?shop_id=eq.${encodeURIComponent(shopId)}&user_id=eq.${encodeURIComponent(String(userId))}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
    );
    return true;
  } catch (err) {
    console.error('[marketingConsent] clearOptOut failed:', err.message);
    return false;
  }
}
