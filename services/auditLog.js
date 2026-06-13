/**
 * auditLog — durable audit trail for sensitive admin actions.
 *
 * PHASE 2 · STEP 4 (Audit Log)
 *
 * recordAudit(req, { action, targetType, targetId, shopId, metadata }) writes
 * one row to public.audit_logs (migration 023) using the service-role key.
 *
 * Design:
 *  - Actor (id + email) and the correlation request_id are pulled straight
 *    from the Express `req` (populated by authenticateUser + requestLogger).
 *  - FAIL-OPEN: auditing must NEVER break or block the user-facing action, so
 *    every error is swallowed and logged as a warning.
 *  - Safe to `await` (fast single insert) or fire-and-forget.
 */

import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

/**
 * @param {object} req                 - Express request (for actor + request id)
 * @param {object} entry
 * @param {string} entry.action         - e.g. 'order.confirm', 'product.delete'
 * @param {string} [entry.targetType]   - e.g. 'order', 'product', 'shop', 'member'
 * @param {string} [entry.targetId]     - id of the affected row
 * @param {string} [entry.shopId]       - shop scope
 * @param {object} [entry.metadata]     - extra structured context (jsonb)
 */
export async function recordAudit(req, entry = {}) {
  try {
    const {
      action,
      targetType = null,
      targetId = null,
      shopId = null,
      metadata = null,
    } = entry;

    if (!action) return;
    if (!SUPABASE_URL || !SUPABASE_KEY) return;

    const actor = (req && req.user) || null;
    const row = {
      actor_id: actor?.id || null,
      actor_email: actor?.email || null,
      action,
      target_type: targetType,
      target_id: targetId != null ? String(targetId) : null,
      shop_id: shopId != null ? String(shopId) : null,
      metadata: metadata || null,
      request_id: (req && req.id) || null,
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/audit_logs`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(
        `[audit] insert failed (HTTP ${res.status}) for "${action}": ${text.slice(0, 200)}`,
      );
    }
  } catch (err) {
    // Fail-open: never let auditing break the actual request.
    console.warn('[audit] insert error:', err.message);
  }
}

export default recordAudit;
