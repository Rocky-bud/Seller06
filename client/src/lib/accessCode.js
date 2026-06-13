// Client-side derivation for ACCESS CODE logins.
// A person logs in with a single short code; we deterministically turn it into
// the email + password of its backing Supabase auth user.
//
// MUST match ACCESS_CODE_DOMAIN / codeToEmail in services/accessCodes.js.
export const ACCESS_CODE_DOMAIN =
  import.meta.env.VITE_ACCESS_CODE_DOMAIN || 'shopcode.app';

export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

// Returns { email, password } for supabase.auth.signInWithPassword.
export function codeToCredentials(rawCode) {
  const code = normalizeCode(rawCode);
  return {
    email: `${code.toLowerCase()}@${ACCESS_CODE_DOMAIN}`,
    password: code,
  };
}
