/**
 * Shop members API (RBAC management) — Phase 1 · Step 2
 *
 * Lets shop owners manage who can access their shop and with what role.
 * Mounted with authenticateUser in server.js so req.user is populated.
 */

import { Router } from 'express';
import { requireShopRole, getUserShopRole } from '../middleware/auth.js';
import { recordAudit } from '../services/auditLog.js';
import { generateCode, createCodeUser, deleteCodeUser } from '../services/accessCodes.js';

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase error (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

const VALID_ROLES = ['owner', 'staff', 'viewer'];

// ── GET /api/members/my-role?shopId=SHOP-XXX ─────────────────────────────────
// Returns the caller's effective role for a shop (or null). Any authenticated
// user may call it; used by the admin panel to show/hide controls.
router.get('/my-role', async (req, res) => {
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A' });
  const role = await getUserShopRole(shopId, req.user);
  res.json({ success: true, data: { role, email: req.user?.email || null } });
});

// ── GET /api/members?shopId=SHOP-XXX ─────────────────────────────────────────
// List members of a shop (viewer+).
router.get('/', requireShopRole('viewer'), async (req, res) => {
  const { shopId } = req.query;
  try {
    const data = await supaFetch(
      `shop_members?shop_id=eq.${encodeURIComponent(shopId)}&select=id,shop_id,user_id,email,role,label,access_code,created_at&order=created_at.asc`
    );
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/members ────────────────────────────────────────────────────────
// Add or update a member (owner only). Body: { shopId, email, role, user_id? }
router.post('/', requireShopRole('owner'), async (req, res) => {
  const { shopId, email, role, user_id } = req.body;
  if (!email && !user_id) {
    return res.status(400).json({ success: false, error: 'email \u06CC\u0627 user_id \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: `role \u0628\u0627\u06CC\u062F \u06CC\u06A9\u06CC \u0627\u0632 ${VALID_ROLES.join(', ')} \u0628\u0627\u0634\u062F` });
  }
  try {
    const body = {
      shop_id: shopId,
      email: email ? String(email).toLowerCase() : null,
      user_id: user_id || null,
      role,
    };
    // Upsert on (shop_id, email) so re-inviting just updates the role.
    const data = await supaFetch('shop_members?on_conflict=shop_id,email', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(body),
    });
    const created = Array.isArray(data) ? data[0] : data;
    await recordAudit(req, { action: 'member.upsert', targetType: 'member', targetId: created?.id, shopId, metadata: { email: body.email, role } });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/members/code
// Generate a login ACCESS CODE for a shop, backed by a Supabase auth user, so a
// person can sign in with JUST the code (no manual Supabase work). Owner (or
// super-admin) only. Body: { shopId, role?, label? }
router.post('/code', requireShopRole('owner'), async (req, res) => {
  const { shopId, role = 'staff', label } = req.body;
  if (!shopId) return res.status(400).json({ success: false, error: 'shopId الزامی است' });
  if (!['owner', 'staff'].includes(role)) {
    return res.status(400).json({ success: false, error: 'role باید owner یا staff باشد' });
  }
  try {
    let code = null;
    let created = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateCode(8);
      try {
        created = await createCodeUser({ code, shopId, role, label });
        break;
      } catch (err) {
        lastErr = err;
        if (!/registered|duplicate|exists/i.test(err.message)) throw err;
        created = null;
      }
    }
    if (!created) throw lastErr || new Error('failed to provision access code');

    const body = {
      shop_id: shopId,
      user_id: created.id,
      email: created.email,
      auth_email: created.email,
      access_code: code,
      label: label || null,
      role,
    };
    const data = await supaFetch('shop_members', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const member = Array.isArray(data) ? data[0] : data;
    await recordAudit(req, { action: 'member.code.create', targetType: 'member', targetId: member?.id, shopId, metadata: { role, label: label || null } });
    res.status(201).json({ success: true, data: { ...member, access_code: code } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/members/:memberId?shopId=SHOP-XXX ────────────────────────────
// Remove a member (owner only).
router.delete('/:memberId', requireShopRole('owner'), async (req, res) => {
  const { memberId } = req.params;
  const { shopId } = req.query;
  try {
    // If this member is code-based, clean up its backing auth user too.
    let backingUserId = null;
    try {
      const rows = await supaFetch(
        `shop_members?id=eq.${encodeURIComponent(memberId)}&select=user_id,access_code`
      );
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row && row.access_code) backingUserId = row.user_id;
    } catch { /* ignore lookup failure */ }
    await supaFetch(
      `shop_members?id=eq.${encodeURIComponent(memberId)}&shop_id=eq.${encodeURIComponent(shopId)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    );
    if (backingUserId) await deleteCodeUser(backingUserId);
    await recordAudit(req, { action: 'member.remove', targetType: 'member', targetId: memberId, shopId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
