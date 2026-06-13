import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { NotificationProvider } from '../contexts/NotificationContext';
import NotificationBell from '../components/NotificationBell';
import ToastContainer from '../components/ToastContainer';

// Shell shared by every authenticated route: persistent sidebar, a top header
// with the live notification bell, the active child, and global toast popups.
export default function DashboardLayout() {
  return (
    <NotificationProvider>
      <div className="flex min-h-screen bg-slate-50" dir="rtl">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-slate-200">
            <div className="max-w-6xl mx-auto px-8 py-3 flex items-center justify-end gap-3">
              <NotificationBell />
            </div>
          </header>
          <div className="max-w-6xl mx-auto px-8 py-8">
            <Outlet />
          </div>
        </main>
        <ToastContainer />
      </div>
    </NotificationProvider>
  );
}
