import { useNavigate } from 'react-router-dom';
import { X, Send, Camera as Instagram } from 'lucide-react';
import { useNotificationCenter } from '../contexts/NotificationContext';

// STAGE 34 -- lightweight Tailwind toast stack, fixed to the bottom corner and
// shown on every page. Each toast auto-dismisses (TTL handled by the provider).
export default function ToastContainer() {
  const navigate = useNavigate();
  const { toasts, removeToast } = useNotificationCenter();

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-6 left-6 z-[60] flex flex-col gap-3 w-80 max-w-[calc(100vw-3rem)]" dir="rtl">
      {toasts.map((t) => {
        const Icon = t.platform === 'instagram' ? Instagram : Send;
        return (
          <div
            key={t.id}
            onClick={() => { removeToast(t.id); navigate('/receipts'); }}
            className="animate-toast-in cursor-pointer flex items-start gap-3 bg-white rounded-2xl border border-slate-200 shadow-lg p-4 hover:shadow-xl transition-shadow"
          >
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-primary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800">{t.title}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{t.body}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); removeToast(t.id); }}
              className="p-1 rounded-md text-slate-300 hover:text-slate-500 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
