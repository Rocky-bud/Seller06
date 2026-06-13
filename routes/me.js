/**
 * GET /api/me — single source of truth for the signed-in user's role.
 *
 * The frontend used to GUESS the role from Supabase user_metadata, which is
 * wrong for per-shop roles (the real role lives in shop_members) and for
 * super-admins (configured via SUPER_ADMIN_EMAILS). This endpoint resolves the
 * authoritative answer on the server and returns everything the UI needs to
 * gate menus, routes and the aggregated super-admin dashboard.
 *
 * Response shape:
 *   {
 *     authenticated: boolean,
 *     email: string|null,
 *     isSuperAdmin: boolean,
 *     role: 'super_admin'|'owner'|'staff',   // canonical UI role
 *     shopRole: 'owner'|'staff'|null,        // membership role (shop_members)
 *     shopId: string|null,                   // default/active shop
 *     controlledShopIds: string[]            // shops this user can see
 *   }
 *
 * Mounted with authenticateUser in server.js, so req.user is populated.
 */

import { Router } from 'express';
import { isSuperAdmin } from '../middleware/auth.js';

const router = Router();

const DATA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const DATA_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

// Optional fallback shop for legacy single-shop deployments where shop_members
// has not been populated yet.
const DEFAULT_SHOP_ID = process.env.DEFAULT_SHOP_ID || '';

const ROLE_RANK = { viewer: 1, staff: 2, owner: 3 };

async function supaFetch(path) {
  const res = await fetch(`${DATA_URL}/rest/v1/${path}`, {
    headers: { apikey: DATA_KEY, Authorization: `Bearer ${DATA_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase error (${res.status}): ${text}`);
  }
  return res.json();
}

// Highest-ranked role from a list of membership rows.
function topRole(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return (
    rows
      .map((r) => r.role)
      .filter(Boolean)
      .sort((a, b) => (ROLE_RANK[b] || 0) - (ROLE_RANK[a] || 0))[0] || null
  );
}

router.get('/', async (req, res) => {
  const user = req.user;

  // Anonymous / anon-key callers: nothing to resolve.
  if (!user) {
    return res.json({
      success: true,
      data: {
        authenticated: false,
        email: null,
        isSuperAdmin: false,
        role: 'staff',
        shopRole: null,
        shopId: null,
        controlledShopIds: [],
      },
    });
  }

  const superAdmin = isSuperAdmin(user);

  try {
    if (superAdmin) {
      // Super-admin controls EVERY shop — their dashboard aggregates over all.
      let shopIds = [];
      try {
        const shops = (await supaFetch('shops?select=id&order=created_at.asc')) || [];
        shopIds = shops.map((s) => s.id).filter(Boolean);
      } catch {
        shopIds = [];
      }
      return res.json({
        success: true,
        data: {
          authenticated: true,
          email: user.email || null,
          isSuperAdmin: true,
          role: 'super_admin',
          shopRole: 'owner',
          shopId: shopIds[0] || DEFAULT_SHOP_ID || null,
          controlledShopIds: shopIds,
        },
      });
    }

    // Regular user: read their memberships from shop_members.
    let memberships = [];
    try {
      const orParam = `or=(user_id.eq.${user.id},email.eq.${encodeURIComponent(user.email)})`;
      memberships =
        (await supaFetch(`shop_members?${orParam}&select=shop_id,role`)) || [];
    } catch {
      memberships = [];
    }

    const controlledShopIds = [
      ...new Set(memberships.map((m) => m.shop_id).filter(Boolean)),
    ];
    const shopRole = topRole(memberships);

    // Legacy fallback: no membership rows yet (migration not run / single-shop
    // deployment). Treat the caller as owner of the default shop so existing
    // installs keep working until shop_members is populated.
    if (!controlledShopIds.length) {
      return res.json({
        success: true,
        data: {
          authenticated: true,
          email: user.email || null,
          isSuperAdmin: false,
          role: 'owner',
          shopRole: null,
          shopId: DEFAULT_SHOP_ID || null,
          controlledShopIds: DEFAULT_SHOP_ID ? [DEFAULT_SHOP_ID] : [],
        },
      });
    }

    return res.json({
      success: true,
      data: {
        authenticated: true,
        email: user.email || null,
        isSuperAdmin: false,
        role: shopRole === 'staff' ? 'staff' : 'owner',
        shopRole,
        shopId: controlledShopIds[0],
        controlledShopIds,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
