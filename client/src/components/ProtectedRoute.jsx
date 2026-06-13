import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useShop } from '../contexts/ShopContext';

// Guards nested routes. Shows a spinner while the Supabase session restores,
// redirects unauthenticated users to /login (remembering the target), and lets
// authenticated users through via <Outlet />.
export default function ProtectedRoute() {
  const { isAuthenticated, loadingAuth } = useShop();
  const location = useLocation();
  const fromState = { from: location };

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <span className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={fromState} />;
  }

  return <Outlet />;
}
