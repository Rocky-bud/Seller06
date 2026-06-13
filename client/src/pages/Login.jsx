import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShop } from '../contexts/ShopContext';
import { Eye, EyeOff, Zap, Mail, Lock, KeyRound } from 'lucide-react';
import { codeToCredentials } from '../lib/accessCode';

export default function Login() {
  const { signInWithPassword, signInWithGoogle, isAuthenticated } = useShop();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [mode, setMode] = useState('email'); // 'email' | 'code'
  const [code, setCode] = useState('');

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('ایمیل و رمز عبور را وارد کنید');
      return;
    }
    setLoading(true);
    setError('');
    const { ok, error: err } = await signInWithPassword(email.trim(), password);
    if (!ok) {
      setError(
        err === 'Invalid login credentials'
          ? 'ایمیل یا رمز عبور نادرست است'
          : err || 'ورود ناموفق بود',
      );
      setLoading(false);
      return;
    }
    // Success → store token (handled in context) and route to the dashboard.
    navigate('/dashboard', { replace: true });
  };

  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    const clean = code.trim();
    if (!clean) {
      setError('کد دسترسی را وارد کنید');
      return;
    }
    setLoading(true);
    setError('');
    const { email: codeEmail, password: codePass } = codeToCredentials(clean);
    const { ok, error: err } = await signInWithPassword(codeEmail, codePass);
    if (!ok) {
      setError(
        err === 'Invalid login credentials'
          ? 'کد دسترسی نامعتبر است'
          : err || 'ورود ناموفق بود',
      );
      setLoading(false);
      return;
    }
    navigate('/dashboard', { replace: true });
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    const { ok, error: err } = await signInWithGoogle();
    if (!ok) {
      setError(err || 'ورود با گوگل ناموفق بود');
      setGoogleLoading(false);
    }
    // On success the browser is redirected to Google, then back to /dashboard.
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-slate-950"
      dir="rtl"
    >
      {/* Background glow blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-15%] right-[-5%] w-[500px] h-[500px] rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute bottom-[-15%] left-[-5%] w-[450px] h-[450px] rounded-full bg-fuchsia-600/15 blur-3xl" />
      </div>

      <div className="w-full max-w-[420px] relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-600">
            <Zap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">سامانه هوشمند فروشگاه</h1>
          <p className="text-sm mt-1.5 text-slate-400">برای ورود، اطلاعات حساب یا کد دسترسی خود را وارد کنید</p>
        </div>

        {/* Glass card */}
        <div className="rounded-3xl p-8 bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl">
          {/* Mode toggle */}
          <div className="flex gap-1 p-1 mb-6 rounded-xl bg-white/5 border border-white/10">
            <button
              type="button"
              onClick={() => { setMode('email'); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${mode === 'email' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              ایمیل و رمز عبور
            </button>
            <button
              type="button"
              onClick={() => { setMode('code'); setError(''); }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${mode === 'code' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              کد دسترسی فروشگاه
            </button>
          </div>

          {mode === 'code' ? (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-300">کد دسترسی</label>
                <div className="relative">
                  <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
                    placeholder="K7QXM2AB"
                    dir="ltr"
                    autoComplete="one-time-code"
                    className="w-full pr-10 pl-4 py-3 rounded-xl text-sm text-white outline-none bg-white/5 border border-white/10 focus:border-indigo-500/60 transition-all font-mono tracking-widest text-center"
                  />
                </div>
                <p className="text-xs text-slate-500">کدی که مدیر فروشگاه به شما داده است را وارد کنید</p>
              </div>

              {error && (
                <p className="text-xs flex items-center gap-1.5 text-red-400">
                  <span className="w-1 h-1 rounded-full bg-red-400 inline-block" />
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-gradient-to-br from-indigo-500 to-fuchsia-600"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    در حال ورود...
                  </>
                ) : (
                  'ورود با کد ←'
                )}
              </button>
            </form>
          ) : (
          <>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">ایمیل</label>
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  placeholder="you@example.com"
                  dir="ltr"
                  autoComplete="email"
                  className="w-full pr-10 pl-4 py-3 rounded-xl text-sm text-white outline-none bg-white/5 border border-white/10 focus:border-indigo-500/60 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-300">رمز عبور</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="••••••••"
                  dir="ltr"
                  autoComplete="current-password"
                  className="w-full pr-10 pl-10 py-3 rounded-xl text-sm text-white outline-none bg-white/5 border border-white/10 focus:border-indigo-500/60 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs flex items-center gap-1.5 text-red-400">
                <span className="w-1 h-1 rounded-full bg-red-400 inline-block" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-gradient-to-br from-indigo-500 to-fuchsia-600"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  در حال ورود...
                </>
              ) : (
                'ورود به سیستم ←'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <span className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-slate-500">یا</span>
            <span className="flex-1 h-px bg-white/10" />
          </div>

          {/* Google OAuth */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading}
            className="w-full py-3 rounded-xl text-sm font-semibold text-slate-800 bg-white hover:bg-slate-100 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
          >
            {googleLoading ? (
              <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
              </svg>
            )}
            ورود با گوگل
          </button>
          </>
          )}

          <div className="mt-6 pt-5 text-center border-t border-white/10">
            <p className="text-xs text-slate-500">دسترسی فقط برای مدیران و صاحبان فروشگاه مجاز است</p>
          </div>
        </div>

        <p className="text-center text-xs mt-6 text-slate-600">
          سامانه مدیریت هوشمند فروشگاه — نسخه ۲.۰
        </p>
      </div>
    </div>
  );
}
