import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useShop } from '../contexts/ShopContext';

// Role-aware guard. Sits INSIDE <ProtectedRoute> (so the user is already
// authenticated) and only renders the nested routes when the current role is
// in `allow`. While the authoritative role is still loading (/api/me), it
// shows a spinner to avoid briefly flashing a page the user may not access.
// Unauthorized users are bounced to /dashboard (every role can see that).
export default function RoleRoute({ allow = [] }) {
  const { role, loadingMe } = useShop();
  const location = useLocation();
  const navState = { from: location, denied: true };

  if (loadingMe && !role) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <span className="w-8 h-8 border-2 border-slate-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!allow.includes(role)) {
    return <Navigate to="/dashboard" replace state={navState} />;
  }

  return <Outlet />;
}
