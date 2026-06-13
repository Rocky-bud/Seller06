import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ShopProvider } from './contexts/ShopContext';
import ProtectedRoute from './components/ProtectedRoute';
import RoleRoute from './components/RoleRoute';
import DashboardLayout from './layouts/DashboardLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Receipts from './pages/Receipts';
import Customers from './pages/Customers';
import Settings from './pages/Settings';
import Shops from './pages/Shops';
import Broadcast from './pages/Broadcast';

export default function App() {
  return (
    <ShopProvider>
      <BrowserRouter>
        <Routes>
          {/* Public route */}
          <Route path="/login" element={<Login />} />

          {/* Protected area: redirects to /login when unauthenticated */}
          <Route element={<ProtectedRoute />}>
            <Route element={<DashboardLayout />}>
              {/* Every authenticated role sees the dashboard (content adapts). */}
              <Route path="/dashboard" element={<Dashboard />} />

              {/* Shop owner + staff: day-to-day merchant tooling. */}
              <Route element={<RoleRoute allow={['owner', 'staff']} />}>
                <Route path="/products" element={<Products />} />
                <Route path="/receipts" element={<Receipts />} />
                <Route path="/customers" element={<Customers />} />
              </Route>

              {/* Shop owner only: broadcast + bot settings. */}
              <Route element={<RoleRoute allow={['owner']} />}>
                <Route path="/broadcast" element={<Broadcast />} />
                <Route path="/settings" element={<Settings />} />
              </Route>

              {/* Super-admin only: cross-shop management. */}
              <Route element={<RoleRoute allow={['super_admin']} />}>
                <Route path="/shops" element={<Shops />} />
              </Route>
            </Route>
          </Route>

          {/* Defaults */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ShopProvider>
  );
}
