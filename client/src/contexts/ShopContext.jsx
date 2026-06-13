import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase, ACCESS_TOKEN_KEY } from '../lib/supabaseClient';

const ShopContext = createContext(null);

// Optional allowlist of super-admin emails (comma separated) via env.
const SUPER_ADMIN_EMAILS = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function deriveRole(user) {
  if (!user) return '';
  const metaRole = user.user_metadata?.role || user.app_metadata?.role;
  if (metaRole) return metaRole;
  const email = (user.email || '').toLowerCase();
  if (email && SUPER_ADMIN_EMAILS.includes(email)) return 'super_admin';
  return 'shop_owner';
}

function deriveShopId(user) {
  if (!user) return '';
  return user.user_metadata?.shop_id || user.app_metadata?.shop_id || user.id || '';
}

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export function ShopProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  // Authoritative role resolved by the server (GET /api/me). null until fetched.
  const [me, setMe] = useState(null);
  const [loadingMe, setLoadingMe] = useState(false);

  // Mirror the active session into React state + persist the raw token.
  const applySession = useCallback((s) => {
    setSession(s);
    setUser(s?.user || null);
    try {
      if (s?.access_token) localStorage.setItem(ACCESS_TOKEN_KEY, s.access_token);
      else localStorage.removeItem(ACCESS_TOKEN_KEY);
    } catch {
      /* ignore storage errors (private mode, etc.) */
    }
  }, []);

  // Restore any existing session on first load + subscribe to auth changes
  // (covers the Google OAuth redirect completing back into the app).
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      applySession(data.session);
      setLoadingAuth(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      applySession(s);
    });
    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, [applySession]);

  // Resolve the AUTHORITATIVE role from the backend whenever the session token
  // changes. The server reads shop_members + SUPER_ADMIN_EMAILS, so the UI no
  // longer has to guess the role from user_metadata.
  const accessToken = session?.access_token || '';
  useEffect(() => {
    let cancelled = false;
    if (!accessToken) {
      setMe(null);
      return;
    }
    setLoadingMe(true);
    fetch('/api/me', {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;
        if (json && json.success && json.data) setMe(json.data);
        else setMe(null);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingMe(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // Email / password sign-in (official Supabase method).
  const signInWithPassword = useCallback(
    async (email, password) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: error.message };
      applySession(data.session);
      return { ok: true };
    },
    [applySession],
  );

  // Google OAuth sign-in (official Supabase method). Redirects to /dashboard.
  const signInWithGoogle = useCallback(async () => {
    const redirectTo = `${window.location.origin}/dashboard`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true }; // the browser navigates away to Google here
  }, []);

  // Legacy access-code entry kept only for backward compatibility (unused by UI).
  const login = useCallback((code) => !!(code || '').trim(), []);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    applySession(null);
    // Router (ProtectedRoute) redirects to /login once the session is null.
  }, [applySession]);

  // Prefer the server-resolved identity; fall back to the local guess only
  // while /api/me is still loading (keeps the first paint sensible).
  const role = me?.role || deriveRole(user);
  const shopId = me?.shopId || deriveShopId(user);
  const isSuperAdmin = me ? !!me.isSuperAdmin : role === 'super_admin';
  const controlledShopIds = me?.controlledShopIds || (shopId ? [shopId] : []);

  const value = {
    session,
    user,
    accessToken,
    isAuthenticated: !!session,
    loadingAuth,
    loadingMe,
    // role is one of: 'super_admin' | 'owner' | 'staff'
    role,
    isSuperAdmin,
    shopRole: me?.shopRole || null,
    shopId,
    controlledShopIds,
    email: me?.email || user?.email || '',
    signInWithPassword,
    signInWithGoogle,
    login,
    logout,
  };

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('useShop must be used within ShopProvider');
  return ctx;
}
