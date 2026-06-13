import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Trash2, X, Send, Camera as Instagram } from 'lucide-react';
import { useNotificationCenter } from '../contexts/NotificationContext';
import { formatDate } from '../utils/helpers';

export default function NotificationBell() {
  const navigate = useNavigate();
  const {
    notifications, unreadCount, pendingCount,
    markAllRead, markRead, clearAll, dismissNotification,
  } = useNotificationCenter();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close the dropdown when clicking outside of it.
  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const badge = pendingCount;

  const openItem = (n) => {
    markRead(n.id);
    setOpen(false);
    navigate('/receipts');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors"
      >
        <Bell className="w-5 h-5 text-slate-600" />
        {badge > 0 ? (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-danger-500 text-white text-xs font-bold flex items-center justify-center">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute left-0 mt-2 w-80 bg-white rounded-2xl border border-slate-200 shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-800">اعلان‌ها</span>
              {unreadCount > 0 ? (
                <span className="px-1.5 py-0.5 rounded-md bg-primary-50 text-primary-600 text-xs font-medium">{unreadCount} جدید</span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={markAllRead} title="علامت‌گذاری همه به‌عنوان خوانده‌شده" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-primary-600 transition-colors">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={clearAll} title="پاک کردن همه" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-danger-600 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="text-center text-slate-400 py-10 text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 text-slate-200" />
                اعلان جدیدی ندارید
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = n.platform === 'instagram' ? Instagram : Send;
                return (
                  <div
                    key={n.id}
                    onClick={() => openItem(n)}
                    className={[
                      'group flex items-start gap-3 px-4 py-3 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors',
                      n.read ? '' : 'bg-primary-50',
                    ].join(' ')}
                  >
                    <div className="w-9 h-9 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {n.read ? null : <span className="w-2 h-2 rounded-full bg-primary-500 shrink-0" />}
                        <p className="text-sm font-medium text-slate-800 truncate">{n.title}</p>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{n.body}</p>
                      <p className="text-xs text-slate-400 mt-1">{formatDate(n.createdAt)}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-300 hover:text-danger-500 transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <button
            onClick={() => { setOpen(false); navigate('/receipts'); }}
            className="w-full text-center py-3 text-sm font-medium text-primary-600 hover:bg-slate-50 transition-colors border-t border-slate-100"
          >
            مشاهده فیش‌ها
          </button>
        </div>
      ) : null}
    </div>
  );
}
