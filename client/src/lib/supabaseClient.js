// STAGE 22 -- Official Supabase browser client.
// Reads its config straight from Vite env vars (.env):
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // keep the session in localStorage across reloads
    autoRefreshToken: true,    // silently refresh the JWT before it expires
    detectSessionInUrl: true,  // complete the OAuth (Google) redirect handshake
    storageKey: 'shop-admin-auth',
  },
});

// Explicit copy of the access token (the roadmap asks us to "store the token").
export const ACCESS_TOKEN_KEY = 'sb_access_token';

export function getStoredAccessToken() {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

// STAGE 35 -- always hand out a *valid* access token. supabase-js refreshes the
// JWT under the hood (autoRefreshToken: true); getSession() returns the current
// already-refreshed session. This avoids serving a stale token (and getting a
// 401) right after the tab wakes from a long idle, before onAuthStateChange has
// synced the localStorage copy. Falls back to the stored token if the SDK is
// momentarily unavailable.
export async function getValidAccessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || getStoredAccessToken() || '';
  } catch {
    return getStoredAccessToken() || '';
  }
}
