/**
 * RBAC middleware (Phase 1 · Step 2)
 * ---------------------------------
 * Adds role-based access control on top of the admin API.
 *
 *  - authenticateUser : verifies the caller's Supabase user JWT and attaches
 *                       req.user = { id, email } (or null for anonymous).
 *  - requireShopRole  : gates an endpoint by the caller's role for the target
 *                       shop (owner > staff > viewer).
 *
 * Backward-compatible rollout (mirrors the webhook-secret strategy):
 *  - While RBAC_ENFORCED is not "true", failures only log a warning and the
 *    request is allowed through ("legacy mode"), so existing deployments keep
 *    working until shop_members is populated.
 *  - Set RBAC_ENFORCED=true to fail-closed (401 when unauthenticated, 403 when
 *    the role is insufficient).
 *
 * Two Supabase projects are in play:
 *  - AUTH project  (frontend / VITE_*): issues the admin user JWTs we verify.
 *  - DATA project  (server / SUPABASE_*): stores shops / orders / shop_members.
 */

import dotenv from 'dotenv';
import { codeToEmail } from '../services/accessCodes.js';
dotenv.config();

// Where admin users log in (the project that ISSUED the JWT).
const AUTH_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const AUTH_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
// Where shops / orders / shop_members live (queried server-side with the key).
const DATA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const DATA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const ROLE_RANK = { viewer: 1, staff: 2, owner: 3 };

// The main admin may sign in with a single access code (SUPER_ADMIN_CODE). The
// code maps to a deterministic auth email which we treat as super-admin below.
const SUPER_ADMIN_CODE = (process.env.SUPER_ADMIN_CODE || '').trim();

const SUPER_ADMIN_EMAILS = [
  ...(process.env.SUPER_ADMIN_EMAILS || process.env.VITE_SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
  ...(SUPER_ADMIN_CODE ? [codeToEmail(SUPER_ADMIN_CODE)] : []),
];

export function isRbacEnforced() {
  return String(process.env.RBAC_ENFORCED || '').toLowerCase() === 'true';
}

function getBearer(req) {
  const h = req.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function resolveShopId(req) {
  return req.params?.shopId || req.query?.shopId || req.body?.shopId || null;
}

/**
 * Verify a Supabase user access token against the AUTH project's GoTrue
 * endpoint. Anonymous / anon-key callers resolve to req.user = null.
 */
export async function authenticateUser(req, _res, next) {
  req.user = null;
  const token = getBearer(req);
  // The public anon key is not a user session.
  if (!token || token === AUTH_KEY || token === DATA_KEY) return next();
  try {
    const r = await fetch(`${AUTH_URL}/auth/v1/user`, {
      headers: { apikey: AUTH_KEY, Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      const u = await r.json();
      if (u && u.id) req.user = { id: u.id, email: String(u.email || '').toLowerCase() };
    } else {
      console.warn(`[RBAC] Token verification failed (HTTP ${r.status})`);
    }
  } catch (err) {
    console.warn('[RBAC] Token verification error:', err.message);
  }
  return next();
}

/**
 * Resolve the highest role a user holds for a shop.
 * Super-admin emails implicitly act as owner of every shop.
 * Returns one of 'owner' | 'staff' | 'viewer' | null.
 */
export async function getUserShopRole(shopId, user) {
  if (!user || !shopId) return null;
  if (user.email && SUPER_ADMIN_EMAILS.includes(user.email)) return 'owner';
  const orParam = `or=(user_id.eq.${user.id},email.eq.${encodeURIComponent(user.email)})`;
  const url = `${DATA_URL}/rest/v1/shop_members?shop_id=eq.${encodeURIComponent(shopId)}&${orParam}&select=role`;
  try {
    const r = await fetch(url, { headers: { apikey: DATA_KEY, Authorization: `Bearer ${DATA_KEY}` } });
    if (!r.ok) {
      // Table may not exist yet (migration 020 not run) -> treat as no membership.
      return null;
    }
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    return rows
      .map(x => x.role)
      .filter(Boolean)
      .sort((a, b) => (ROLE_RANK[b] || 0) - (ROLE_RANK[a] || 0))[0] || null;
  } catch (err) {
    console.warn('[RBAC] role lookup error:', err.message);
    return null;
  }
}

/**
 * Express guard factory. Usage: router.post('/', requireShopRole('staff'), handler)
 * Must run after authenticateUser.
 */
export function requireShopRole(minRole) {
  return async (req, res, next) => {
    const shopId = resolveShopId(req);
    if (!shopId) {
      if (!isRbacEnforced()) {
        console.warn(`[RBAC] No shopId on ${req.method} ${req.originalUrl} — allowed in legacy mode.`);
        return next();
      }
      return res.status(400).json({ success: false, error: 'shopId \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A' });
    }

    const role = await getUserShopRole(shopId, req.user);
    const ok = role && (ROLE_RANK[role] || 0) >= (ROLE_RANK[minRole] || 0);
    if (ok) {
      req.shopRole = role;
      return next();
    }

    if (!isRbacEnforced()) {
      console.warn(`[RBAC] Allowing ${req.method} ${req.originalUrl} in legacy mode (user=${req.user?.email || 'anon'}, role=${role || 'none'}, need=${minRole}). Set RBAC_ENFORCED=true to enforce.`);
      req.shopRole = role || 'legacy';
      return next();
    }
    if (!req.user) return res.status(401).json({ success: false, error: '\u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A \u0644\u0627\u0632\u0645 \u0627\u0633\u062A' });
    return res.status(403).json({ success: false, error: '\u062F\u0633\u062A\u0631\u0633\u06CC \u06A9\u0627\u0641\u06CC \u0646\u062F\u0627\u0631\u06CC\u062F' });
  };
}

/**
 * True when the user is a configured super-admin (SUPER_ADMIN_EMAILS).
 */
export function isSuperAdmin(user) {
  return !!(user && user.email && SUPER_ADMIN_EMAILS.includes(user.email));
}

/**
 * Bug-fix #14: Express guard for workspace-wide / cross-tenant operations
 * (e.g. batch webhook registration that can repoint EVERY shop's webhook).
 * Only configured super-admins may pass. Mirrors the backward-compatible
 * rollout: in legacy mode (RBAC_ENFORCED!=true) it warns but allows through;
 * set RBAC_ENFORCED=true to fail-closed. Must run after authenticateUser.
 */
export function requireSuperAdmin(req, res, next) {
  if (isSuperAdmin(req.user)) {
    req.isSuperAdmin = true;
    return next();
  }
  if (!isRbacEnforced()) {
    console.warn(`[RBAC] Allowing super-admin route ${req.method} ${req.originalUrl} in legacy mode (user=${req.user?.email || 'anon'}). Set RBAC_ENFORCED=true to enforce.`);
    return next();
  }
  if (!req.user) return res.status(401).json({ success: false, error: '\u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A \u0644\u0627\u0632\u0645 \u0627\u0633\u062A' });
  return res.status(403).json({ success: false, error: '\u062F\u0633\u062A\u0631\u0633\u06CC \u06A9\u0627\u0641\u06CC \u0646\u062F\u0627\u0631\u06CC\u062F' });
}
