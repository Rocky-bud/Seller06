/**
 * Access-code provisioning service.
 *
 * Lets the super-admin / shop owner hand out a single short CODE that a person
 * uses to log in — no manual Supabase user creation required.
 *
 * How it works: each code is backed by a real Supabase auth user whose email and
 * password are DERIVED from the code, so the login screen only needs the code:
 *   email    = `${code.toLowerCase()}@${ACCESS_CODE_DOMAIN}`
 *   password = code
 *
 * The SAME derivation lives in client/src/lib/accessCode.js — keep both in sync.
 */

import dotenv from 'dotenv';
dotenv.config();

// Shared, deterministic email domain for code-backed accounts.
// MUST match ACCESS_CODE_DOMAIN in client/src/lib/accessCode.js.
export const ACCESS_CODE_DOMAIN = process.env.ACCESS_CODE_DOMAIN || 'shopcode.app';

// Auth (GoTrue) admin endpoint — the project that ISSUES login JWTs. In a
// single-project deployment this equals SUPABASE_URL. Creating users via the
// admin API requires the SERVICE ROLE key.
const AUTH_ADMIN_URL =
  process.env.AUTH_ADMIN_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL;
const AUTH_ADMIN_KEY =
  process.env.AUTH_ADMIN_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

// Unambiguous alphabet (no 0/O/1/I/L) so codes are easy to read aloud and type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode(len = 8) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function codeToEmail(code) {
  return `${String(code).trim().toLowerCase()}@${ACCESS_CODE_DOMAIN}`;
}

function adminHeaders() {
  return {
    apikey: AUTH_ADMIN_KEY,
    Authorization: `Bearer ${AUTH_ADMIN_KEY}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Create a Supabase auth user whose credentials are derived from the code.
 * email_confirm:true skips the verification email (admin-provisioned account).
 * Returns { id, email }.
 */
export async function createCodeUser({ code, shopId, role, label }) {
  const email = codeToEmail(code);
  const res = await fetch(`${AUTH_ADMIN_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      email,
      password: code,
      email_confirm: true,
      user_metadata: {
        access_code: true,
        shop_id: shopId,
        role,
        label: label || null,
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Auth admin error (${res.status}): ${text}`);
  const user = text ? JSON.parse(text) : null;
  return { id: user?.id || null, email };
}

/**
 * Best-effort removal of the auth user backing a code (on member revoke).
 * The shop_members row is the source of truth for access, so failure here only
 * logs a warning.
 */
export async function deleteCodeUser(userId) {
  if (!userId) return;
  try {
    await fetch(`${AUTH_ADMIN_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
  } catch (err) {
    console.warn('[accessCodes] failed to delete auth user:', err.message);
  }
}

// ── Super-admin access code ───────────────────────────────────────────────────
// The MAIN admin can also sign in with a single code instead of email+password.
// Set SUPER_ADMIN_CODE in the server env; the derived email is recognised as a
// super-admin in middleware/auth.js.
export const SUPER_ADMIN_CODE = (process.env.SUPER_ADMIN_CODE || '').trim();

export function superAdminCodeEmail() {
  return SUPER_ADMIN_CODE ? codeToEmail(SUPER_ADMIN_CODE) : null;
}

/**
 * Ensure the auth user backing SUPER_ADMIN_CODE exists so the main admin can log
 * in with just that code. Idempotent (an "already registered" response is the
 * normal path) and best-effort — it only logs on failure.
 */
export async function ensureSuperAdminCodeUser() {
  if (!SUPER_ADMIN_CODE) return;
  const email = codeToEmail(SUPER_ADMIN_CODE);
  try {
    const res = await fetch(`${AUTH_ADMIN_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        email,
        password: SUPER_ADMIN_CODE,
        email_confirm: true,
        user_metadata: { access_code: true, super_admin: true },
      }),
    });
    if (res.ok) {
      console.log('[accessCodes] super-admin code user ready:', email);
      return;
    }
    const text = await res.text();
    if (res.status === 422 || /already.*regist|already.*been/i.test(text)) {
      console.log('[accessCodes] super-admin code user already exists');
    } else {
      console.warn(`[accessCodes] ensureSuperAdminCodeUser failed (${res.status}): ${text}`);
    }
  } catch (err) {
    console.warn('[accessCodes] ensureSuperAdminCodeUser error:', err.message);
  }
}
